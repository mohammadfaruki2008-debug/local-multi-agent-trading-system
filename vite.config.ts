import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  preview: {
    allowedHosts: [
      "local-multi-agent-trading-system.onrender.com", // আপনার Render হোস্ট
      ".onrender.com" // (ঐচ্ছিক) Render-এর সব সাবডোমেইন অনুমোদন করতে
    ]
  }
});
