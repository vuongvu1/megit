import { describe, it, expect } from 'vitest'
import { layout, freeLane } from './lanes.ts'

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
