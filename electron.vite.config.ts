import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": resolve("src"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": resolve("src"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src"),
        "@resources": resolve("resources"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
