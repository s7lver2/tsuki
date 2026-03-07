/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Tauri: output as static files
  output: 'export',
  // Disable image optimization for static export
  images: { unoptimized: true },
  // Required for Tauri on Windows
  trailingSlash: true,
  // Allow dynamic import() of the tsuki-sim WASM JS glue from /public
  // wasm-pack --target web generates a standard ES module; webpack needs
  // asyncWebAssembly to load the .wasm binary it references.
  webpack(config) {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    }
    config.module.rules.push({
      test: /src-tauri\/target/,
      type: 'asset/resource'
    });
    // Allow importing .tsuki-circuit files as JSON
    config.module.rules.push({
      test: /\.tsuki-circuit$/,
      type: 'json',
    });
    return config
  },
  experimental: {
    outputFileTracingExcludes: {
      '*': ['src-tauri/**'],
    },
  },
}

module.exports = nextConfig