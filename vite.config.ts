import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// De app draait op de root van zijn eigen (sub)domein, geen gedeeld subpad meer (zie
// docs/architecture/system-design.md). Draait de app ooit weer onder een subpad, zet dan
// zowel `base` hieronder als APP_BASE_PATH (src/config/env.ts) naar dat subpad.
export default defineConfig({
  root: 'src/web',
  base: '/',
  plugins: [react()],
  // Bouwen gaat via scripts/build/build-web.mjs (`npm run build:web`), dat NODE_ENV=production afdwingt.
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    // Trailing slash is bewust: '/api' (zonder slash) zou als voorvoegsel ook het eigen
    // frontendbestand src/web/api.ts matchen (geserveerd op /api.ts) en dat abusievelijk naar
    // de backend doorsturen, die er dan de SPA-HTML voor teruggeeft in plaats van de JS-module.
    proxy: { '/api/': 'http://localhost:3000', '/auth/': 'http://localhost:3000' },
  },
});
