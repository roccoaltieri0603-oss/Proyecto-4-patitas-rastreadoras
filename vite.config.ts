import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
    plugins: [
      react(),
    ],
    server: {
      proxy: {
        "/api/auth": "http://localhost:3001",
        "/api/establecimiento": "http://localhost:3001",
        "/api/lotes": "http://localhost:3001",
        "/api/copernicus": "http://localhost:3001",
        "/api/notificaciones": "http://localhost:3001",
        "/api/health": "http://localhost:3001",
      },
    },
  }));
