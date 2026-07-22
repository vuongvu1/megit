import { describe, it, expect } from 'vitest'
import { layout, freeLane, stashSlot, activeTrail } from './lanes.ts'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

describe('layout', () => {
  it('linear history stays in lane 0', () => {
    const { rows, maxLanes } = layout([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 0, 0])
    expect(maxLanes).toBe(1)
    expect(rows[2]).toEqual({ lane: 0, incoming: [0], outgoing: [], through: [] })
  })

  it('branch opens a second lane and converges at the fork point', () => {
    // main: a-b-d   feature: a-c   topo order: d c b a
    const { rows, maxLanes } = layout([c('d', 'b'), c('c', 'a'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 1, 0, 0])
    expect(rows[1].through).toEqual([0])
    expect(rows[3].incoming).toEqual([0, 1]) // both lines converge into 'a'
    expect(maxLanes).toBe(2)
  })

  it('merge commit opens a lane for its second parent', () => {
    // m merges b and c; both branch from a
    const { rows } = layout([c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')])
    expect(rows[0]).toEqual({ lane: 0, incoming: [], outgoing: [0, 1], through: [] })
    expect(rows[2].lane).toBe(1)
    expect(rows[3].incoming).toEqual([0, 1])
  })

  it('octopus merge opens a lane per extra parent', () => {
    const { rows, maxLanes } = layout([c('m', 'a', 'b', 'x'), c('a'), c('b'), c('x')])
    expect(rows[0].outgoing).toEqual([0, 1, 2])
    expect(maxLanes).toBe(3)
    expect(rows[1].through).toEqual([1, 2])
  })

  it('frees lanes for reuse after a root commit', () => {
    // two independent roots: second root reuses lane 0
    const { rows } = layout([c('b'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 0])
  })
})

describe('layout with a reserved lane', () => {
  it('keeps lane 0 clear above the reserved commit', () => {
    // side branch t1-t2 forked from HEAD 'm' sits above it in topo order —
    // without the reservation the branch would grab lane 0
    const { rows, maxLanes } = layout([c('t2', 't1'), c('t1', 'm'), c('m', 'a'), c('a')], 'm')
    expect(rows.map(r => r.lane)).toEqual([1, 1, 0, 0])
    expect(rows[0].through).toEqual([]) // the reservation is not a drawn line
    expect(rows[2].incoming).toEqual([1]) // branch converges into HEAD from lane 1
    expect(maxLanes).toBe(2)
    expect(freeLane(rows, 0, 2, [])).toBe(0) // WIP connector runs straight down
  })

  it('routes a merge link around the reserved lane', () => {
    // child merge 'm' above HEAD 'c' — its second-parent link would otherwise
    // run down HEAD's own lane; reserved, it detours to lane 2
    const { rows } = layout([c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')], 'c')
    expect(rows.map(r => r.lane)).toEqual([1, 1, 0, 0])
    expect(rows[0].outgoing).toEqual([1, 2])
    expect(rows[2].incoming).toEqual([2])
    expect(freeLane(rows, 0, 2, [])).toBe(0)
  })

  it('ignores a reservation for a commit not in the list', () => {
    expect(layout([c('b', 'a'), c('a')], 'zzz')).toEqual(layout([c('b', 'a'), c('a')]))
  })

  it('reserves one lane per dotted connector: WIP lane 0, stash lane 1', () => {
    // WIP + a stash both anchor to HEAD 'm' — side branch pushed to lane 2,
    // lanes 0 and 1 stay clear for the two dotted connectors
    const { rows, maxLanes } = layout([c('t2', 't1'), c('t1', 'm'), c('m', 'a'), c('a')], 'm', 2)
    expect(rows.map(r => r.lane)).toEqual([2, 2, 0, 0])
    expect(rows[0].through).toEqual([])
    expect(rows[2].incoming).toEqual([2])
    expect(maxLanes).toBe(3)
    expect(freeLane(rows, 0, 2, [])).toBe(0) // WIP straight down lane 0
    expect(freeLane(rows, 0, 2, [0])).toBe(1) // stash straight down lane 1
  })
})

describe('stashSlot', () => {
  it('keeps the chronological slot when the clear lane hugs local traffic', () => {
    const { rows } = layout([c('t2', 't1'), c('t1', 'm'), c('m', 'a'), c('a')], 'm')
    expect(stashSlot(rows, 0, 2, [])).toEqual({ idx: 0, lane: 0 })
  })

  it('keeps a slot one lane beyond the insertion row traffic', () => {
    // merge m(b,x) fills lanes 0-1 across the span; lane 2 is adjacent to the
    // insertion row's own outgoing lanes 0-1 — still reads as attached
    const { rows } = layout([c('m', 'b', 'x'), c('b', 'a'), c('x', 'a'), c('a')])
    expect(stashSlot(rows, 0, 3, [])).toEqual({ idx: 0, lane: 2 })
  })

  it('snaps to the base commit when the clear lane detaches from local traffic', () => {
    // quiet top row, but an octopus merge below occupies lanes 0-3 across the
    // span: the chronological slot would float alone on lane 4
    const commits = [c('t', 'm'), c('m', 'a', 'b', 'x', 'y'), c('a'), c('b'), c('x'), c('y')]
    const { rows } = layout(commits)
    expect(freeLane(rows, 0, 5, [])).toBe(4)
    expect(stashSlot(rows, 0, 5, [])).toEqual({ idx: 5, lane: rows[5].lane }) // parent's own lane
  })

  it('never snaps a stash already at its base', () => {
    const { rows } = layout([c('b', 'a'), c('a')])
    expect(stashSlot(rows, 1, 1, [])).toEqual({ idx: 1, lane: 1 })
  })
})

describe('activeTrail', () => {
  it('follows first parents from HEAD, skipping the merged-in branch', () => {
    // HEAD at merge 'm' (b + c): trail is m→b→a; c's line (lane 1) stays off it
    const commits = [c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')]
    const { rows } = layout(commits)
    const t = activeTrail(commits, rows, 0)!
    expect(t[0]).toEqual({ through: -1, incoming: -1, outgoing: true })
    expect(t[1]).toEqual({ through: -1, incoming: 0, outgoing: true })
    expect(t[2]).toEqual({ through: 0, incoming: -1, outgoing: false }) // trail passes c's row on lane 0
    expect(t[3]).toEqual({ through: -1, incoming: 0, outgoing: false }) // root: no outgoing
  })

  it('marks a HEAD below other branches without lighting them up', () => {
    // side branch t2-t1 above HEAD 'm' on lane 1; trail starts at m (lane 0)
    const commits = [c('t2', 't1'), c('t1', 'm'), c('m', 'a'), c('a')]
    const { rows } = layout(commits, 'm')
    const t = activeTrail(commits, rows, 2)!
    expect(t[0]).toEqual({ through: -1, incoming: -1, outgoing: false })
    expect(t[2]).toEqual({ through: -1, incoming: -1, outgoing: true })
    expect(t[3].incoming).toBe(0)
  })

  it('runs the trail to the bottom when the parent is unloaded', () => {
    const commits = [c('b', 'a'), c('x', 'w')]
    const { rows } = layout(commits)
    const t = activeTrail(commits, rows, 0)!
    expect(t[0].outgoing).toBe(true)
    expect(t[1].through).toBe(0) // b→a line continues past the loaded window
  })

  it('returns null without a HEAD row', () => {
    const commits = [c('a')]
    expect(activeTrail(commits, layout(commits).rows, -1)).toBeNull()
  })
})

describe('freeLane', () => {
  it('sidesteps solid traffic crossing the span', () => {
    // m merges b and c; merge link runs down lane 1 into c — a stash based on c
    // can't share lane 1 (or lane 0, busy with b's line), so it gets lane 2
    const { rows } = layout([c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')])
    expect(freeLane(rows, 2, 2, [])).toBe(2)
  })

  it('shares the base lane when nothing crosses it', () => {
    // stash directly above the tip commit: base row has no top-half traffic
    const { rows } = layout([c('b', 'a'), c('a')])
    expect(freeLane(rows, 0, 0, [])).toBe(0)
  })

  it('sidesteps when the base has a child link running through', () => {
    // base 'a' has child 'b' above — solid lane-0 line enters 'a' from the top
    const { rows } = layout([c('b', 'a'), c('a')])
    expect(freeLane(rows, 1, 1, [])).toBe(1)
  })

  it('skips lanes already taken by other dotted spans', () => {
    const { rows } = layout([c('b', 'a'), c('a')])
    expect(freeLane(rows, 0, 0, [0])).toBe(1)
  })

  it('routes a WIP connector past a merge into the checked-out commit', () => {
    // HEAD on 'c' (row 2, lane 1): its child merge 'm' sends a link down lane 1,
    // lane 0 is busy with b's line — the top-row-to-HEAD span needs lane 2
    const { rows } = layout([c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')])
    expect(freeLane(rows, 0, 2, [])).toBe(2)
  })
})
