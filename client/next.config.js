/** @type {import('next').NextConfig} */
const path = require('path');
// import { SERVER_URL } from "@/utils/commonHelper";
// const server_url = require("../utils/commonHelper");
const nextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      // {
      //   source: "/api/speech/:path*",
      //   destination: `${server_url}/api/speech/:path*`,
      // },
    ];
  },
  // Enable React Strict Mode
  reactStrictMode: true,
  // Configure images if needed
  images: {
    domains: ['*'],
  },
  // Output directory for the build
  distDir: '.next',
  // Enable static HTML export
  output: 'standalone',
  // Enable server components
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID,
  },
};

module.exports = nextConfig;
