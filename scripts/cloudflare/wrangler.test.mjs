import { describe, expect, it } from 'vitest';
import { findUploadedVersionId, parseWranglerOutput } from './wrangler.mjs';

const VERSION_ID = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

/** wrangler 4.60 が WRANGLER_OUTPUT_FILE_PATH に書く ND-JSON と同じ形 */
const outputFile = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
const session = { type: 'wrangler-session', version: 1, wrangler_version: '4.60.0', command_line_args: ['versions', 'upload'] };
const upload = (overrides = {}) => ({
  type: 'version-upload',
  version: 1,
  worker_name: 'household-app',
  worker_tag: 'tag',
  version_id: VERSION_ID,
  preview_url: undefined,
  ...overrides,
});

describe('parseWranglerOutput', () => {
  it('1 行 1 エントリの JSON を読み、空行は無視する', () => {
    expect(parseWranglerOutput(outputFile(session, upload()) + '\n')).toHaveLength(2);
  });

  it('JSON でない行があれば例外にする', () => {
    expect(() => parseWranglerOutput('{"type":"x"}\nnot json\n')).toThrow('2 行目');
  });
});

describe('findUploadedVersionId', () => {
  it('version-upload のバージョン ID を返す', () => {
    expect(findUploadedVersionId(parseWranglerOutput(outputFile(session, upload())), 'household-app')).toBe(VERSION_ID);
  });

  it('コマンドが失敗していれば例外にする', () => {
    const entries = [session, { type: 'command-failed', version: 1, code: 10021, message: 'validation error' }];
    expect(() => findUploadedVersionId(entries, 'household-app')).toThrow('validation error');
  });

  it('version-upload が無い・複数・別の Worker・ID が UUID でなければ例外にする', () => {
    expect(() => findUploadedVersionId([session], 'household-app')).toThrow('0 件');
    expect(() => findUploadedVersionId([upload(), upload()], 'household-app')).toThrow('2 件');
    expect(() => findUploadedVersionId([upload({ worker_name: 'household-auth' })], 'household-app')).toThrow(
      'household-auth'
    );
    expect(() => findUploadedVersionId([upload({ version_id: null })], 'household-app')).toThrow('不正');
  });
});
