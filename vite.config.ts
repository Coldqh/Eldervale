import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  base: '/Eldervale/',
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  build: { target: 'es2022', sourcemap: false },
});
