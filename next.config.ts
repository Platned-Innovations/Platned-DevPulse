import type { NextConfig } from "next";

const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const config: NextConfig = {
  // Self-contained server bundle for Azure zip deploys / Docker (`npm run build:standalone`).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  serverExternalPackages: ["pg", "mongodb"],
  poweredByHeader: false,
  // Only needed when a proxy/custom domain rewrites the Host header (e.g. "app.example.com").
  experimental: origins.length ? { serverActions: { allowedOrigins: origins } } : undefined,
};

export default config;
