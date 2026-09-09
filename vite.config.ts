import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/football-game/" : "/",
  server: { port: 5173, open: false },
  build: { target: "es2022" },
}));
