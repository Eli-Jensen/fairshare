import { defineConfig } from 'vitest/config'

// Rules tests need the firestore emulator — run via `npm run test:rules`
// (firebase emulators:exec), never as part of the plain `npm test` suite
// (vite.config.ts scopes that include to src/ and functions/src).
export default defineConfig({
  test: {
    include: ['rules-tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
})
