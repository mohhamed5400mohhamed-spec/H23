import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const isHmrDisabled = process.env.DISABLE_HMR === 'true';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      // HMR options configured cleanly to prevent developer websocket connection errors during preview
      hmr: isHmrDisabled
        ? false
        : {
            clientPort: process.env.APP_URL?.startsWith('https') ? 443 : undefined,
            protocol: process.env.APP_URL?.startsWith('https') ? 'wss' : 'ws',
          },
      watch: isHmrDisabled ? null : {},
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          admin: path.resolve(import.meta.dirname, 'admin.html'),
        },
        output: {
          manualChunks(id) {
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (
              id.includes('node_modules/socket.io-client/') ||
              id.includes('node_modules/engine.io-client/')
            ) {
              return 'vendor-socket';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'vendor-icons';
            }
          },
        },
      },
    },
  };
});
