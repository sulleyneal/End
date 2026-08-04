/**
 * Routes Node's `fetch` through the sandbox egress proxy.
 *
 * Neon's serverless driver talks HTTP, and Node's `fetch` ignores `HTTPS_PROXY`
 * — so inside the sandbox every query leaves by a route the egress allowlist
 * rejects, and the app fails at sign-in with a 403 that reads like a Neon
 * outage. curl reaching the same host is the tell that it is the client, not
 * the network.
 *
 * Loaded via `--import`, so the dispatcher is installed before Next opens a
 * connection:
 *
 *   NODE_OPTIONS='--import ./scripts/sandbox-proxy.mjs' npm run dev
 *
 * A no-op wherever `HTTPS_PROXY` is unset, which includes Vercel — production
 * connects to Neon directly and must not be pushed through anything.
 */
import { readFileSync } from "node:fs";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const CA = "/root/.ccr/ca-bundle.crt";

if (proxy) {
  let ca;
  try {
    ca = readFileSync(CA);
  } catch {
    // Without the sandbox CA the proxy's TLS interception cannot be verified.
    // Failing loudly beats disabling verification.
    console.error(`sandbox-proxy: ${CA} is missing; leaving fetch alone.`);
  }
  if (ca) {
    setGlobalDispatcher(new ProxyAgent({ uri: proxy, requestTls: { ca } }));
  }
}
