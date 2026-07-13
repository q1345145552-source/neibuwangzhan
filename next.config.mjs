/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
