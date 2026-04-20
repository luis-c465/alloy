import { defineConfig } from "vite";
import { reactCompilerPreset } from "@vitejs/plugin-react";

import path from "path";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [reactCompilerPreset(), tailwindcss()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/]react(?:-dom)?[\\/]/,
              priority: 50,
            },
            {
              name: "vendor-codemirror",
              test: /node_modules[\\/](?:@codemirror|@uiw[\\/]react-codemirror)[\\/]/,
              priority: 45,
            },
            {
              name: "vendor-ui",
              test: /node_modules[\\/]radix-ui[\\/]/,
              priority: 40,
            },
            {
              name: "vendor-query",
              test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              priority: 35,
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]@tabler[\\/]icons-react[\\/]/,
              priority: 30,
            },
          ],
        },
      },
    },
  },
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
