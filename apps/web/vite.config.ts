import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      manifest: {
        name: 'Kraków bez granic', short_name: 'Bez granic', lang: 'pl', display: 'standalone',
        start_url: '/', background_color: '#ffffff', theme_color: '#1d4ed8',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Nawigacja do /api/* i /photos/* nie może dostać index.html z cache.
        navigateFallbackDenylist: [/^\/api\//, /^\/photos\//],
        // Tylko GET z danymi; POST-y i zdjęcia nie są cache'owane.
        runtimeCaching: [
          { urlPattern: /\/api\/(features|states|profiles)$/, handler: 'NetworkFirst', method: 'GET', options: { cacheName: 'kbg-data', networkTimeoutSeconds: 4 } },
        ],
      },
    }),
  ],
  server: { host: true, proxy: { '/api': 'http://localhost:3000', '/photos': 'http://localhost:3000' } },
});
