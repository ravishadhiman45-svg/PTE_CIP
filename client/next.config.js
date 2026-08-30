/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Kanban board used to live at /learning-plan. It is now one section of
  // the wider Learning Module page, so keep the old path working rather than
  // 404ing anyone's bookmark.
  async redirects() {
    return [{ source: '/learning-plan', destination: '/learning-module', permanent: false }];
  },
  // Google Identity Services opens a popup and posts the credential back to this
  // window. The browser's default COOP blocks that postMessage, so opt into the
  // one value GSI needs — strict enough to isolate us from unrelated origins,
  // loose enough to keep the opener reference for popups we open ourselves.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' }],
      },
    ];
  },
  // NOTE: there used to be a `config.cache = { type: 'memory' }` override here,
  // added when the project lived inside OneDrive and its syncing corrupted
  // webpack's *.pack.gz files. The repo now sits at C:\dev\ptecip, outside
  // OneDrive, and the override had become actively harmful: with the memory
  // cache the server compiler stopped emitting some vendor chunks (notably
  // vendor-chunks/swr.js) while still referencing them, so every dynamic route
  // 500'd with MODULE_NOT_FOUND as soon as Next's static-paths worker required
  // the compiled page. Webpack's default filesystem cache is correct here.
};

module.exports = nextConfig;
