/**
 * Cloudflare Workers向けの軽量パスワードハッシング
 *
 * Web Crypto API の PBKDF2 を使用
 * - Cloudflare Workers の CPU 制限（50ms）に収まる
 * - 標準的な Web API で環境依存なし
 *
 * 注意: 既存ユーザーの移行が必要な場合、旧ハッシュとの互換性を考慮すること
 */

const PBKDF2_ITERATIONS = 100000; // OWASP推奨: 最低60万だが、Workers制限のため調整
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * パスワードをハッシュ化
 * 形式: $pbkdf2$iterations$salt$hash (Base64)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  const saltBase64 = arrayBufferToBase64(salt);
  const hashBase64 = arrayBufferToBase64(new Uint8Array(hashBuffer));

  return `$pbkdf2$${PBKDF2_ITERATIONS}$${saltBase64}$${hashBase64}`;
}

/**
 * パスワードを検証
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  // 新形式（PBKDF2）の検証
  if (hash.startsWith("$pbkdf2$")) {
    return verifyPbkdf2(hash, password);
  }

  // 旧形式（scrypt/bcrypt）の場合は false を返す
  // 注意: 既存ユーザーはパスワードリセットが必要
  console.warn(
    "Legacy password hash detected. User needs to reset password."
  );
  return false;
}

/**
 * PBKDF2形式のハッシュを検証
 */
async function verifyPbkdf2(hash: string, password: string): Promise<boolean> {
  const parts = hash.split("$");
  // 形式: $pbkdf2$iterations$salt$hash
  if (parts.length !== 5 || parts[1] !== "pbkdf2") {
    return false;
  }

  const iterations = parseInt(parts[2], 10);
  const salt = base64ToArrayBuffer(parts[3]);
  const storedHash = base64ToArrayBuffer(parts[4]);

  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const computedHashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    storedHash.length * 8
  );

  const computedHash = new Uint8Array(computedHashBuffer);

  // 定数時間比較（タイミング攻撃対策）
  return timingSafeEqual(storedHash, computedHash);
}

/**
 * ArrayBufferをBase64に変換
 */
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

/**
 * Base64をUint8Arrayに変換
 */
function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 定数時間での配列比較（タイミング攻撃対策）
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
