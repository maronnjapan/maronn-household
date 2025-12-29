import type { dbD1 } from "../database/drizzle/db";
import * as drizzleQueries from "../database/drizzle/queries/todos";
import { enhance, type UniversalHandler } from "@universal-middleware/core";

export const createTodoHandler: UniversalHandler<Universal.Context & { db: ReturnType<typeof dbD1> }> = enhance(
  async (request, _context, _runtime) => {
    // In a real case, user-provided data should ALWAYS be validated with tools like zod
    const newTodo = (await request.json()) as { text: string };

    await drizzleQueries.insertTodo(_context.db, newTodo.text);

    return new Response(JSON.stringify({ status: "OK" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  },
  { name: "my-app:todo-handler", path: `/api/todo/create`, method: ["GET", "POST"], immutable: false },
);
