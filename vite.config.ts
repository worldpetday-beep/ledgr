import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,traineddata}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Ledgr — Sales & Inventory',
        short_name: 'Ledgr',
        description: 'Offline sales ledger and inventory manager for your store.',
        theme_color: '#2a78d6',
        background_color: '#f9f9f7',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
