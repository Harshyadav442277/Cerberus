import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript source; transpile them if imported later.
  transpilePackages: [],
};

export default nextConfig;
