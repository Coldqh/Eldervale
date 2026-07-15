import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Eldervale/',
  define: { __APP_VERSION__: JSON.stringify('0.3.2') },
  build: { target: 'es2022', sourcemap: false },
});
