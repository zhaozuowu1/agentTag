import { defineConfig } from "drizzle-kit";
import { loadRepoRootEnv } from "./src/load-root-env.ts";

loadRepoRootEnv();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://agenttag:agenttag@localhost:5432/agenttag",
  },
});
