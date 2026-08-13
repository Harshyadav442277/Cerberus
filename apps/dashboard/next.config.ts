import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are TypeScript source; transpile them if imported later.
  transpilePackages: [],
  // The dev overlay badge sits over the sidebar and shows up in demo screenshots
  // and the recorded walkthrough. Nothing about the demo needs it.
  devIndicators: false,
};

export default nextConfig;
