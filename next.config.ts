import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Prompts are read from disk at runtime, so file tracing can't see them.
  outputFileTracingIncludes: { "/**": ["./prompts/**"] },
  experimental: {
    agentUpgrade: "security",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
      { protocol: "https", hostname: "avatar.vercel.sh", pathname: "/**" },
    ],
  },
};

export default nextConfig;
