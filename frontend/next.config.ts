import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack(config) {
    // Enable async WebAssembly support (required by libraw-wasm).
    // Production builds use webpack via 'next build --webpack' in package.json.
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/photos/**",
      },
      {
        protocol: "http",
        hostname: "minio",
        port: "9000",
        pathname: "/photos/**",
      },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
