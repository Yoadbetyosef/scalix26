import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Map the "@/..." path alias (from tsconfig) so unit tests can import project modules.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
})
