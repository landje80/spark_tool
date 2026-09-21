import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// De app draait onder /tool. Assets krijgen daarom dat prefix (zie docs/architecture/system-design.md).
export default defineConfig({
  root: 'src/web',
  base: '/tool/',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/tool/api': 'http://localhost:3000', '/tool/auth': 'http://localhost:3000' },
  },
});
