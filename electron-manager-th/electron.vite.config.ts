import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";

const projectRoot = realpathSync(process.cwd());

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("electron/main.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("electron/preload.ts") } },
  },
  renderer: {
    root: projectRoot,
    server: { watch: { ignored: ["**/dist*/**", "**/*.exe", "**/*.blockmap", "**/out/**"] } },
    plugins: [react()],
    build: { rollupOptions: { input: resolve(projectRoot, "index.html") } },
  },
});
