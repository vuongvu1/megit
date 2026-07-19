import { describe, it, expect } from 'vitest'
import { layout } from './lanes.ts'

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
