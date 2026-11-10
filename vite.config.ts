import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5388, strictPort: true },
  publicDir: 'public',
  build: { target: 'es2022', assetsInlineLimit: 0 }
});
