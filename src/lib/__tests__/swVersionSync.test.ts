import { describe, it, expect } from 'vitest'
// ?raw keeps this inside Vite's module graph — no node:fs, so the app
// tsconfig (browser lib, no @types/node) type-checks it as-is.
import pkgRaw from '../../../package.json?raw'
import viteConfigRaw from '../../../vite.config.ts?raw'

/**
 * The generated service worker (vite.config.ts) loads the Firebase COMPAT
 * bundles from the gstatic CDN — a separate copy of the SDK from the app's —
 * and hardcodes their version in `const SDK = '...'`. If a dependency bump
 * moves `firebase` in package.json without moving that constant, the worker
 * ships a mismatched SDK with no error anywhere. This test is what turns a
 * Dependabot firebase PR red until both move together.
 */
describe('service worker SDK version', () => {
  it('matches the firebase dependency in package.json', () => {
    const pkg = JSON.parse(pkgRaw) as { dependencies: Record<string, string> }
    const declared = pkg.dependencies.firebase.replace(/^[\^~]/, '')
    const m = viteConfigRaw.match(/const SDK = '([^']+)'/)
    expect(m, "vite.config.ts should declare `const SDK = '<version>'`").not.toBeNull()
    expect(m![1]).toBe(declared)
  })
})
