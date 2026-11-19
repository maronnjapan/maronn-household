/**
 * auth-server の Worker エントリ。gateway から service binding で呼ばれる（ルートは持たない）
 */
import { buildApp, type AuthEnv } from './app.js';

let app: ReturnType<typeof buildApp> | undefined;

export default {
  fetch(request: Request, env: AuthEnv, ctx: ExecutionContext) {
    app ??= buildApp(env);
    return app.fetch(request, env, ctx);
  },
};
