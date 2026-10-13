import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node', restoreMocks: true }
})
