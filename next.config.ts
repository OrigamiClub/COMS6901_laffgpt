import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB body limit, too small for photo uploads.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
