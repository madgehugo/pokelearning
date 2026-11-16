import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the UI runs on Vite (port 5173) and talks to the server's
// UI port through this proxy. `npm run build` output is served by the server itself.
const server = `127.0.0.1:${process.env.UI_PORT ?? 8766}`;

export default defineConfig({
  plugins: [react()],
  server: {
    // UI_HOST=0.0.0.0 opens the dev server to your phone too
    host: process.env.UI_HOST ?? "127.0.0.1",
    proxy: {
      "/api": `http://${server}`,
      "/ws": { target: `ws://${server}`, ws: true },
    },
  },
});
