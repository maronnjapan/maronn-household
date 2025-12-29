import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import type { AppRouter } from "./server.js";

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
