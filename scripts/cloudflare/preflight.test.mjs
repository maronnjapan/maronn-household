import { describe, expect, it } from 'vitest';
import { describeRouteAssignments, findMissingSecrets, formatMissingSecretsMessage } from './preflight.mjs';

const complete = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  CLOUDFLARE_D1_API_TOKEN: 'd',
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 's',
};

describe('findMissingSecrets', () => {
  it('すべてそろっていれば空', () => {
    expect(findMissingSecrets(complete)).toEqual([]);
  });

  it('未設定・空文字・空白だけの secret を挙げる（GitHub Actions は未設定の secret を空文字にする）', () => {
    const missing = findMissingSecrets({ ...complete, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' \n', CLOUDFLARE_D1_API_TOKEN: undefined });
    expect(missing.map((m) => m.secret)).toEqual(['CLOUDFLARE_D1_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  });
});

describe('formatMissingSecretsMessage', () => {
  it('追加すべき GitHub secret と、本番が変わっていないことを伝える', () => {
    const message = formatMissingSecretsMessage(findMissingSecrets({ ...complete, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }));
    expect(message).toContain('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
    expect(message).toContain('Secrets and variables → Actions');
    expect(message).toContain('旧バージョンのまま');
  });
});

describe('describeRouteAssignments', () => {
  it('パターンごとの現在の割り当てを示す', () => {
    const routes = [
      { id: 'r1', pattern: 'maronn-household-budget.com/*', script: 'household-app' },
      { id: 'r2', pattern: 'maronn-household-budget.com/mcp', script: 'mcp-server' },
    ];
    expect(describeRouteAssignments(routes)).toEqual([
      'maronn-household-budget.com/* → household-app',
      'www.maronn-household-budget.com/* → （ルートなし）',
    ]);
  });
});
