/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Tauri: output as static files
  output: 'export',
  // Disable image optimization for static export
  images: { unoptimized: true },
  // Required for Tauri on Windows
  trailingSlash: true,
}

module.exports = nextConfig
