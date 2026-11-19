import { describe, expect, it } from 'vitest';
import { LEGACY_WORKERS } from './config.mjs';
import { assertRetirable, planLegacyCleanup } from './retire-legacy-workers.mjs';

const routes = [
  { id: 'r-app', pattern: 'maronn-household-budget.com/*', script: 'household-app' },
  { id: 'r-www', pattern: 'www.maronn-household-budget.com/*', script: 'household-app' },
  { id: 'r-mcp', pattern: 'maronn-household-budget.com/mcp', script: 'mcp-server' },
  { id: 'r-mcp2', pattern: 'maronn-household-budget.com/mcp/*', script: 'mcp-server' },
  { id: 'r-auth', pattern: 'auth.maronn-household-budget.com/*', script: 'auth-server' },
  { id: 'r-new-mcp', pattern: 'x.maronn-household-budget.com/*', script: 'household-mcp' },
  { id: 'r-similar', pattern: 'y.maronn-household-budget.com/*', script: 'mcp-server-v2' },
  { id: 'r-none', pattern: 'maronn-household-budget.com/static/*', script: null },
];

const domains = [
  { id: 'd-auth', hostname: 'auth.maronn-household-budget.com', service: 'auth-server' },
  { id: 'd-other', hostname: 'other.example.com', service: 'household-auth' },
];

describe('planLegacyCleanup', () => {
  it('旧 Worker ごとに、ルートの削除 → Custom Domain の解除 → Worker の削除 の順に並べる', () => {
    const plan = planLegacyCleanup(routes, domains, [...LEGACY_WORKERS]);
    expect(plan).toEqual([
      {
        worker: 'mcp-server',
        operations: [
          { type: 'delete-route', routeId: 'r-mcp', pattern: 'maronn-household-budget.com/mcp' },
          { type: 'delete-route', routeId: 'r-mcp2', pattern: 'maronn-household-budget.com/mcp/*' },
          { type: 'delete-script', script: 'mcp-server' },
        ],
      },
      {
        worker: 'auth-server',
        operations: [
          { type: 'delete-route', routeId: 'r-auth', pattern: 'auth.maronn-household-budget.com/*' },
          { type: 'delete-domain', domainId: 'd-auth', hostname: 'auth.maronn-household-budget.com' },
          { type: 'delete-script', script: 'auth-server' },
        ],
      },
      {
        worker: 'delete-expired-session-cron',
        operations: [{ type: 'delete-script', script: 'delete-expired-session-cron' }],
      },
    ]);
  });

  it('mcp-server を最初に処理する', () => {
    expect(planLegacyCleanup([], [], [...LEGACY_WORKERS])[0].worker).toBe('mcp-server');
  });

  it('現行の Worker や名前が似ているだけの Worker のルート・ドメインには触れない', () => {
    const touched = planLegacyCleanup(routes, domains, [...LEGACY_WORKERS])
      .flatMap((p) => p.operations)
      .map((op) => op.routeId ?? op.domainId ?? op.script);
    expect(touched).not.toContain('r-app');
    expect(touched).not.toContain('r-www');
    expect(touched).not.toContain('r-new-mcp');
    expect(touched).not.toContain('r-similar');
    expect(touched).not.toContain('r-none');
    expect(touched).not.toContain('d-other');
  });

  it('ルートもドメインも無ければ Worker の削除だけ（Worker が無くても削除 API が 404 を返すだけ）', () => {
    expect(planLegacyCleanup([], [], ['delete-expired-session-cron'])).toEqual([
      {
        worker: 'delete-expired-session-cron',
        operations: [{ type: 'delete-script', script: 'delete-expired-session-cron' }],
      },
    ]);
  });
});

describe('assertRetirable', () => {
  it('許可リストにない名前・現行の Worker は拒否する', () => {
    expect(() => assertRetirable(['household-app'])).toThrow('許可リスト');
    expect(() => assertRetirable(['household-gateway'])).toThrow('許可リスト');
    expect(() => assertRetirable(['webhook-batch-cron'])).toThrow('許可リスト');
    expect(() => planLegacyCleanup(routes, domains, ['mcp-server', 'household-auth'])).toThrow('household-auth');
  });

  it('許可リストの名前は受け入れる', () => {
    expect(() => assertRetirable([...LEGACY_WORKERS])).not.toThrow();
  });
});
