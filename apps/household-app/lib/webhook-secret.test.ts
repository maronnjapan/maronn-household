import { describe, it, expect } from 'vitest';
import {
  encryptWebhookSecret,
  decryptWebhookSecret,
  decryptWithKeyFallback,
  reEncrypt,
} from './webhook-secret';

const TEST_KEY_A = 'test-secret-key-A-for-encryption';
const TEST_KEY_B = 'test-secret-key-B-for-encryption';

describe('encryptWebhookSecret / decryptWebhookSecret', () => {
  it('暗号化と復号のラウンドトリップ', async () => {
    const plaintext = 'my-webhook-secret';
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);
    const result = await decryptWebhookSecret(encrypted, iv, TEST_KEY_A);
    expect(result).toBe(plaintext);
  });

  it('異なるキーでは復号できない', async () => {
    const plaintext = 'my-webhook-secret';
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);
    await expect(
      decryptWebhookSecret(encrypted, iv, TEST_KEY_B)
    ).rejects.toThrow();
  });
});

describe('decryptWithKeyFallback', () => {
  it('現在のキーで復号できる場合 usedOldKey: false', async () => {
    const plaintext = 'secret-data';
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);

    const result = await decryptWithKeyFallback(encrypted, iv, TEST_KEY_A);
    expect(result.decrypted).toBe(plaintext);
    expect(result.usedOldKey).toBe(false);
  });

  it('現在のキーで復号できず旧キーで復号できる場合 usedOldKey: true', async () => {
    const plaintext = 'secret-data';
    // 旧キーで暗号化
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);

    // 新キー(B)で復号失敗 → 旧キー(A)でフォールバック
    const result = await decryptWithKeyFallback(encrypted, iv, TEST_KEY_B, TEST_KEY_A);
    expect(result.decrypted).toBe(plaintext);
    expect(result.usedOldKey).toBe(true);
  });

  it('両方のキーで復号できない場合はエラー', async () => {
    const plaintext = 'secret-data';
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);

    await expect(
      decryptWithKeyFallback(encrypted, iv, TEST_KEY_B, 'wrong-old-key')
    ).rejects.toThrow();
  });

  it('旧キーが未指定で現在のキーで復号できない場合はエラー', async () => {
    const plaintext = 'secret-data';
    const { encrypted, iv } = await encryptWebhookSecret(plaintext, TEST_KEY_A);

    await expect(
      decryptWithKeyFallback(encrypted, iv, TEST_KEY_B)
    ).rejects.toThrow('復号に失敗しました');
  });
});

describe('reEncrypt', () => {
  it('旧キーから新キーに再暗号化する', async () => {
    const plaintext = 'secret-to-rotate';

    // 旧キーで暗号化
    const original = await encryptWebhookSecret(plaintext, TEST_KEY_A);

    // 旧キー→新キーに再暗号化
    const rotated = await reEncrypt(
      original.encrypted,
      original.iv,
      TEST_KEY_A,
      TEST_KEY_B
    );

    // 新キーで復号できる
    const result = await decryptWebhookSecret(
      rotated.encrypted,
      rotated.iv,
      TEST_KEY_B
    );
    expect(result).toBe(plaintext);

    // 旧キーでは復号できない
    await expect(
      decryptWebhookSecret(rotated.encrypted, rotated.iv, TEST_KEY_A)
    ).rejects.toThrow();
  });

  it('再暗号化後のIVが元と異なる（ランダム生成）', async () => {
    const plaintext = 'secret-data';
    const original = await encryptWebhookSecret(plaintext, TEST_KEY_A);
    const rotated = await reEncrypt(
      original.encrypted,
      original.iv,
      TEST_KEY_A,
      TEST_KEY_B
    );

    expect(rotated.iv).not.toBe(original.iv);
    expect(rotated.encrypted).not.toBe(original.encrypted);
  });
});
