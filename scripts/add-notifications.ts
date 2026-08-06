/**
 * Adds the notification columns and the push-subscription table.
 *
 * Additive and idempotent, so it is safe against a database holding live
 * campaigns. Run through the Neon HTTP driver rather than `drizzle-kit push`
 * because the sandbox cannot open a raw Postgres socket.
 *
 *   npx tsx scripts/add-notifications.ts
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { ProxyAgent, setGlobalDispatcher } from "undici";

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

  // Pooled: only the pooler host is in the sandbox egress allowlist.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  await sql`alter table campaign_members
            add column if not exists discord_user_id text`;
  await sql`alter table campaign_members
            add column if not exists notify_on_turn boolean not null default true`;
  await sql`alter table campaign_members
            add column if not exists notify_on_dm boolean not null default true`;
  await sql`alter table campaign_members
            add column if not exists notify_on_chat boolean not null default false`;
  await sql`alter table campaign_members
            add column if not exists notify_on_ping boolean not null default true`;
  await sql`alter table campaign_members
            add column if not exists last_pinged_at timestamptz`;

  await sql`alter table campaign_settings
            add column if not exists discord_webhook_url text`;

  await sql`create table if not exists push_subscriptions (
              id uuid primary key default gen_random_uuid(),
              user_id uuid not null references users(id) on delete cascade,
              endpoint text not null,
              p256dh text not null,
              auth text not null,
              created_at timestamptz not null default now()
            )`;
  await sql`create unique index if not exists push_subscriptions_endpoint_idx
            on push_subscriptions (endpoint)`;

  const columns = await sql`
    select table_name, column_name
    from information_schema.columns
    where (table_name = 'campaign_members'
             and column_name in ('discord_user_id','notify_on_turn','notify_on_dm',
                                 'notify_on_chat','notify_on_ping','last_pinged_at'))
       or (table_name = 'campaign_settings' and column_name = 'discord_webhook_url')
       or table_name = 'push_subscriptions'
    order by table_name, column_name`;

  for (const c of columns) console.log(`  ${c.table_name}.${c.column_name}`);
  console.log(`\nok — ${columns.length} columns present`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
