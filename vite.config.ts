import { defineConfig } from "vite";

export default defineConfig({
  base: "/quakevolve/",
  server: {
    open: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
