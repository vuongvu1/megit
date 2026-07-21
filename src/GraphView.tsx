import { memo, useMemo } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { layout, type LaneRow } from './lanes'
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

function GraphCell({ row, width, avatarUrl, label, clipId }: {
  row: LaneRow
  width: number
  avatarUrl: string | null
  label: string | null // author initials; null = merge commit → plain dot
  clipId: string
}) {
  const x = (l: number) => l * COL + COL / 2
  const mid = ROW / 2
  const cx = x(row.lane)
  const c = color(row.lane)
  return (
    <svg width={width} height={ROW} className="graph-cell">
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

function CommitRow({ repo, c, row, width, remotes, selected, onSelect }: {
  repo: string
  c: Commit
  row: LaneRow
  width: number
  remotes: string[]
  selected: boolean
  onSelect: () => void
}) {
  const isMerge = c.parents.length > 1
  const avatarUrl = useAvatar(repo, isMerge ? null : c.email)
  const chips = useMemo(() => parseRefs(c.refs, remotes), [c.refs, remotes])
  return (
    <div className={`row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <span className="refs">
        {chips.map(chip => (
          <span
            key={chip.name}
            className={`ref-chip${chip.head ? ' head' : ''}`}
            style={{ borderColor: color(row.lane) }}
            title={chip.name}
          >
            {chip.head && <CheckIcon />}
            <span className="ref-name">{chip.name}</span>
            {chip.tag && <TagIcon />}
            {chip.local && !chip.tag && <LocalIcon />}
            {chip.remote && <RemoteIcon />}
          </span>
        ))}
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
        <GraphCell row={row} width={width} avatarUrl={avatarUrl} label={isMerge ? null : initials(c.author)} clipId={`av-${c.hash.slice(0, 12)}`} />
      </span>
      <span className="subject" title={c.subject}>{c.subject}</span>
      <span className="author">{c.author}</span>
      <span className="date">{fmtDate(c.date)}</span>
      <span className="hash">{c.hash.slice(0, 7)}</span>
    </div>
  )
}

function GraphView({ repo, commits, status, remotes, selection, onSelect, onLoadMore, hasMore }: {
  repo: string
  commits: Commit[]
  status: StatusEntry[]
  remotes: string[]
  selection: Selection
  onSelect: (s: Selection) => void
  onLoadMore: () => void
  hasMore: boolean
}) {
  const { rows, maxLanes } = useMemo(() => layout(commits), [commits])
  const width = Math.max(maxLanes, 1) * COL

  return (
    <div className="graphview">
      {status.length > 0 && (
        <div className={`row wip${selection?.kind === 'wip' ? ' selected' : ''}`} onClick={() => onSelect({ kind: 'wip' })}>
          <span className="refs" />
          <span className="graph-col">
            <svg width={width} height={ROW} className="graph-cell">
              <circle cx={COL / 2} cy={ROW / 2} r="4" fill="none" stroke="#e5c07b" strokeWidth="2" />
            </svg>
          </span>
          <span className="subject">{status.length} uncommitted change{status.length > 1 ? 's' : ''}</span>
        </div>
      )}
      {commits.map((c, i) => (
        <CommitRow
          key={c.hash}
          repo={repo}
          c={c}
          row={rows[i]}
          width={width}
          remotes={remotes}
          selected={selection?.kind === 'commit' && selection.hash === c.hash}
          onSelect={() => onSelect({ kind: 'commit', hash: c.hash })}
        />
      ))}
      {hasMore && <button className="load-more" onClick={onLoadMore}>Load more</button>}
    </div>
  )
}

export default memo(GraphView)
