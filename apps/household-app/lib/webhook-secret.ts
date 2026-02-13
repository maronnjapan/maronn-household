/**
 * Webhookシークレットの暗号化ユーティリティ
 *
 * AES-GCMで暗号化・復号を行う。
 * キーローテーション対応: 現在のキーで復号失敗時に旧キーで再試行する。
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const ENCRYPTION_IV_LENGTH = 12;

function encodeBase64(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)));
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(secretKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(secretKey);
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial);
  return crypto.subtle.importKey(
    'raw',
    hash,
    {
      name: ENCRYPTION_ALGORITHM,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptWebhookSecret(
  secret: string,
  secretKey: string
): Promise<{ encrypted: string; iv: string }> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_LENGTH));
  const key = await deriveKey(secretKey);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv,
    },
    key,
    encoder.encode(secret)
  );

  return {
    encrypted: encodeBase64(encrypted),
    iv: encodeBase64(iv.buffer),
  };
}

export async function decryptWebhookSecret(
  encrypted: string,
  iv: string,
  secretKey: string
): Promise<string> {
  const key = await deriveKey(secretKey);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv: decodeBase64(iv),
    },
    key,
    decodeBase64(encrypted)
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * 現在のキーで復号を試み、失敗時に旧キーでフォールバックする
 *
 * キーローテーション中、一部のデータがまだ旧キーで暗号化されている場合に使用。
 * 旧キーでの復号に成功した場合、usedOldKey: true を返す。
 *
 * @param encrypted 暗号化されたデータ（Base64）
 * @param iv 初期化ベクトル（Base64）
 * @param currentKey 現在の暗号化キー
 * @param oldKey 旧暗号化キー（ローテーション前のキー）
 * @returns 復号結果と使用したキーの情報
 */
export async function decryptWithKeyFallback(
  encrypted: string,
  iv: string,
  currentKey: string,
  oldKey?: string
): Promise<{ decrypted: string; usedOldKey: boolean }> {
  try {
    const decrypted = await decryptWebhookSecret(encrypted, iv, currentKey);
    return { decrypted, usedOldKey: false };
  } catch {
    if (!oldKey) {
      throw new Error('復号に失敗しました。暗号化キーが正しくありません。');
    }
    const decrypted = await decryptWebhookSecret(encrypted, iv, oldKey);
    return { decrypted, usedOldKey: true };
  }
}

/**
 * データを旧キーから現在のキーに再暗号化する
 *
 * @param encrypted 旧キーで暗号化されたデータ（Base64）
 * @param iv 旧キーの初期化ベクトル（Base64）
 * @param oldKey 旧暗号化キー
 * @param newKey 新しい暗号化キー
 * @returns 新キーで暗号化されたデータ
 */
export async function reEncrypt(
  encrypted: string,
  iv: string,
  oldKey: string,
  newKey: string
): Promise<{ encrypted: string; iv: string }> {
  const plaintext = await decryptWebhookSecret(encrypted, iv, oldKey);
  return encryptWebhookSecret(plaintext, newKey);
}
