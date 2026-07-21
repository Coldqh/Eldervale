import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const appVersion = packageJson.version;
const buildTime = new Date().toISOString();

function versionManifest(): Plugin {
  return {
    name: "prospect-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: appVersion, builtAt: buildTime }, null, 2),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    versionManifest(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/prospect-mark.svg", "icons/prospect-192.png", "icons/prospect-512.png"],
      manifest: {
        name: "PROSPECT",
        short_name: "PROSPECT",
        description: "Симулятор жизни и карьеры профессионального спортсмена.",
        theme_color: "#050506",
        background_color: "#050506",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/prospect-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/prospect-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/prospect-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: true },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
});
