import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const printClaimSecret = env.PRINT_CLAIM_SECRET ?? process.env.PRINT_CLAIM_SECRET ?? "";
  const scanbyApiUrl =
    env.SCANBY_API_URL ?? process.env.SCANBY_API_URL ?? "https://app.scanby.cloud";

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        "process.env.PRINT_CLAIM_SECRET": JSON.stringify(printClaimSecret),
        "process.env.SCANBY_API_URL": JSON.stringify(scanbyApiUrl),
      },
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
  };
});
