import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Trimmed: a secret pasted with a trailing newline is rejected by the server.
  // Only a fallback now: a station authenticates with its own credential, which
  // a signed-in dashboard hands it, and uses this shared secret only until then
  // (and only while the server still accepts it). It ships inside the public
  // installer, so it is never a secret worth more than that transition.
  const printClaimSecret = (env.PRINT_CLAIM_SECRET ?? process.env.PRINT_CLAIM_SECRET ?? "").trim();
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
