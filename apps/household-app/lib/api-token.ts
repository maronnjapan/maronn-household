/**
 * APIトークン生成・ハッシュ化ユーティリティ
 */

/**
 * 暗号学的に安全なランダムトークンを生成
 *
 * @param length トークンの長さ（デフォルト: 128文字 = 512ビット）
 * @returns ランダムな16進数文字列
 */
export function generateSecureToken(length: number = 128): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * トークンをSHA-256でハッシュ化
 *
 * @param token 平文トークン
 * @returns ハッシュ化されたトークン（16進数文字列）
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * トークンを検証（提供されたトークンとハッシュ値を比較）
 *
 * @param providedToken 検証対象の平文トークン
 * @param storedHash 保存されているハッシュ値
 * @returns トークンが一致すればtrue
 */
export async function verifyToken(providedToken: string, storedHash: string): Promise<boolean> {
  const providedHash = await hashToken(providedToken);
  return providedHash === storedHash;
}

/**
 * ログ出力用にトークンをマスキング
 *
 * @param token 平文トークン
 * @returns マスキングされたトークン（先頭8文字と末尾4文字のみ表示）
 */
export function maskToken(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}
