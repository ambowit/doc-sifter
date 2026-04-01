import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/functions/v1": {
        target: "https://osxehjupsoqqmunxdrgj.supabase.co",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
