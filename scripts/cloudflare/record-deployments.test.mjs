import { describe, expect, it } from 'vitest';
import { RECORDED_WORKERS } from './config.mjs';
import { buildWorkersState, describeSnapshot, parseWorkersState } from './record-deployments.mjs';

const V1 = '11111111-1111-4111-8111-111111111111';

describe('記録する Worker', () => {
  it('wrangler deploy で即時に出る 3 つと household-app', () => {
    expect([...RECORDED_WORKERS].sort()).toEqual(['household-app', 'household-auth', 'household-gateway', 'household-mcp']);
  });
});

describe('buildWorkersState / parseWorkersState', () => {
  it('記録をそのまま読み戻せる（JSON を経由しても同じ）', () => {
    const snapshots = {
      'household-auth': { scriptExists: true, deployment: { id: 'd1', versions: [{ version_id: V1, percentage: 100 }] } },
      'household-gateway': { scriptExists: false, deployment: null },
    };
    const state = buildWorkersState(snapshots, new Date('2026-11-19T00:00:00Z'));
    expect(state).toEqual({ schema: 1, createdAt: '2026-11-19T00:00:00.000Z', workers: snapshots });
    expect(parseWorkersState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('形式の違うファイルは拒否する', () => {
    expect(() => parseWorkersState({ schema: 2, workers: {} })).toThrow('形式');
    expect(() => parseWorkersState({ schema: 1 })).toThrow('workers');
    expect(() => parseWorkersState({ schema: 1, workers: { 'household-auth': { deployment: null } } })).toThrow(
      'household-auth'
    );
    expect(() =>
      parseWorkersState({ schema: 1, workers: { 'household-auth': { scriptExists: true, deployment: { versions: [] } } } })
    ).toThrow();
  });
});

describe('describeSnapshot', () => {
  it('戻す先の有無が分かるように表示する', () => {
    expect(describeSnapshot({ scriptExists: false, deployment: null })).toContain('戻す先なし');
    expect(describeSnapshot({ scriptExists: true, deployment: null })).toContain('戻す先なし');
    expect(describeSnapshot({ scriptExists: true, deployment: { versions: [{ version_id: V1, percentage: 100 }] } })).toBe(
      `${V1}@100%`
    );
  });
});
