import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake named imports from icon/UI barrels so only the components
  // actually used land in the client bundle (lucide-react alone ships hundreds
  // of icons). Next folds these into per-icon imports at build time.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
