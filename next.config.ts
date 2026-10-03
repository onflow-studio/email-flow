import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Dockerfile sets STANDALONE_BUILD=1 to get a self-contained server in .next/standalone.
  // Elsewhere it stays off: Vercel builds through its own adapter, and `next start` warns on standalone output.
  ...(process.env.STANDALONE_BUILD === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
