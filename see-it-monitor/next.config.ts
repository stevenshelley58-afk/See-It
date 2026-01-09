import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: prevent Turbopack from inferring the wrong workspace root (which can drop routes)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
