import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.UI_PORT) || 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 3411}`, ws: true } },
  },
})
