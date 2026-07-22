export type LaneRow = {
  lane: number
  incoming: number[]
  outgoing: number[]
  through: number[]
}

// Greedy top-down lane assignment over topo-ordered commits.
// `expect[i]` = the commit hash lane i is waiting to reach (a parent of
// something above), or null if the lane is free.
export function layout(commits: { hash: string; parents: string[] }[]): { rows: LaneRow[]; maxLanes: number } {
  const expect: (string | null)[] = []
  let maxLanes = 0
  const rows = commits.map(c => {
    const incoming: number[] = []
    expect.forEach((h, i) => { if (h === c.hash) incoming.push(i) })

    let lane = incoming.length ? incoming[0] : expect.indexOf(null)
    if (lane === -1) lane = expect.length

    const through: number[] = []
    expect.forEach((h, i) => { if (h !== null && h !== c.hash && i !== lane) through.push(i) })

    for (const i of incoming) expect[i] = null
    const outgoing: number[] = []
    if (c.parents.length) {
      expect[lane] = c.parents[0]
      outgoing.push(lane)
      for (const p of c.parents.slice(1)) {
        let t = expect.indexOf(p)
        if (t === -1) {
          t = expect.indexOf(null)
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
