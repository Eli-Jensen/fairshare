import { defineConfig } from 'vitest/config'

// Rules tests need the firestore emulator — run via `npm run test:rules`
// (firebase emulators:exec), never as part of the plain `npm test` suite
// (vite.config.ts scopes that include to src/ and functions/src).
export default defineConfig({
  test: {
    include: ['rules-tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // One file at a time. The suites use distinct emulator project ids, but
    // running both against the single emulator process concurrently still
    // produced intermittent "Null value error" rules evaluations (seeded
    // docs unreadable mid-eval). Serial is +3s and deterministic.
    fileParallelism: false,
  },
})
