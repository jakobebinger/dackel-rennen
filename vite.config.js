import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// host: true -> auch im WLAN erreichbar (zum Testen auf dem Handy)
// "npm run datei" (mode "datei") packt das ganze Spiel in EINE html-Datei zum Verschicken
export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: true, open: true },
  plugins: mode === 'datei' ? [viteSingleFile()] : [],
  build: {
    chunkSizeWarningLimit: 800, // three.js ist einfach groß
    ...(mode === 'datei' ? { outDir: 'export', emptyOutDir: true } : {}),
  },
}));
