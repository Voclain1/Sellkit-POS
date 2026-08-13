import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate reloads the page as soon as a new
      // service worker takes control, which at a till would discard an in-progress
      // cart. The new worker waits until the cashier accepts the update instead.
      registerType: 'prompt',
      injectRegister: null, // registered explicitly in src/lib/pwa.ts
      includeAssets: ['favicon.svg', 'app-icon.svg', 'apple-touch-icon.png'],

      manifest: {
        id: '/',
        name: 'Sellkit POS',
        short_name: 'Sellkit',
        description:
          'Offline-first point of sale for retail counters — scan, checkout, and print 80mm receipts with or without a connection.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#080c17',
        theme_color: '#0f1524',
        categories: ['business', 'productivity', 'shopping'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // The app shell: everything needed to boot the till with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        cleanupOutdatedCaches: true,
        // SPA deep links fall back to the shell, but API calls must always hit
        // the network — a cached /api response would be stale stock or prices.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },

      devOptions: {
        // Off by default: a service worker caching during development makes
        // HMR results confusing. Test the real thing with `npm run preview`.
        enabled: false,
      },
    }),
  ],
})
