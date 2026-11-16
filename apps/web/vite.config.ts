import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API runs separately on port 3001.
    proxy: { "/api": "http://localhost:3001" },
  },
});
