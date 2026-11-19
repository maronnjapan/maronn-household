import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { cleanupExpiredRecords } from '../src/cleanup';
import { deleteUserIdentity } from '../src/delete-user';

const NOW = 1_800_000_000; // epoch 秒
const DAY = 24 * 60 * 60;

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.dispose();
});

async function run(sql: string, ...params: (string | number)[]) {
  await testDb.db.prepare(sql).bind(...params).run();
}

async function ids(table: string, column = 'id') {
  const { results } = await testDb.db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).all<{ id: string }>();
  return results.map((row) => row.id);
}

async function insertUser(id: string) {
  await run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 'x', 'x')",
    id,
    id,
    `${id}@example.com`
  );
}

async function insertDcrClient(id: string, registeredAt: number) {
  await run("INSERT INTO clients (id, client_type, is_deleted) VALUES (?, 'public', FALSE)", id);
  await run('INSERT INTO dcr_client_registrations (client_id, created_at) VALUES (?, ?)', id, registeredAt);
}

async function insertAccessToken(id: string, sub: string, clientId: string, exp: number, grantId = 'g') {
  await run(
    "INSERT INTO access_tokens (id, sub, exp, client_id, token_hash, grant_id, payload) VALUES (?, ?, ?, ?, ?, ?, '{}')",
    id,
    sub,
    exp,
    clientId,
    `hash-${id}`,
    grantId
  );
}

describe('cleanupExpiredRecords', () => {
  it('期限切れのトランザクション・認可コード・トークン・セッションを消し、有効なものは残す', async () => {
    await insertUser('u1');
    await run("INSERT INTO transactions (transaction_id, status, created_at, expired_at, payload) VALUES ('tx-old', 'requested', 0, ?, '{}')", NOW - 1);
    await run("INSERT INTO transactions (transaction_id, status, created_at, expired_at, payload) VALUES ('tx-new', 'requested', 0, ?, '{}')", NOW + 600);
    await run("INSERT INTO codes (id, expired_at, is_used, grant_id, payload) VALUES ('code-old', ?, FALSE, 'g', '{}')", NOW - 1);
    await run("INSERT INTO codes (id, expired_at, is_used, grant_id, payload) VALUES ('code-new', ?, FALSE, 'g', '{}')", NOW + 60);
    await insertAccessToken('at-old', 'u1', 'household-app', NOW - 1);
    await insertAccessToken('at-new', 'u1', 'household-app', NOW + 60);
    await run("INSERT INTO refresh_tokens (id, exp, is_used, grant_id, payload) VALUES ('rt-old', ?, FALSE, 'g', '{}')", NOW - 1);
    await run("INSERT INTO refresh_tokens (id, exp, is_used, grant_id, payload) VALUES ('rt-new', ?, FALSE, 'g', '{}')", NOW + 60);
    await run("INSERT INTO browser_sessions (session_id, subject, auth_time) VALUES ('bs-old', 'u1', ?)", NOW - 91 * DAY);
    await run("INSERT INTO browser_sessions (session_id, subject, auth_time) VALUES ('bs-new', 'u1', ?)", NOW - 10 * DAY);
    const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
    await run("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s-old', ?, 't-old', 'x', 'x', 'u1')", iso(NOW - 1));
    await run("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s-new', ?, 't-new', 'x', 'x', 'u1')", iso(NOW + DAY));

    await cleanupExpiredRecords(testDb.db, NOW);

    expect(await ids('transactions', 'transaction_id')).toEqual(['tx-new']);
    expect(await ids('codes')).toEqual(['code-new']);
    expect(await ids('access_tokens')).toEqual(['at-new']);
    expect(await ids('refresh_tokens')).toEqual(['rt-new']);
    expect(await ids('browser_sessions', 'session_id')).toEqual(['bs-new']);
    expect(await ids('session')).toEqual(['s-new']);
  });

  it('登録から24時間たっても同意もトークンもない動的登録クライアントを消し、使われているものと新しいものは残す', async () => {
    await insertDcrClient('dcr-unused', NOW - 2 * DAY);
    await insertDcrClient('dcr-consented', NOW - 2 * DAY);
    await run("INSERT INTO consent_scopes (subject, client_id, scope) VALUES ('u1', 'dcr-consented', 'household')");
    await insertDcrClient('dcr-token', NOW - 2 * DAY);
    await insertAccessToken('at', 'u1', 'dcr-token', NOW + 60);
    await insertDcrClient('dcr-fresh', NOW - 60);
    await run("INSERT INTO clients (id, client_type, is_deleted) VALUES ('household-app', 'confidential', FALSE)");

    await cleanupExpiredRecords(testDb.db, NOW);

    expect(await ids('clients')).toEqual(['dcr-consented', 'dcr-fresh', 'dcr-token', 'household-app']);
    expect(await ids('dcr_client_registrations', 'client_id')).toEqual(['dcr-consented', 'dcr-fresh', 'dcr-token']);
  });
});

describe('deleteUserIdentity', () => {
  it('ユーザーと、その同意・グラントのトークン・ブラウザセッション・アプリのセッションを消し、他のユーザーのものは残す', async () => {
    for (const id of ['u1', 'u2']) {
      await insertUser(id);
      await run("INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, 'google', ?, 'x', 'x')", `acc-${id}`, `g-${id}`, id);
      await run("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, 'x', ?, 'x', 'x', ?)", `s-${id}`, `t-${id}`, id);
      await run("INSERT INTO consent_scopes (subject, client_id, scope) VALUES (?, 'dcr-c', 'household')", id);
      await run("INSERT INTO consent_grants (subject, client_id, grant_id) VALUES (?, 'dcr-c', ?)", id, `grant-${id}`);
      await insertAccessToken(`at-${id}`, id, 'dcr-c', NOW + 60, `grant-${id}`);
      await run("INSERT INTO refresh_tokens (id, exp, is_used, grant_id, payload) VALUES (?, ?, FALSE, ?, '{}')", `rt-${id}`, NOW + 60, `grant-${id}`);
      await run("INSERT INTO browser_sessions (session_id, subject, auth_time) VALUES (?, ?, ?)", `bs-${id}`, id, NOW);
    }

    await deleteUserIdentity(testDb.db, 'u1');

    expect(await ids('user')).toEqual(['u2']);
    expect(await ids('account')).toEqual(['acc-u2']);
    expect(await ids('session')).toEqual(['s-u2']);
    expect(await ids('consent_scopes', 'subject')).toEqual(['u2']);
    expect(await ids('consent_grants', 'subject')).toEqual(['u2']);
    expect(await ids('access_tokens')).toEqual(['at-u2']);
    expect(await ids('refresh_tokens')).toEqual(['rt-u2']);
    expect(await ids('browser_sessions', 'session_id')).toEqual(['bs-u2']);
  });
});
