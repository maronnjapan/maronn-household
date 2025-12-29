import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "./server.js";

// React用のtRPCクライアント（useQuery, useMutationなど）
export const trpc = createTRPCReact<AppRouter>();

export function getTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
      }),
    ],
  });
}

// Vanilla tRPCクライアント（Reactコンポーネント外で使用）
// sync.tsなどのバックグラウンド処理用
export const vanillaTrpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
