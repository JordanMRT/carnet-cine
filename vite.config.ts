import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Le "base" doit correspondre au nom du repo GitHub si déployé sur
// https://<utilisateur>.github.io/<repo>/ — sinon laisser '/'.
// Modifie la valeur ci-dessous avant de déployer sur GitHub Pages.
const REPO_BASE = '/';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? REPO_BASE : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'ReTrack',
        short_name: 'ReTrack',
        description: 'Suivi de séries et films, remplaçant de TV Time.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Cache l'app shell ; les données viennent de Supabase (réseau),
        // avec le cache offline géré côté client Supabase/IndexedDB local.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ]
});
