#!/usr/bin/env node
// Prep a release: bump package.json's version and roll the CHANGELOG's
// [Unreleased] bucket into a dated version heading. Invoked by `make release
// VERSION=x.y.z`, which then commits and tags. See CLAUDE.md → "Versioning &
// releases". Run from the repo root.
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.mjs <major.minor.patch>')
  process.exit(1)
}

// 1. Bump package.json (keep 2-space indent + trailing newline)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version === version) {
  console.error(`package.json is already at ${version}.`)
  process.exit(1)
}
pkg.version = version
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

// 2. Move everything under [Unreleased] into a new dated [version] heading,
//    leaving a fresh empty [Unreleased] on top.
const date = new Date().toISOString().slice(0, 10)
const changelog = readFileSync('CHANGELOG.md', 'utf8')
if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no "## [Unreleased]" section — aborting.')
  process.exit(1)
}
writeFileSync(
  'CHANGELOG.md',
  changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${date}`),
)

console.log(`Prepped v${version}: package.json bumped, CHANGELOG dated ${date}.`)
