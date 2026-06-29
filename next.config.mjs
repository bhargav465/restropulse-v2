/** @type {import('next').NextConfig} */
const nextConfig = {
  // We render Replicate image URLs with plain <img> tags, so no
  // next/image remote host configuration is required.
  reactStrictMode: true,
};

export default nextConfig;
