# Contributing

## Setup

Node ≥ 24 and pnpm. The server runs TypeScript directly via Node's native type-stripping, so there is no build step in development.

```bash
pnpm install
pnpm dev        # Express API on :4500 + Vite dev server on :4000 (proxies /api)
```

With nvm, `nvm use` does not persist across shells — `.nvmrc` pins 24.

## Before opening a PR

```bash
pnpm test           # vitest
npx tsc --noEmit    # typecheck
pnpm build          # catches anything the dev server tolerates
```

CI runs all of this on Linux, macOS and Windows, plus `pnpm build:server` and a smoke test of the CLI entrypoint.

`scripts/make-test-repo.sh` regenerates `test-repo/` — a throwaway fixture with interleaved branches, merges, two stashes and a dirty worktree. It is git-ignored, safe to delete, and is what the README screenshots are taken from. Note that vitest is configured to exclude it: the fixture contains a plausible-looking `test/renderer.test.ts` that would otherwise be collected into the real suite.

## Things worth knowing

**Performance is the top priority.** Concretely: heavy dependencies belong in lazy `React.lazy`/`import()` chunks (xterm.js is the precedent), server-side natives load via dynamic `import()` on first use, and `/api/graph` has to stay fast on 10k-commit repositories. Commits page in 200 at a time; don't raise that without measuring. Measure before claiming — `curl -w '%{time_total}'` on API routes, `pnpm build` chunk sizes, DOM row counts in the browser.

**`lanes.ts` is the graph.** It is a pure, unit-tested layout module: `layout()` does greedy top-down lane assignment, with a reservation mechanism that pins the leftmost lanes for WIP and stash connectors. `GraphView.tsx` should stay a dumb renderer of the `LaneRow`s it produces. When changing graph behaviour, change `lanes.ts` and its tests first.

The same applies to the other pure modules — `search.ts`, `rowNav.ts`, `branchMenu.ts`, `parse.ts`. Logic that can live in one of those, and be tested without a DOM or a git repository, should.

**Don't add a dependency for what a few lines can do.** The runtime dependency list is deliberately three packages. Anything the client bundles belongs in `devDependencies`, since Vite inlines it into `dist/`.

**`~/.config/megit/config.json` is real user state.** If you register a repository while testing, remove it again.

## Branch protection

`main` requires a pull request, a linear history, and green CI on all three platforms before merge. Force-pushes and deletions are refused. Because the release job triggers on `main` moving, that protection is also what stops an accidental publish.

## Releasing

`main` is protected: everything lands through a pull request. Releases follow from that — when a merge to `main` leaves a `package.json` version that isn't on npm yet, CI publishes it, tags the merge commit, and opens a GitHub release from the matching `CHANGELOG.md` section. There is no tag to push and no manual publish step.

To cut a release, open a normal PR that bumps the version:

```bash
git switch -c release/0.2.0
npm version 0.2.0 --no-git-tag-version
$EDITOR CHANGELOG.md          # add "## [0.2.0] - YYYY-MM-DD"; the heading must exist
git commit -am "chore: release 0.2.0"
git push -u origin release/0.2.0
gh pr create --fill
```

Merge it and the release happens. A version containing a hyphen (`0.2.0-beta.1`) is published as a prerelease.

The release job is idempotent, and asks two questions independently: *is this version on npm?* and *does a GitHub release exist for the tag?* Each half runs only if its own answer is no. Merging docs, re-running the workflow, or reverting and re-merging all no-op rather than failing or double-publishing. It aborts before publishing if `CHANGELOG.md` has no section for the version.

The two are decoupled because they fail separately. A publish can succeed while tagging dies, or a version can reach npm by hand — and if the release step were tied to the publish step, neither case would ever heal: the gate would see the version on npm and skip everything, forever. Split, the next push to `main` finishes whatever is missing.

npm goes first, because it is the half that cannot be undone.

One-time setup: register this repository as a **[trusted publisher](https://docs.npmjs.com/trusted-publishers)** for `megit-app` on npmjs.com — package settings → Publishing access → GitHub Actions, naming the repo and `release.yml`. There is no `NPM_TOKEN` secret to create or rotate: npm exchanges the OIDC identity the job requests (`id-token: write`) for a short-lived credential, and provenance is attested automatically. `GITHUB_TOKEN` covers the release step.

Why not a token: npm revoked classic tokens and disabled generating new ones in November 2025, and a classic *publish* token could never have worked here anyway — under 2FA it demands a one-time password, which fails in CI as `npm error code EOTP` only after the build has already run. Granular access tokens still work but now expire in 7 days by default (90 max), which means rotating a secret every week to publish a few times a year.

## Commit messages

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Nothing is enforced by tooling.
