// Slice one version's section out of CHANGELOG.md, for `gh release create --notes-file`.
// Usage: node scripts/release-notes.mjs 0.1.0 > notes.md
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: release-notes.mjs <version>')
  process.exit(1)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

// Sections look like `## [0.1.0] - 2026-07-28`; capture through to the next `## [`
// heading or end of file. Escaped because a version is full of dots.
//
// Deliberately no `m` flag: it would make the `$` in the lookahead mean end-of-line,
// so the match would stop at the heading and capture nothing. The start anchor is
// spelled `(?:^|\n)` instead.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The last section runs to EOF, where Keep a Changelog puts its link-reference
// definitions (`[0.1.0]: https://...`) — stop before those too, or they land in
// the release body as stray text.
const section = changelog.match(
  new RegExp(`(?:^|\\n)## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[[^\\]\\n]+\\]:|$)`),
)

if (!section) {
  console.error(`release-notes: no "## [${version}]" section in CHANGELOG.md`)
  process.exit(1)
}

const body = section[1].trim()
if (!body) {
  console.error(`release-notes: the "## [${version}]" section is empty`)
  process.exit(1)
}

process.stdout.write(body + '\n')
