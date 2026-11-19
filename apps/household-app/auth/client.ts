/**
 * ログイン状態のクライアント（認証基盤 household-auth でログインする。サーバー側は server/session/）
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export const SESSION_QUERY_KEY = ['session'] as const;

/** 最後にログインしていたユーザー ID（オフラインで起動しても、そのユーザーの IndexedDB のデータを表示するため） */
const LAST_USER_ID_KEY = 'household:lastUserId';

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch('/api/session/me', { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to load session: ${response.status}`);
  }
  const { user } = (await response.json()) as { user: SessionUser | null };
  rememberUserId(user?.id ?? null);
  return user;
}

export function rememberedUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
}

function rememberUserId(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(LAST_USER_ID_KEY, userId);
    else window.localStorage.removeItem(LAST_USER_ID_KEY);
  } catch {
    // ストレージを使えない環境（プライベートブラウズなど）では覚えない
  }
}

/** 認証基盤でのログイン（Google）を始める。ログイン後は returnTo に戻る */
export function signIn(returnTo = window.location.pathname): void {
  window.location.href = `/api/session/login?${new URLSearchParams({ return_to: returnTo })}`;
}

/** ログアウトし、認証基盤のセッションも終える */
export async function signOut(): Promise<void> {
  const response = await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) {
    window.alert('ログアウトに失敗しました。時間をおいて再度お試しください。');
    return;
  }
  const { redirectTo } = (await response.json()) as { redirectTo: string };
  rememberUserId(null);
  window.location.href = redirectTo;
}

/** 退会後: このブラウザの記憶を消す */
export function forgetUser(): void {
  rememberUserId(null);
}
