import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export * from "./schema/index.ts";

export function createDb(url: string) {
  const client = postgres(url);
  return { db: drizzle(client, { schema }), client };
}
