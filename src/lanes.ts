export type LaneRow = {
  lane: number
  incoming: number[]
  outgoing: number[]
  through: number[]
}

// Greedy top-down lane assignment over topo-ordered commits.
// `expect[i]` = the commit hash lane i is waiting to reach (a parent of
// something above), or null if the lane is free.
// `reserve` (the HEAD commit, when WIP/stash connectors anchor to it) pins the
// first `nRes` lanes: rows above it can neither claim nor cross them, so each
// dotted connector gets its own straight run down into the checked-out branch,
// GitKraken-style (lane 0 = WIP, then one lane per HEAD-based stash).
// Reservations are not drawn lines — they never appear in through/incoming.
export function layout(commits: { hash: string; parents: string[] }[], reserve?: string, nRes = 1): { rows: LaneRow[]; maxLanes: number } {
  const expect: (string | null)[] = []
  let seeded = reserve !== undefined && nRes > 0 && commits.some(c => c.hash === reserve)
  if (seeded) for (let i = 0; i < nRes; i++) expect[i] = reserve!
  let maxLanes = 0
  const rows = commits.map(c => {
    const hit = seeded && c.hash === reserve
    if (hit) seeded = false
    const incoming: number[] = []
    expect.forEach((h, i) => { if (h === c.hash && !(hit && i < nRes)) incoming.push(i) })
    if (hit) for (let i = 0; i < nRes; i++) expect[i] = null

    let lane = hit ? 0 : incoming.length ? incoming[0] : expect.indexOf(null, seeded ? nRes : 0)
    if (lane === -1) lane = expect.length

    const through: number[] = []
    expect.forEach((h, i) => { if (h !== null && h !== c.hash && i !== lane && !(seeded && i < nRes)) through.push(i) })

    for (const i of incoming) expect[i] = null
    const outgoing: number[] = []
    if (c.parents.length) {
      expect[lane] = c.parents[0]
      outgoing.push(lane)
      for (const p of c.parents.slice(1)) {
        let t = expect.indexOf(p, seeded ? nRes : 0)
        if (t === -1) {
          t = expect.indexOf(null, seeded ? nRes : 0)
          if (t === -1) t = expect.length
          expect[t] = p
        }
        outgoing.push(t)
      }
    } else {
      expect[lane] = null
    }

    maxLanes = Math.max(maxLanes, expect.length, lane + 1)
    while (expect.length && expect[expect.length - 1] === null) expect.pop()
    return { lane, incoming, outgoing, through }
  })
  return { rows, maxLanes }
}

// First lane a dotted stash connector can run down rows[from..to] without
// crossing solid graph lines. `to` is the base commit's row: only its top-half
// traffic (through/incoming) blocks, so a stash directly above a quiet base
// shares the base's lane. `taken` holds lanes claimed by other dotted spans
// overlapping this one (other stashes, the WIP connector).
export function freeLane(rows: LaneRow[], from: number, to: number, taken: number[]): number {
  const busy = (l: number) =>
    rows[to].through.includes(l) || rows[to].incoming.includes(l) ||
    rows.slice(from, to).some(r =>
      r.lane === l || r.through.includes(l) || r.incoming.includes(l) || r.outgoing.includes(l))
  let l = 0
  while (taken.includes(l) || busy(l)) l++
  return l
}
