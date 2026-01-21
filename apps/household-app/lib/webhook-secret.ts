/**
 * Webhookシークレットの暗号化ユーティリティ
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
