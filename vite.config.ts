import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5388,
    strictPort: true,
    watch: {
      // Chrome DevTools profiles (tools/cdp.mjs) and build output live inside
      // the project; the default watcher chokes on their locked files with
      // EBUSY and takes the dev server down with it.
      ignored: ['**/.cache/**', '**/dist/**', '**/reports/**', '**/node_modules/**']
    }
  },
  publicDir: 'public',
  build: { target: 'es2022', assetsInlineLimit: 0 }
});
