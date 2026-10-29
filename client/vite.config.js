import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// TODO: CONFIGURE HERE - change BACKEND_URL if the backend PORT in .env is not 3001.
const BACKEND_URL = 'http://127.0.0.1:3001';

// The dev server listens on localhost only. For a second device on the network, build the
// app and let the backend serve it (see README, "Configuration B").
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': BACKEND_URL,
      '/media': BACKEND_URL,
      '/socket.io': { target: BACKEND_URL, ws: true },
    },
  },
});
