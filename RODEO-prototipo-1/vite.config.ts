import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import copernicus from "./vite-plugin-copernicus";

export default defineConfig({
  plugins: [react(), copernicus()],
});
