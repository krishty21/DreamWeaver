import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Tree-shake per-icon imports from lucide-react so only the icons actually
  // used in a route ship to the client (lucide-react exports ~1500 icons as
  // a flat module — without this hint the whole package can end up scanned
  // even though Tailwind/Next tree-shake most of it). This is the
  // well-known-safe optimization recommended by the lucide-react docs.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
