import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        // the floor planner app (root) + the standalone cabinet CAD page
        main: entry('./index.html'),
        cad: entry('./cad/index.html'),
      },
    },
  },
});
