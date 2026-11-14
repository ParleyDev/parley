import { defineConfig } from 'vitest/config'

// Unit tests of the pure modules (no browser): `npm test`.
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })
