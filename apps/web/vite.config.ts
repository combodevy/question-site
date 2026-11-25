import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const REPO_ROOT = path.resolve(__dirname, '../..');

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

function serveRootStaticPlugin(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawUrl = (req.url || '/').split('?')[0];
    if (
      !rawUrl.startsWith('/english/') &&
      !rawUrl.startsWith('/fonts/') &&
      !rawUrl.startsWith('/media/')
    ) {
      next();
      return;
    }
    const rel = decodeURIComponent(rawUrl).replace(/^\/+/, '');
    const resolved = path.resolve(REPO_ROOT, rel);
    if (!resolved.startsWith(REPO_ROOT)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        const ext = path.extname(resolved).toLowerCase();
        res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
        fs.createReadStream(resolved).pipe(res);
        return;
      }
    } catch {
      // fall through
    }
    next();
  };

  return {
    name: 'serve-repo-root-static',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    serveRootStaticPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      filename: 'sw.js',
      includeAssets: [],
      manifest: {
        name: '在线刷题系统 (Question Site)',
        short_name: '刷题系统',
        start_url: '/index.html',
        display: 'standalone',
        background_color: '#F7F6F2',
        theme_color: '#0F766E',
        description: '离线优先的在线题库与智能刷题系统',
        icons: [
          {
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230F766E' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'/%3E%3C/svg%3E",
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\.html/, /^\/admin$/, /^\/english\//, /^\/fonts\//, /^\/media\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/admin.html', '**/assets/admin-*.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@qs/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/dexie')) {
            return 'vendor-dexie';
          }
          if (id.includes('node_modules/pinyin-pro')) {
            return 'vendor-pinyin';
          }
          return undefined;
        },
      },
    },
  },
});
