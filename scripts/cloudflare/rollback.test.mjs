import { describe, expect, it } from 'vitest';
import { planDeploymentRollback, planRollbackSteps, rollbackArgs, sameTraffic } from './rollback.mjs';

const V_OLD = '11111111-1111-4111-8111-111111111111';
const V_NEW = '22222222-2222-4222-8222-222222222222';
const V_OTHER = '33333333-3333-4333-8333-333333333333';

const deployment = (...versions) => ({ id: 'd', versions: versions.map(([id, p]) => ({ version_id: id, percentage: p })) });
const recorded = (dep) => ({ scriptExists: dep !== undefined, deployment: dep ?? null });

describe('planDeploymentRollback', () => {
  it('1 バージョン 100% のデプロイには wrangler rollback で戻す', () => {
    expect(planDeploymentRollback(deployment([V_OLD, 100]), deployment([V_NEW, 100]))).toEqual({
      type: 'rollback',
      versionId: V_OLD,
    });
  });

  it('複数バージョンの配分には versions deploy で同じ配分に戻す', () => {
    expect(planDeploymentRollback(deployment([V_OLD, 90], [V_OTHER, 10]), deployment([V_NEW, 100]))).toEqual({
      type: 'versions-deploy',
      specs: [`${V_OLD}@90%`, `${V_OTHER}@10%`],
    });
  });

  it('記録したデプロイのまま（そのステップまで進まなかった）なら何もしない', () => {
    expect(planDeploymentRollback(deployment([V_OLD, 100]), deployment([V_OLD, 100])).type).toBe('none');
  });

  it('記録したときにデプロイが無かった（初回）なら戻す先が無い', () => {
    expect(planDeploymentRollback(null, deployment([V_NEW, 100])).type).toBe('none');
  });
});

describe('sameTraffic', () => {
  it('バージョンと割合が同じかを比べる（順序は問わない）', () => {
    expect(sameTraffic(deployment([V_OLD, 50], [V_NEW, 50]), deployment([V_NEW, 50], [V_OLD, 50]))).toBe(true);
    expect(sameTraffic(deployment([V_OLD, 100]), deployment([V_NEW, 100]))).toBe(false);
    expect(sameTraffic(deployment([V_OLD, 60], [V_NEW, 40]), deployment([V_OLD, 50], [V_NEW, 50]))).toBe(false);
    expect(sameTraffic(null, deployment([V_OLD, 100]))).toBe(false);
  });
});

describe('rollbackArgs', () => {
  it('1 バージョンへは wrangler rollback <id> --name <worker> --yes --message', () => {
    expect(rollbackArgs({ type: 'rollback', versionId: V_OLD }, 'household-auth', 'deploy rollback')).toEqual([
      'rollback',
      V_OLD,
      '--name',
      'household-auth',
      '--yes',
      '--message',
      'deploy rollback',
    ]);
  });

  it('複数バージョンの配分へは wrangler versions deploy', () => {
    expect(rollbackArgs({ type: 'versions-deploy', specs: [`${V_OLD}@90%`, `${V_OTHER}@10%`] }, 'household-app', 'r')).toEqual([
      'versions',
      'deploy',
      `${V_OLD}@90%`,
      `${V_OTHER}@10%`,
      '--name',
      'household-app',
      '--yes',
      '--message',
      'r',
    ]);
    expect(() => rollbackArgs({ type: 'none', reason: 'x' }, 'household-app', 'r')).toThrow();
  });
});

describe('planRollbackSteps', () => {
  const workersState = {
    workers: {
      'household-auth': recorded(deployment(['auth-v1', 100])),
      'household-mcp': recorded(deployment(['mcp-v1', 100])),
      'household-gateway': recorded(undefined),
      'household-app': recorded(deployment(['app-v1', 100])),
    },
  };
  const cutoverState = {
    zoneId: 'z',
    routes: [],
    targetScript: 'household-gateway',
    app: { worker: 'household-app', previousDeployment: deployment(['app-v2', 100]), deployStarted: true },
  };
  const order = (steps) => steps.map((s) => (s.type === 'routes' ? 'routes' : s.worker));

  it('デプロイと逆の順: household-app → ルート → gateway → mcp → auth', () => {
    expect(order(planRollbackSteps({ workersState, cutoverState }))).toEqual([
      'household-app',
      'routes',
      'household-gateway',
      'household-mcp',
      'household-auth',
    ]);
  });

  it('household-app はデプロイ前の記録へ戻す（household-auth と同じ時点の secret にそろえる）', () => {
    const [app] = planRollbackSteps({ workersState, cutoverState });
    expect(app).toMatchObject({ worker: 'household-app', target: deployment(['app-v1', 100]), source: 'workers-state' });
  });

  it('カットオーバーより前で失敗した（カットオーバーの記録が無い）ら Worker だけを戻す', () => {
    const steps = planRollbackSteps({ workersState, cutoverState: null });
    expect(order(steps)).toEqual(['household-app', 'household-gateway', 'household-mcp', 'household-auth']);
    expect(steps.find((s) => s.worker === 'household-auth').target).toEqual(deployment(['auth-v1', 100]));
  });

  it('記録したときに無かった Worker は戻す先なし（target: null）として並べる', () => {
    const gateway = planRollbackSteps({ workersState, cutoverState }).find((s) => s.worker === 'household-gateway');
    expect(gateway.target).toBeNull();
    expect(planDeploymentRollback(gateway.target, deployment(['gw-v1', 100])).type).toBe('none');
  });

  it('カットオーバーの記録だけなら、household-app はカットオーバー前のデプロイへ（出す前に止まっていれば戻さない）', () => {
    expect(planRollbackSteps({ cutoverState })).toEqual([
      { type: 'worker', worker: 'household-app', target: deployment(['app-v2', 100]), source: 'cutover-state' },
      { type: 'routes' },
    ]);
    const notStarted = { ...cutoverState, app: { ...cutoverState.app, deployStarted: false } };
    expect(order(planRollbackSteps({ cutoverState: notStarted }))).toEqual(['routes']);
  });

  it('記録が何も無ければ何もしない', () => {
    expect(planRollbackSteps({})).toEqual([]);
  });
});
