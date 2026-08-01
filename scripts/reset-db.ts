/**
 * Drops every table in the `public` schema so `drizzle-kit push` can recreate
 * it from src/db/schema.ts.
 *
 * This is a development bootstrap for a database that has no production data.
 * It refuses to run if any table contains rows, so it can never silently
 * destroy real campaign state.
 *
 *   npm run db:reset
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  const tables = (
    await sql`select table_name from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE'
              order by table_name`
  ).map((r) => r.table_name as string);

  if (tables.length === 0) {
    console.log("public schema is already empty — nothing to drop.");
    return;
  }

  const counts = await sql.query(
    tables
      .map((t) => `select '${t}' as t, count(*)::int as c from "${t}"`)
      .join(" union all "),
  );
  const populated = (counts as { t: string; c: number }[]).filter((r) => r.c > 0);

  if (populated.length > 0 && process.env.FORCE_RESET !== "1") {
    console.error("Refusing to reset — these tables contain data:");
    for (const r of populated) console.error(`  ${r.t}: ${r.c} rows`);
    console.error("Set FORCE_RESET=1 to override.");
    process.exit(1);
  }

  console.log(`Dropping ${tables.length} empty table(s)...`);
  await sql.query(
    `drop table if exists ${tables.map((t) => `"${t}"`).join(", ")} cascade`,
  );
  console.log("Done. Run `npm run db:push` to recreate the schema.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
