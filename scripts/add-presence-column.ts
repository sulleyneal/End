/**
 * Adds `campaign_members.last_active_at` for the who-is-here indicator.
 *
 * Written as a script rather than run through `drizzle-kit push` because the
 * sandbox cannot open a raw Postgres socket — only Neon's HTTP driver gets
 * through. It is additive and idempotent, so it is safe against a database that
 * already holds live campaigns; nothing is dropped and no existing column is
 * touched.
 *
 *   npx tsx scripts/add-presence-column.ts
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { ProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Neon's HTTP driver uses `fetch`, and Node's `fetch` does not honour
 * `HTTPS_PROXY` — so without this the request leaves by a route the sandbox
 * egress allowlist rejects with a 403 that reads like a Neon error. curl
 * reaches the same host fine, which is the tell.
 */
function useSandboxProxy() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return;
  setGlobalDispatcher(
    new ProxyAgent({
      uri: proxy,
      requestTls: { ca: readFileSync("/root/.ccr/ca-bundle.crt") },
    }),
  );
}

async function main() {
  useSandboxProxy();

  // Pooled, not `DATABASE_URL_UNPOOLED`. Migrations normally want the direct
  // connection, but only the pooler host is in the sandbox egress allowlist —
  // the direct host 403s at CONNECT. A single idempotent ALTER is fine through
  // the pooler.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  await sql`alter table campaign_members
            add column if not exists last_active_at timestamptz`;

  const [column] = await sql`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'campaign_members' and column_name = 'last_active_at'`;

  if (!column) throw new Error("last_active_at is missing after the migration");
  console.log(`ok — campaign_members.last_active_at (${column.data_type})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
