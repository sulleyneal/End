/**
 * Apply pending migrations to Neon.
 *
 * Uses Neon's HTTP driver rather than a TCP connection on purpose: this
 * container's egress policy allows HTTPS only, so port 5432 is unreachable
 * from here. The HTTP endpoint is the same database.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = drizzle(neon(url));

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
