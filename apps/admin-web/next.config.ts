import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agenttag/config", "@agenttag/db", "@agenttag/domain", "@agenttag/memory"],
};

export default nextConfig;
