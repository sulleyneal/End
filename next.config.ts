import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rules engine and every dice roll live server-side by construction; nothing
  // in `src/rules` or `src/db` should ever be reachable from a client bundle.
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
