import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. The app cannot start without a Postgres connection.",
  );
}

export const sqlClient = neon(url);
export const db = drizzle(sqlClient, { schema });
export { schema };
