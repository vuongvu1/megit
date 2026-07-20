# Draggable Repo Tabs — Design

**Date:** 2026-07-19
**Status:** Approved

## Goal

Let the user reorder repo tabs in the tab bar by dragging, with the order
persisted in the server-side config so it survives reloads and restarts.

## Approach

Native HTML5 drag-and-drop (`draggable` + drag events). No new dependencies.
Considered and rejected: dnd-kit (new dependency for a single tab bar),
hand-rolled pointer events (~80 lines of positioning math for marginal gain).

## Client

### TabBar.tsx

- Each tab element gets `draggable`.
- New props: `onReorder(from: number, to: number)` and `onReorderEnd()`.
- `onDragStart` on a tab records its index in local state and sets
  `dataTransfer.effectAllowed = 'move'`.
- `onDragOver` on a tab calls `e.preventDefault()`; if the hovered index
  differs from the dragged index, call `onReorder(dragIdx, hoverIdx)` and
  update the local drag index — tabs shuffle live while dragging.
- `onDragEnd` clears drag state and calls `onReorderEnd()`.
- The dragged tab gets a `dragging` class (dimmed via CSS).
- Existing behavior unchanged: click selects, `×` closes, `+` adds.

### App.tsx

- `reorder(from, to)`: splice `cfg.repos` and `setCfg` — optimistic, no
  network call during drag.
- `reorderEnd()`: `PUT /api/repos/order` with `{ repos: cfg.repos }`;
  response replaces `cfg`.

## Server

### `PUT /api/repos/order` (server/index.ts)

- Body: `{ repos: string[] }`.
- Validate the incoming array is an exact permutation of the current
  `cfg.repos`: compare the two arrays sorted (multiset equality, so
  duplicates are rejected too). Reject with 400 otherwise, leaving config
  untouched.
- Rationale: the config is a trust boundary. Accepting arbitrary arrays
  would let a client inject repo paths without the git-repo check enforced
  by `POST /api/repos`.
- On success: `cfg.repos = body.repos`, `saveConfig(cfg)`, respond with the
  full config (matches existing endpoints).

## Error handling

- Invalid order → 400; client keeps its optimistic local order for the
  session; a reload restores server truth. No user-facing error UI.

## Testing

- One Vitest case for the permutation validation (valid reorder accepted;
  wrong members / wrong length rejected).
- End-to-end drag verification via the project `verify` skill after
  implementation.
