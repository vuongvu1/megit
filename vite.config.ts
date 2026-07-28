import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.UI_PORT) || 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 3411}`, ws: true } },
  },
  test: {
    // test-repo/ is a generated git fixture, not this project's tests. It contains
    // a plausible-looking test/renderer.test.ts that vitest would otherwise collect
    // and run as part of the real suite.
    exclude: [...configDefaults.exclude, 'test-repo/**'],
  },
})
