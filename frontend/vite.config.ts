import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const version = process.env.PARLEY_VERSION ?? 'dev'

export default defineConfig({
  // version.json lets a long-open client notice the server now serves a newer build (UpdateBanner).
  plugins: [react(), tailwindcss(), { name: 'parley-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) }) } }],
  // Build version (scripts/version.mjs); 'dev' when built outside the release tooling.
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
      // MCP and its OAuth endpoints live at the site root (nginx forwards them the same way in production).
      '/mcp': { target: 'http://localhost:8080', changeOrigin: true },
      '/oauth/': { target: 'http://localhost:8080', changeOrigin: true },
      '/.well-known/oauth-': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
