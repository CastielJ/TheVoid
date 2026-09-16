import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Phase 0: proxy tRPC calls to the local Fastify server so the client
      // can be developed against a real backend without CORS configuration.
      "/trpc": "http://localhost:3000",
      // Phase 6: same reasoning, extended to the WebSocket upgrade route.
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
