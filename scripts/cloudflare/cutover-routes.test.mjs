import { describe, expect, it } from 'vitest';
import { appDeployArgs, planRouteCutover, planRouteRollback } from './cutover-routes.mjs';

const APEX = 'maronn-household-budget.com/*';
const WWW = 'www.maronn-household-budget.com/*';
const PATTERNS = [APEX, WWW];
const GATEWAY = 'household-gateway';
const V_NEW = '22222222-2222-4222-8222-222222222222';

/** 計画をルート一覧に当てはめた結果（API の振る舞いを写したもの） */
function applyRouteOperations(routes, operations) {
  let next = routes.map((r) => ({ ...r }));
  let created = 0;
  for (const op of operations) {
    if (op.type === 'update') next = next.map((r) => (r.id === op.routeId ? { ...r, script: op.script ?? null } : r));
    if (op.type === 'create') next.push({ id: `created-${++created}`, pattern: op.pattern, script: op.script ?? null });
    if (op.type === 'delete') next = next.filter((r) => r.id !== op.routeId);
  }
  return next;
}

const assignments = (routes) =>
  Object.fromEntries(routes.filter((r) => PATTERNS.includes(r.pattern)).map((r) => [r.pattern, r.script]));

describe('planRouteCutover', () => {
  it('同じパターンの既存ルートは PUT（update）で gateway に付け替え、以前の割り当てを記録する', () => {
    const routes = [
      { id: 'r1', pattern: APEX, script: 'household-app' },
      { id: 'r2', pattern: WWW, script: 'household-app' },
      { id: 'r3', pattern: 'maronn-household-budget.com/static/*', script: null },
    ];
    const plan = planRouteCutover(routes, PATTERNS, GATEWAY);
    expect(plan.operations).toEqual([
      { type: 'update', routeId: 'r1', pattern: APEX, script: GATEWAY },
      { type: 'update', routeId: 'r2', pattern: WWW, script: GATEWAY },
    ]);
    expect(plan.previous).toEqual([
      { pattern: APEX, existed: true, routeId: 'r1', script: 'household-app' },
      { pattern: WWW, existed: true, routeId: 'r2', script: 'household-app' },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('ルートが無いパターンは POST（create）で作る', () => {
    const plan = planRouteCutover([{ id: 'r1', pattern: APEX, script: 'household-app' }], PATTERNS, GATEWAY);
    expect(plan.operations[1]).toEqual({ type: 'create', pattern: WWW, script: GATEWAY });
    expect(plan.previous[1]).toEqual({ pattern: WWW, existed: false, routeId: null, script: null });
  });

  it('既に gateway に割り当て済みなら何もしない（2 回目以降のデプロイ）', () => {
    const routes = [
      { id: 'r1', pattern: APEX, script: GATEWAY },
      { id: 'r2', pattern: WWW, script: GATEWAY },
    ];
    expect(planRouteCutover(routes, PATTERNS, GATEWAY).operations.map((op) => op.type)).toEqual(['noop', 'noop']);
  });

  it('Worker なしのルートも付け替え、以前は Worker なしだったと記録する', () => {
    const plan = planRouteCutover([{ id: 'r1', pattern: APEX, script: null }], [APEX], GATEWAY);
    expect(plan.operations).toEqual([{ type: 'update', routeId: 'r1', pattern: APEX, script: GATEWAY }]);
    expect(plan.previous).toEqual([{ pattern: APEX, existed: true, routeId: 'r1', script: null }]);
  });

  it('gateway を経由しない内部 Worker への別パターンのルートを警告する', () => {
    const routes = [
      { id: 'r1', pattern: APEX, script: 'household-app' },
      { id: 'r9', pattern: 'maronn-household-budget.com/api/*', script: 'household-app' },
      { id: 'r8', pattern: 'maronn-household-budget.com/assets/*', script: null },
    ];
    const { warnings } = planRouteCutover(routes, PATTERNS, GATEWAY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('maronn-household-budget.com/api/*');
  });

  it('同じパターンのルートが複数あれば中止する', () => {
    const routes = [
      { id: 'r1', pattern: APEX, script: 'household-app' },
      { id: 'r2', pattern: APEX, script: 'other' },
    ];
    expect(() => planRouteCutover(routes, PATTERNS, GATEWAY)).toThrow('複数');
  });
});

describe('planRouteRollback', () => {
  it('カットオーバーしてからロールバックすると、元の割り当てに戻る', () => {
    const original = [
      { id: 'r1', pattern: APEX, script: 'household-app' },
      { id: 'r3', pattern: 'maronn-household-budget.com/static/*', script: null },
    ];
    const cutover = planRouteCutover(original, PATTERNS, GATEWAY);
    const afterCutover = applyRouteOperations(original, cutover.operations);
    expect(assignments(afterCutover)).toEqual({ [APEX]: GATEWAY, [WWW]: GATEWAY });

    const rollback = planRouteRollback(cutover.previous, afterCutover, GATEWAY);
    const afterRollback = applyRouteOperations(afterCutover, rollback.operations);
    expect(assignments(afterRollback)).toEqual({ [APEX]: 'household-app' });
    expect(afterRollback).toEqual(original);
  });

  it('以前の割り当てに PUT で戻し、カットオーバーで作ったルートは削除する', () => {
    const previous = [
      { pattern: APEX, existed: true, routeId: 'r1', script: 'household-app' },
      { pattern: WWW, existed: false, routeId: null, script: null },
    ];
    const current = [
      { id: 'r1', pattern: APEX, script: GATEWAY },
      { id: 'r7', pattern: WWW, script: GATEWAY },
    ];
    expect(planRouteRollback(previous, current, GATEWAY).operations).toEqual([
      { type: 'update', routeId: 'r1', pattern: APEX, script: 'household-app' },
      { type: 'delete', routeId: 'r7', pattern: WWW },
    ]);
  });

  it('以前から gateway だったルートや、既に戻っているルートは変更しない', () => {
    const previous = [
      { pattern: APEX, existed: true, routeId: 'r1', script: GATEWAY },
      { pattern: WWW, existed: true, routeId: 'r2', script: 'household-app' },
    ];
    const current = [
      { id: 'r1', pattern: APEX, script: GATEWAY },
      { id: 'r2', pattern: WWW, script: 'household-app' },
    ];
    expect(planRouteRollback(previous, current, GATEWAY).operations.map((op) => op.type)).toEqual(['noop', 'noop']);
  });

  it('カットオーバーで作ったルートが別の Worker に変わっていれば、消さずに警告する', () => {
    const previous = [{ pattern: WWW, existed: false, routeId: null, script: null }];
    const current = [{ id: 'r7', pattern: WWW, script: 'someone-else' }];
    const { operations, warnings } = planRouteRollback(previous, current, GATEWAY);
    expect(operations.map((op) => op.type)).toEqual(['noop']);
    expect(warnings).toHaveLength(1);
  });

  it('以前あったルートが消えていれば作り直す（Worker なしのルートは Worker なしで）', () => {
    const previous = [{ pattern: APEX, existed: true, routeId: 'r1', script: null }];
    expect(planRouteRollback(previous, [], GATEWAY).operations).toEqual([
      { type: 'create', pattern: APEX, script: null },
    ]);
  });
});

describe('wrangler の引数', () => {
  it('新バージョンを 100% で確認なしに出す', () => {
    expect(appDeployArgs(V_NEW, 'household-app', 'cutover')).toEqual([
      'versions',
      'deploy',
      `${V_NEW}@100%`,
      '--name',
      'household-app',
      '--yes',
      '--message',
      'cutover',
    ]);
    expect(() => appDeployArgs('not-a-uuid', 'household-app', 'm')).toThrow();
  });
});
