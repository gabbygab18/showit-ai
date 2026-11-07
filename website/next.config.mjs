import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The site lives inside the app's repo; build from this folder, not the parent (which has its own lockfile).
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};
export default nextConfig;
