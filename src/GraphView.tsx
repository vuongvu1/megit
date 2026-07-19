import { useMemo } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { layout, type LaneRow } from './lanes'
import type { Selection } from './RepoView'

const ROW = 28
const COL = 14
const COLORS = ['#61afef', '#98c379', '#e06c75', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66', '#f47067']
const color = (l: number) => COLORS[l % COLORS.length]

function GraphCell({ row, width }: { row: LaneRow; width: number }) {
  const x = (l: number) => l * COL + COL / 2
  const mid = ROW / 2
  return (
    <svg width={width} height={ROW} className="graph-cell">
      {row.through.map(l => <line key={`t${l}`} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} strokeWidth="2" />)}
      {row.incoming.map(l => (
        <path key={`i${l}`} d={`M ${x(l)} 0 C ${x(l)} ${mid}, ${x(row.lane)} 0, ${x(row.lane)} ${mid}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      {row.outgoing.map(l => (
        <path key={`o${l}`} d={`M ${x(row.lane)} ${mid} C ${x(l)} ${ROW}, ${x(l)} ${mid}, ${x(l)} ${ROW}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      <circle cx={x(row.lane)} cy={mid} r="4" fill={color(row.lane)} />
    </svg>
  )
}

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })

export default function GraphView({ commits, status, selection, onSelect, onLoadMore, hasMore }: {
  commits: Commit[]
  status: StatusEntry[]
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
          <svg width={width} height={ROW} className="graph-cell">
            <circle cx={COL / 2} cy={ROW / 2} r="4" fill="none" stroke="#e5c07b" strokeWidth="2" />
          </svg>
          <span className="subject">{status.length} uncommitted change{status.length > 1 ? 's' : ''}</span>
        </div>
      )}
      {commits.map((c, i) => (
        <div
          key={c.hash}
          className={`row${selection?.kind === 'commit' && selection.hash === c.hash ? ' selected' : ''}`}
          onClick={() => onSelect({ kind: 'commit', hash: c.hash })}
        >
          <GraphCell row={rows[i]} width={width} />
          <span className="refs">
            {c.refs.map(r => <span key={r} className="ref-chip" style={{ borderColor: color(rows[i].lane) }}>{r}</span>)}
          </span>
          <span className="subject" title={c.subject}>{c.subject}</span>
          <span className="author">{c.author}</span>
          <span className="date">{fmtDate(c.date)}</span>
          <span className="hash">{c.hash.slice(0, 7)}</span>
        </div>
      ))}
      {hasMore && <button className="load-more" onClick={onLoadMore}>Load more</button>}
    </div>
  )
}
