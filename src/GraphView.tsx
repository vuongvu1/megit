import { Fragment, memo, useMemo } from 'react'
import type { Commit, StashEntry, StatusEntry } from '../server/parse.ts'
import { api, jsonInit } from './api'
import { layout, freeLane, type LaneRow } from './lanes'
import type { Selection } from './RepoView'
import { useAvatar, initials } from './avatar'

const ROW = 28
const COL = 14
const AV_R = 9
const COLORS = ['#61afef', '#98c379', '#e06c75', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66', '#f47067']
const color = (l: number) => COLORS[l % COLORS.length]

type RefChip = { name: string; local: boolean; remote: boolean; tag: boolean; head: boolean }

// %D entries: "HEAD -> main", "main", "origin/main", "tag: v1.0", "HEAD" (detached).
// Local + remote refs with the same branch name merge into one chip with both icons.
function parseRefs(refs: string[], remotes: string[]): RefChip[] {
  const chips = new Map<string, RefChip>()
  const get = (name: string) => {
    let c = chips.get(name)
    if (!c) {
      c = { name, local: false, remote: false, tag: false, head: false }
      chips.set(name, c)
    }
    return c
  }
  for (let r of refs) {
    if (!r) continue
    let head = false
    if (r.startsWith('HEAD -> ')) {
      head = true
      r = r.slice(8)
    }
    if (r.startsWith('tag: ')) {
      get(r.slice(5)).tag = true
      continue
    }
    const remote = remotes.find(rm => r.startsWith(rm + '/'))
    if (remote) {
      const name = r.slice(remote.length + 1)
      if (name === 'HEAD') continue // origin/HEAD symref — noise
      get(name).remote = true
    } else {
      const c = get(r)
      c.local = true
      if (head || r === 'HEAD') c.head = true
    }
  }
  return [...chips.values()]
}

const LocalIcon = () => (
  <svg className="ref-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M5 14.5h6" />
  </svg>
)

const RemoteIcon = () => (
  <svg className="ref-icon" viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

const TagIcon = () => (
  <svg className="ref-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 2h5.2L14 8.8 8.8 14 2 7.2z" />
    <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const CheckIcon = () => (
  <svg className="ref-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 8.5l3.5 3.5L13 5" />
  </svg>
)

type Dash = { lane: number; end: boolean } // WIP/stash connector passing through (end: terminates at this row's dot)

function GraphCell({ row, width, avatarUrl, label, clipId, dashes }: {
  row: LaneRow
  width: number
  avatarUrl: string | null
  label: string | null // author initials; null = merge commit → plain dot
  clipId: string
  dashes: Dash[]
}) {
  const x = (l: number) => l * COL + COL / 2
  const mid = ROW / 2
  const cx = x(row.lane)
  const c = color(row.lane)
  return (
    <svg width={width} height={ROW} className="graph-cell">
      {dashes.map((d, i) => d.end && d.lane !== row.lane ? (
        // connector ends here but on a different lane: curve into this row's dot
        <path key={`d${i}`} d={`M ${x(d.lane)} 0 C ${x(d.lane)} ${mid}, ${x(row.lane)} 0, ${x(row.lane)} ${mid}`} stroke={color(d.lane)} strokeWidth="2" fill="none" strokeDasharray="2 3" />
      ) : (
        <line key={`d${i}`} x1={x(d.lane)} y1={0} x2={x(d.lane)} y2={d.end ? mid : ROW} stroke={color(d.lane)} strokeWidth="2" strokeDasharray="2 3" />
      ))}
      {row.through.map(l => <line key={`t${l}`} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} strokeWidth="2" />)}
      {row.incoming.map(l => (
        <path key={`i${l}`} d={`M ${x(l)} 0 C ${x(l)} ${mid}, ${x(row.lane)} 0, ${x(row.lane)} ${mid}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      {row.outgoing.map(l => (
        <path key={`o${l}`} d={`M ${x(row.lane)} ${mid} C ${x(l)} ${ROW}, ${x(l)} ${mid}, ${x(l)} ${ROW}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      {label === null ? (
        <circle cx={cx} cy={mid} r="4" fill={c} />
      ) : (
        <>
          {avatarUrl ? (
            <>
              <clipPath id={clipId}>
                <circle cx={cx} cy={mid} r={AV_R} />
              </clipPath>
              <image
                href={avatarUrl}
                x={cx - AV_R}
                y={mid - AV_R}
                width={AV_R * 2}
                height={AV_R * 2}
                clipPath={`url(#${clipId})`}
              />
            </>
          ) : (
            <>
              <circle cx={cx} cy={mid} r={AV_R} fill={c} />
              <text x={cx} y={mid} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="#fff">
                {label}
              </text>
            </>
          )}
          <circle cx={cx} cy={mid} r={AV_R} fill="none" stroke={c} strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })

function CommitRow({ repo, c, row, width, remotes, selected, onSelect, dashes, onBusy }: {
  repo: string
  c: Commit
  row: LaneRow
  width: number
  remotes: string[]
  selected: boolean
  onSelect: () => void
  dashes: Dash[]
  onBusy: (p: Promise<unknown>) => void
}) {
  const isMerge = c.parents.length > 1
  const avatarUrl = useAvatar(repo, isMerge ? null : c.email)
  const chips = useMemo(() => parseRefs(c.refs, remotes), [c.refs, remotes])
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <span className="refs">
        {chips.map(chip => {
          const canCheckout = !chip.head && !chip.tag && (chip.local || chip.remote)
          return (
          <span
            key={chip.name}
            className={`ref-chip${chip.head ? ' head' : ''}`}
            style={{ borderColor: color(row.lane) }}
            title={canCheckout ? `${chip.name} — double-click to checkout` : chip.name}
            onDoubleClick={canCheckout ? () => {
              // onBusy refetches on settle; the later fs.watch → SSE refresh is a fingerprint no-op
              type CheckoutRes = { diverged?: boolean; remoteRef?: string; ahead?: number; behind?: number }
              const checkout = (body: object) =>
                api<CheckoutRes>(`/api/checkout?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
              onBusy(checkout({ branch: chip.name })
                .then(r => {
                  if (!r.diverged) return
                  // ponytail: native confirm as the popup; custom modal when it grates
                  const ok = confirm(
                    `Local '${chip.name}' differs from ${r.remoteRef} (${r.ahead} ahead, ${r.behind} behind).\n\n` +
                    `OK — Reset local to ${r.remoteRef} (uncommitted changes go to a stash)\nCancel — keep everything as is`,
                  )
                  if (ok) return checkout({ branch: chip.name, reset: true })
                })
                .catch(err => alert(`Checkout failed:\n${(err as Error).message}`))) // ponytail: alert; inline toast if it grates
            } : undefined}
          >
            {chip.head && <CheckIcon />}
            <span className="ref-name">{chip.name}</span>
            {chip.tag && <TagIcon />}
            {chip.local && !chip.tag && <LocalIcon />}
            {chip.remote && <RemoteIcon />}
          </span>
          )
        })}
        {chips.length > 0 && <span className="ref-line" style={{ background: color(row.lane) }} />}
      </span>
      {chips.length > 0 && (
        // bridge: refs edge → commit dot; svg centering offset re-derived from the same CSS vars
        <span
          className="ref-bridge"
          style={{
            background: color(row.lane),
            left: 'calc(8px + var(--refs-w, 120px))',
            width: `min(calc(8px + max(3px, (var(--graph-col-w, 90px) - ${width}px) / 2) + ${row.lane * COL + COL / 2 - (isMerge ? 4 : AV_R)}px), calc(8px + var(--graph-col-w, 90px)))`,
          }}
        />
      )}
      <span className="graph-col">
        <GraphCell row={row} width={width} avatarUrl={avatarUrl} label={isMerge ? null : initials(c.author)} clipId={`av-${c.hash.slice(0, 12)}`} dashes={dashes} />
      </span>
      <span className="subject" title={c.subject}>{c.subject}</span>
      <span className="author">{c.author}</span>
      <span className="date">{fmtDate(c.date)}</span>
      <span className="hash">{c.hash.slice(0, 7)}</span>
    </div>
  )
}

// stash node at its chronological row, drawn on a lane free of solid traffic
// across its whole dotted span (GitKraken-style); lanes crossing the insertion
// row's top edge (incoming ∪ through) continue solid through this row
// ponytail: other stashes' dotted spans skip this row — gap only when two stash spans overlap
function StashRow({ s, lane, passRow, width, wipLane, selected, onSelect }: {
  s: StashEntry
  lane: number // display lane (where the square and connector sit)
  passRow: LaneRow // the commit row this stash was inserted above
  width: number
  wipLane: number | null // WIP → HEAD connector crossing this row
  selected: boolean
  onSelect: () => void
}) {
  const x = (l: number) => l * COL + COL / 2
  const sx = x(lane)
  const sc = color(lane)
  const solids = [...new Set([...passRow.incoming, ...passRow.through])]
  return (
    <div className={`row stash${selected ? ' selected' : ''}`} onClick={onSelect}>
      <span className="refs" />
      <span className="graph-col">
        <svg width={width} height={ROW} className="graph-cell">
          {solids.map(l => (
            <line key={l} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} strokeWidth="2" />
          ))}
          {wipLane != null && !solids.includes(wipLane) && (
            <line x1={x(wipLane)} y1={0} x2={x(wipLane)} y2={ROW} stroke={color(wipLane)} strokeWidth="2" strokeDasharray="2 3" />
          )}
          <line x1={sx} y1={ROW / 2 + AV_R + 1} x2={sx} y2={ROW} stroke={sc} strokeWidth="2" strokeDasharray="2 3" />
          <rect x={sx - AV_R} y={ROW / 2 - AV_R} width={AV_R * 2} height={AV_R * 2} rx="4" fill="var(--bg-panel)" stroke={sc} strokeWidth="1.5" strokeDasharray="3 3" />
          {/* inbox-tray glyph */}
          <g transform={`translate(${sx}, ${ROW / 2})`} stroke={sc} strokeWidth="1.3" fill="none" strokeLinejoin="round" strokeLinecap="round">
            <path d="M -4.5 0 v 3.5 h 9 v -3.5" />
            <path d="M -4.5 0 h 2.5 l 1 1.5 h 2 l 1 -1.5 h 2.5" />
            <path d="M -3 -2 l 3 -2 l 3 2" />
          </g>
        </svg>
      </span>
      <span className="subject" title={s.subject}>{s.subject}</span>
    </div>
  )
}

function GraphView({ repo, commits, status, remotes, stashes, selection, onSelect, onLoadMore, hasMore, onBusy }: {
  repo: string
  commits: Commit[]
  status: StatusEntry[]
  remotes: string[]
  stashes: StashEntry[]
  selection: Selection
  onSelect: (s: Selection) => void
  onLoadMore: () => void
  hasMore: boolean
  onBusy: (p: Promise<unknown>) => void
}) {
  const { rows, maxLanes } = useMemo(() => layout(commits), [commits])
  // WIP row connects to the commit HEAD points at, on that commit's lane (GitKraken-style)
  const headIdx = useMemo(() => commits.findIndex(c => c.refs.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))), [commits])
  const showWip = status.length > 0
  const headLane = headIdx >= 0 ? rows[headIdx].lane : 0
  const hx = headLane * COL + COL / 2
  const hc = color(headLane)

  // stash placement: chronological slot in the (roughly date-descending) topo list,
  // dotted connector running down a lane free of solid traffic, curving into the base row
  const placements = useMemo(() => {
    const byRow = new Map<number, { s: StashEntry; endIdx: number; lane: number }[]>()
    const spans: { lane: number; from: number; to: number }[] =
      showWip && headIdx >= 0 ? [{ lane: headLane, from: 0, to: headIdx }] : []
    let lanes = maxLanes
    for (const s of stashes) {
      const endIdx = commits.findIndex(c => c.hash === s.parent)
      if (endIdx < 0) continue
      let insertIdx = commits.findIndex(c => c.date <= s.date)
      if (insertIdx < 0 || insertIdx > endIdx) insertIdx = endIdx // never below its base
      const taken = spans.filter(t => t.from <= endIdx && insertIdx <= t.to).map(t => t.lane)
      const lane = freeLane(rows, insertIdx, endIdx, taken)
      spans.push({ lane, from: insertIdx, to: endIdx })
      lanes = Math.max(lanes, lane + 1)
      byRow.set(insertIdx, [...(byRow.get(insertIdx) ?? []), { s, endIdx, lane }])
    }
    return { byRow, lanes }
  }, [commits, rows, stashes, maxLanes, showWip, headIdx, headLane])
  const width = Math.max(placements.lanes, 1) * COL
  // dotted overlays crossing commit row i: WIP → HEAD, plus each stash span insertIdx..endIdx
  const dashesFor = (i: number): Dash[] => {
    const out: Dash[] = showWip && headIdx >= 0 && i <= headIdx ? [{ lane: headLane, end: i === headIdx }] : []
    for (const [insertIdx, list] of placements.byRow) {
      for (const p of list) if (insertIdx <= i && i <= p.endIdx) out.push({ lane: p.lane, end: i === p.endIdx })
    }
    return out
  }

  return (
    <div className="graphview">
      {showWip && (
        <div className={`row wip${selection?.kind === 'wip' ? ' selected' : ''}`} onClick={() => onSelect({ kind: 'wip' })}>
          <span className="refs" />
          <span className="graph-col">
            <svg width={width} height={ROW} className="graph-cell">
              {/* stash connectors don't reach the WIP row — it sits above them */}
              {headIdx >= 0 && <line x1={hx} y1={ROW / 2 + AV_R + 1} x2={hx} y2={ROW} stroke={hc} strokeWidth="2" strokeDasharray="2 3" />}
              <circle cx={hx} cy={ROW / 2} r={AV_R} fill="none" stroke={hc} strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
          </span>
          <span className="subject">{status.length} uncommitted change{status.length > 1 ? 's' : ''}</span>
        </div>
      )}
      {commits.map((c, i) => {
        const rowStashes = placements.byRow.get(i)
        const crossWip = showWip && headIdx >= 0 && i <= headIdx
        return (
          <Fragment key={c.hash}>
            {rowStashes?.map(p => (
              <StashRow
                key={p.s.hash}
                s={p.s}
                lane={p.lane}
                passRow={rows[i]}
                width={width}
                wipLane={crossWip ? headLane : null}
                selected={selection?.kind === 'commit' && selection.hash === p.s.hash}
                onSelect={() => onSelect({ kind: 'commit', hash: p.s.hash })}
              />
            ))}
            <CommitRow
              repo={repo}
              c={c}
              row={rows[i]}
              width={width}
              remotes={remotes}
              selected={selection?.kind === 'commit' && selection.hash === c.hash}
              onSelect={() => onSelect({ kind: 'commit', hash: c.hash })}
              dashes={dashesFor(i)}
              onBusy={onBusy}
            />
          </Fragment>
        )
      })}
      {hasMore && <button className="load-more" onClick={onLoadMore}>Load more</button>}
    </div>
  )
}

export default memo(GraphView)
