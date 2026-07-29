## What and why

<!-- What changes, and what problem it solves. Link an issue if there is one. -->

## Checks

- [ ] `pnpm test` and `npx tsc --noEmit` pass
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (skip for internal-only changes)
- [ ] Graph behaviour changes start in `lanes.ts` + its tests, not `GraphView.tsx`

## Performance

<!-- Performance is this project's top priority. If this touches the graph, a route,
     or the bundle, say what you measured — chunk size, route timing, row counts.
     "Not applicable" is a fine answer; "didn't check" on a hot path is not. -->

## Releasing

<!-- Only if this PR bumps the version: merging it publishes to npm and creates the
     GitHub release. `package.json` and the `## [x.y.z]` CHANGELOG heading must agree,
     or the release job aborts before publishing. -->
