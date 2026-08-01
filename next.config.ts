import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The rules engine reads the vendored SRD snapshot off disk rather than
   * making a database round trip for every lookup. The tracer cannot see
   * through `readFileSync(join(process.cwd(), ...))`, so the data has to be
   * declared explicitly or it would be missing from the deployed bundle.
   */
  outputFileTracingIncludes: {
    "/*": ["data/srd/**/*.json"],
  },
};

export default nextConfig;
