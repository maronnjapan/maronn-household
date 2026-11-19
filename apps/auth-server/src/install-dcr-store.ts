/**
 * 動的クライアント登録のストアを D1 版に差し替える
 *
 * 生成コード（oidc-provider/features/dynamic-client-registration/store.ts）は、
 * globalThis.__oidcDynamicallyRegisteredClientStore が空のときだけメモリ上のストアを作る。
 * このモジュールを生成コードより先に評価して、D1 版のストアを入れておく（app.ts の最初の import）。
 */
import { D1DynamicClientStore } from './dcr-store.js';
import type { DynamicallyRegisteredClientStore } from './oidc-provider/features/dynamic-client-registration/store.js';

export const dcrStore = new D1DynamicClientStore();

(globalThis as typeof globalThis & {
  __oidcDynamicallyRegisteredClientStore?: DynamicallyRegisteredClientStore;
}).__oidcDynamicallyRegisteredClientStore = dcrStore;
