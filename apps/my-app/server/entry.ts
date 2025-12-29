import { dbMiddleware } from "./db-middleware";
import { trpcHandler } from "./trpc-handler";
import { apply, serve } from "@photonjs/hono";
import { Hono } from "hono";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

export default startApp() as unknown;

function startApp() {
  const app = new Hono();

  apply(app, [
    // Make database available in Context as `context.db`
    dbMiddleware,

    // tRPC route. See https://trpc.io/docs/server/adapters
    trpcHandler("/api/trpc"),
  ]);

  return serve(app, {
    port,
  });
}
