import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { Commit, StashEntry, StatusEntry } from '../server/parse.ts'
import { api, jsonInit } from './api'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { branchMenu, chipRef, type RefChip } from './branchMenu'
import { commitMenu } from './commitMenu'
import { layout, stashSlot, activeTrail, type LaneRow, type TrailRow } from './lanes'
import { rowOrder, sameRow, step } from './rowNav'
import type { Selection } from './RepoView'
import { toastErr } from './Toast'
import { useAvatar, initials } from './avatar'

const ROW = 28
const COL = 18
const AV_R = 10
const COLORS = ['#61afef', '#98c379', '#e06c75', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66', '#f47067']
const color = (l: number) => COLORS[l % COLORS.length]

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
      const c = get(name)
      c.remote = true
      c.remoteRef ??= r // first remote wins when several carry the branch
    } else {
      const c = get(r)
      c.local = true
      if (head || r === 'HEAD') c.head = true
    }
  }
  // branches left, tags right — sort is stable, so git's own order survives within each group
  return [...chips.values()].sort((a, b) => Number(a.tag) - Number(b.tag))
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

// The refs gutter is its own zone, not part of the row: chips answer for
// themselves and blank space in it does nothing — same rule the click handler
// on it already follows, so a right-click beside a chip can't open the row's menu.
const inert = (e: ReactMouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
}

// active-branch emphasis: trail segments thicker, everything else translucent;
// plain stroke when there's no trail (HEAD not in the loaded commits)
const emph = (mode: boolean, on: boolean) =>
  mode ? (on ? { strokeWidth: 3 } : { strokeWidth: 2, strokeOpacity: 0.4 }) : { strokeWidth: 2 }

function GraphCell({ row, width, avatarUrl, label, clipId, dashes, trail, tooltip }: {
  row: LaneRow
  width: number
  avatarUrl: string | null
  label: string | null // author initials; null = merge commit → plain dot
  clipId: string
  dashes: Dash[]
  trail: TrailRow | null
  tooltip?: string
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
      {row.through.map(l => <line key={`t${l}`} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} {...emph(!!trail, trail?.through === l)} />)}
      {row.incoming.map(l => (
        <path key={`i${l}`} d={`M ${x(l)} 0 C ${x(l)} ${mid}, ${x(row.lane)} 0, ${x(row.lane)} ${mid}`} stroke={color(l)} {...emph(!!trail, trail?.incoming === l)} fill="none" />
      ))}
      {row.outgoing.map(l => (
        <path key={`o${l}`} d={`M ${x(row.lane)} ${mid} C ${x(l)} ${ROW}, ${x(l)} ${mid}, ${x(l)} ${ROW}`} stroke={color(l)} {...emph(!!trail, !!trail?.outgoing && l === row.lane)} fill="none" />
      ))}
      {label === null ? (
        <circle cx={cx} cy={mid} r="4" fill={c}>
          {tooltip && <title>{tooltip}</title>}
        </circle>
      ) : (
        <g>
          {tooltip && <title>{tooltip}</title>}
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
              <text x={cx} y={mid} textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill="#fff">
                {label}
              </text>
            </>
          )}
          <circle cx={cx} cy={mid} r={AV_R} fill="none" stroke={c} strokeWidth="1.5" />
        </g>
      )}
    </svg>
  )
}

const fmtDate = (unix: number) => {
  const secs = Math.floor(Date.now() / 1000) - unix
  if (secs >= 0 && secs < 7 * 86400) {
    if (secs < 60) return 'now'
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
  }
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

function CommitRow({ repo, c, row, width, remotes, selected, onSelect, dashes, trail, onCheckout, onChipMenu, onRowMenu }: {
  repo: string
  c: Commit
  row: LaneRow
  width: number
  remotes: string[]
  selected: boolean
  onSelect: () => void
  dashes: Dash[]
  trail: TrailRow | null
  onCheckout: (branch: string) => void
  onChipMenu: (e: ReactMouseEvent, chip: RefChip, hash: string) => void
  onRowMenu: (e: ReactMouseEvent, hash: string) => void
}) {
  const isMerge = c.parents.length > 1
  const avatarUrl = useAvatar(repo, isMerge ? null : c.email)
  const chips = useMemo(() => parseRefs(c.refs, remotes), [c.refs, remotes])
  const isHead = chips.some(ch => ch.head)
  return (
    <div className={`row${selected ? ' selected' : ''}`} aria-current={selected || undefined} onClick={onSelect} onContextMenu={e => onRowMenu(e, c.hash)}>
      <span className="refs" onClick={e => e.stopPropagation()} onContextMenu={inert}>
        {/* group wrapper so the chips split the cramped width between themselves —
            without it .ref-line competes for the same free space */}
        <span className="ref-chips">
        {chips.map(chip => {
          const canCheckout = !chip.head && !chip.tag && (chip.local || chip.remote)
          // icon count feeds the chip's flex-basis so every name gets the same
          // number of pixels (see .ref-chip); icons are unshrinkable, so a chip
          // that carries three of them would otherwise lose its whole name first
          const nIcons = (chip.head ? 1 : 0) + (chip.tag ? 1 : 0) + (chip.local && !chip.tag ? 1 : 0) + (chip.remote ? 1 : 0)
          return (
          <span
            key={chip.name}
            className={`ref-chip${chip.head ? ' head' : ''}`}
            style={{ borderColor: color(row.lane), '--n-icons': nIcons } as CSSProperties}
            title={canCheckout ? `${chip.name} — double-click to checkout, right-click for actions` : `${chip.name} — right-click for actions`}
            onDoubleClick={canCheckout ? () => onCheckout(chip.name) : undefined}
            // a chip's menu replaces the row's — without this the row handler
            // fires next and overwrites it with the commit menu
            onContextMenu={e => { e.stopPropagation(); onChipMenu(e, chip, c.hash) }}
          >
            {chip.head && <CheckIcon />}
            <span className="ref-name">{chip.name}</span>
            {chip.tag && <TagIcon />}
            {chip.local && !chip.tag && <LocalIcon />}
            {chip.remote && <RemoteIcon />}
          </span>
          )
        })}
        </span>
        {chips.length > 0 && <span className={`ref-line${isHead ? ' head' : ''}`} style={{ background: color(row.lane) }} />}
      </span>
      {chips.length > 0 && (
        // bridge: refs edge → commit dot; svg is left-aligned at the 3px column padding
        <span
          className={`ref-bridge${isHead ? ' head' : ''}`}
          style={{
            background: color(row.lane),
            left: 'calc(8px + var(--refs-w, 120px))',
            width: `min(calc(8px + 3px + ${row.lane * COL + COL / 2 - (isMerge ? 4 : AV_R)}px), calc(8px + var(--graph-col-w, 90px)))`,
          }}
        />
      )}
      <span className="graph-col">
        <GraphCell row={row} width={width} avatarUrl={avatarUrl} label={isMerge ? null : initials(c.author)} clipId={`av-${c.hash.slice(0, 12)}`} dashes={dashes} trail={trail} tooltip={c.author} />
      </span>
      <span className="subject" title={c.subject}>{c.subject}</span>
      <span className="date">{fmtDate(c.date)}</span>
      <span className="hash">{c.hash.slice(0, 7)}</span>
    </div>
  )
}

// stash node at its chronological row, drawn on a lane free of solid traffic
// across its whole dotted span (GitKraken-style); lanes crossing the insertion
// row's top edge (incoming ∪ through) continue solid through this row
function StashRow({ s, lane, passRow, width, dashes, trailLane, selected, onSelect, onMenu }: {
  s: StashEntry
  lane: number // display lane (where the square and connector sit)
  passRow: LaneRow // the commit row this stash was inserted above
  width: number
  dashes: Dash[] // WIP/other-stash connectors passing through this row
  trailLane: number | null // active-branch line crossing this row (null = no trail)
  selected: boolean
  onSelect: () => void
  onMenu: (e: ReactMouseEvent) => void
}) {
  const x = (l: number) => l * COL + COL / 2
  const sx = x(lane)
  const sc = color(lane)
  const solids = [...new Set([...passRow.incoming, ...passRow.through])]
  return (
    <div className={`row stash${selected ? ' selected' : ''}`} aria-current={selected || undefined} onClick={onSelect} onContextMenu={onMenu}>
      <span className="refs" onClick={e => e.stopPropagation()} onContextMenu={inert} />
      <span className="graph-col">
        <svg width={width} height={ROW} className="graph-cell">
          {solids.map(l => (
            <line key={l} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} {...emph(trailLane !== null, l === trailLane)} />
          ))}
          {dashes.map((d, i) => !solids.includes(d.lane) && (
            <line key={`d${i}`} x1={x(d.lane)} y1={0} x2={x(d.lane)} y2={ROW} stroke={color(d.lane)} strokeWidth="2" strokeDasharray="2 3" />
          ))}
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
      <span className="date">{fmtDate(s.date)}</span>
      <span className="hash">{s.hash.slice(0, 7)}</span>
    </div>
  )
}

function GraphView({ repo, commits, status, remotes, stashes, githubUrl, selection, onSelect, onLoadMore, hasMore, onBusy }: {
  repo: string
  commits: Commit[]
  status: StatusEntry[]
  remotes: string[]
  stashes: StashEntry[]
  githubUrl: string | null
  selection: Selection
  onSelect: (s: Selection) => void
  onLoadMore: () => void
  hasMore: boolean
  onBusy: (p: Promise<unknown>) => void
}) {
  const headIdx = useMemo(() => commits.findIndex(c => c.refs.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))), [commits])
  const headHash = headIdx >= 0 ? commits[headIdx].hash : undefined
  const headBranch = (headIdx >= 0 && commits[headIdx].refs.find(r => r.startsWith('HEAD -> '))?.slice(8)) || null
  const showWip = status.length > 0
  // items are built at open time, so the menu itself stays generic — commit and
  // branch menus are a different array through the same openMenu
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const openMenu = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  const stashApi = (body: object, label: string) =>
    onBusy(api(`/api/stash?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
      .catch(err => toastErr(`Stash ${label} failed:\n${(err as Error).message}`)))
  // pop drops the stash too, but its content lands in the worktree where the user
  // can see (and re-stash) it — delete is the one that leaves nothing behind, so
  // it's the only one that confirms
  const stashItems = (s: StashEntry): MenuItem[] => [
    { label: 'Pop stash', onClick: () => stashApi({ hash: s.hash, action: 'pop' }, 'pop') },
    {
      label: 'Delete stash',
      danger: true,
      onClick: () => { if (confirm(`Delete this stash?\n\n${s.subject}`)) stashApi({ hash: s.hash, action: 'drop' }, 'delete') },
    },
  ]
  const wipItems = (): MenuItem[] => [{
    label: 'Stash changes',
    onClick: () => {
      // ponytail: native prompt as the naming dialog; nothing is lost on cancel
      const message = prompt('Stash message', `WIP on ${headBranch ?? 'HEAD'}`)
      if (message === null) return
      stashApi({ action: 'push', message }, 'save')
    },
  }]

  // onBusy refetches on settle; the later fs.watch → SSE refresh is a fingerprint no-op
  const branchPost = (body: object) =>
    api(`/api/branch?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
  const branchApi = (body: object, label: string) =>
    onBusy(branchPost(body).catch(err => toastErr(`${label} failed:\n${(err as Error).message}`)))
  const checkout = (branch: string) => {
    type CheckoutRes = { diverged?: boolean; remoteRef?: string; ahead?: number; behind?: number }
    const post = (body: object) =>
      api<CheckoutRes>(`/api/checkout?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
    onBusy(post({ branch })
      .then(r => {
        if (!r.diverged) return
        // ponytail: native confirm as the popup; custom modal when it grates
        const ok = confirm(
          `Local '${branch}' differs from ${r.remoteRef} (${r.ahead} ahead, ${r.behind} behind).\n\n` +
          `OK — Reset local to ${r.remoteRef} (uncommitted changes go to a stash)\nCancel — keep everything as is`,
        )
        if (ok) return post({ branch, reset: true })
      })
      .catch(err => toastErr(`Checkout failed:\n${(err as Error).message}`)))
  }
  const commitPost = (body: object) =>
    api(`/api/commit?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
  const commitApi = (body: object, label: string) =>
    onBusy(commitPost(body).catch(err => toastErr(`${label} failed:\n${(err as Error).message}`)))
  const newBranchAt = (hash: string) => {
    const name = prompt(`New branch at ${hash.slice(0, 7)}`, '')
    if (name) branchApi({ action: 'create', name, at: hash }, 'Create branch')
  }
  const rowItems = (hash: string): MenuItem[] => commitMenu({
    isHead: hash === headHash,
    current: headBranch,
    canLink: !!githubUrl,
    run: action => {
      const short = hash.slice(0, 7)
      switch (action) {
        case 'checkout':
          if (confirm(`Check out ${short} directly?\n\nHEAD detaches from ${headBranch ?? 'its branch'} — new commits would belong to no branch until you make one.`))
            commitApi({ action: 'checkout', hash }, 'Checkout')
          return
        case 'cherry-pick': return void commitApi({ action: 'cherry-pick', hash }, 'Cherry-pick')
        case 'revert': return void commitApi({ action: 'revert', hash }, 'Revert')
        case 'branch': return newBranchAt(hash)
        case 'tag': {
          const name = prompt(`New tag at ${short}`, '')
          if (name) commitApi({ action: 'tag', hash, name }, 'Create tag')
          return
        }
        case 'reset-soft': return void commitApi({ action: 'reset', hash, mode: 'soft' }, 'Reset')
        case 'reset-mixed': return void commitApi({ action: 'reset', hash, mode: 'mixed' }, 'Reset')
        case 'reset-hard':
          if (confirm(`Reset ${headBranch} to ${short} and discard changes?\n\nCommits after ${short} leave the branch (reflog keeps them). Uncommitted work goes to a stash first.`))
            commitApi({ action: 'reset', hash, mode: 'hard' }, 'Reset')
          return
        case 'copySha': return void navigator.clipboard.writeText(hash)
        case 'copyLink': return void navigator.clipboard.writeText(`${githubUrl}/commit/${hash}`)
      }
    },
  })
  const chipItems = (chip: RefChip, hash: string): MenuItem[] => branchMenu(chip, {
    current: headBranch,
    hasRemote: remotes.length > 0,
    canLink: !!githubUrl,
    run: action => {
      switch (action) {
        case 'checkout': return checkout(chip.name)
        case 'pull': return void branchApi({ action: 'pull' }, 'Pull')
        case 'push': return void branchApi({ action: 'push' }, 'Push')
        case 'merge': return void branchApi({ action: 'merge', branch: chipRef(chip) }, 'Merge')
        case 'rebase': return void branchApi({ action: 'rebase', branch: chipRef(chip) }, 'Rebase')
        case 'upstream': {
          const upstream = prompt(`Track which remote branch?`, `${remotes[0] ?? 'origin'}/${chip.name}`)
          if (upstream) branchApi({ action: 'upstream', branch: chip.name, upstream }, 'Set upstream')
          return
        }
        case 'create': return newBranchAt(hash)
        case 'rename': {
          const name = prompt(`Rename ${chip.name} to`, chip.name)
          if (name && name !== chip.name) branchApi({ action: 'rename', branch: chip.name, name }, 'Rename')
          return
        }
        case 'delete': {
          if (!confirm(`Delete branch ${chip.name}?`)) return
          const del = (force = false) => branchPost({ action: 'delete', branch: chip.name, force })
          // git's -d refuses unmerged work; forcing past that is a second, explicit decision
          onBusy(del()
            .catch((err: Error) => {
              if (!/not fully merged/.test(err.message)) throw err
              if (confirm(`${chip.name} is not fully merged.\n\nDelete anyway? Its commits stay reachable only through the reflog.`)) return del(true)
            })
            .catch((err: Error) => toastErr(`Delete branch failed:\n${err.message}`)))
          return
        }
        case 'deleteTag':
          // no unmerged-work dance: deleting a tag only drops the label, and unlike a
          // branch git never refuses it — one confirm is the whole safety net
          if (confirm(`Delete tag ${chip.name}?\n\nThe local tag only — a tag already pushed stays on the remote.`))
            branchApi({ action: 'deleteTag', tag: chip.name }, 'Delete tag')
          return
        case 'copyName': return void navigator.clipboard.writeText(chip.name)
        case 'copyLink': return void navigator.clipboard.writeText(`${githubUrl}/${chip.tag ? 'releases/tag' : 'tree'}/${chip.name}`)
      }
    },
  })

  // pin HEAD's branch to lane 0 and reserve one lane per dotted connector
  // anchored to it (WIP, then HEAD-based stashes) — each runs straight down
  // into the checked-out branch, GitKraken-style, instead of routing around
  const nDotted = (showWip ? 1 : 0) + stashes.filter(s => s.parent === headHash).length
  const reserve = headHash && nDotted > 0 ? headHash : undefined
  const { rows, maxLanes } = useMemo(() => layout(commits, reserve, nDotted), [commits, reserve, nDotted])
  const trail = useMemo(() => activeTrail(commits, rows, headIdx), [commits, rows, headIdx])
  const wipLane = 0 // reserved above
  const hx = COL / 2
  const hc = color(0)

  // stash placement: chronological slot in the (roughly date-descending) topo list,
  // dotted connector running down a lane free of solid traffic, curving into the base row
  const placements = useMemo(() => {
    const byRow = new Map<number, { s: StashEntry; endIdx: number; lane: number }[]>()
    const spans: { lane: number; from: number; to: number }[] =
      showWip && headIdx >= 0 ? [{ lane: wipLane, from: 0, to: headIdx }] : []
    let lanes = showWip && headIdx >= 0 ? Math.max(maxLanes, wipLane + 1) : maxLanes
    for (const s of stashes) {
      const endIdx = commits.findIndex(c => c.hash === s.parent)
      if (endIdx < 0) continue
      let insertIdx = commits.findIndex(c => c.date <= s.date)
      if (insertIdx < 0 || insertIdx > endIdx) insertIdx = endIdx // never below its base
      const taken = spans.filter(t => t.from <= endIdx && insertIdx <= t.to).map(t => t.lane)
      const { idx, lane } = stashSlot(rows, insertIdx, endIdx, taken, maxLanes)
      spans.push({ lane, from: idx, to: endIdx })
      lanes = Math.max(lanes, lane + 1)
      byRow.set(idx, [...(byRow.get(idx) ?? []), { s, endIdx, lane }])
    }
    return { byRow, lanes }
  }, [commits, rows, stashes, maxLanes, showWip, headIdx, wipLane])
  const width = Math.max(placements.lanes, 1) * COL

  // Keyboard navigation. The listener is on the window, like RepoView's `r` and ⌘J,
  // so the arrows work without clicking into the list first — but only while the
  // graph is what the user last touched: focus inside the diff or the commit panel
  // leaves the arrows to that pane's own scrolling. Nothing focused is the graph.
  const listRef = useRef<HTMLDivElement>(null)
  const order = useMemo(() => rowOrder(commits, placements.byRow, showWip), [commits, placements, showWip])
  // Listed in shortcuts.ts for the Settings dialog — change one, change both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return // ⌘↓ is "scroll to bottom"
      const t = e.target as HTMLElement
      if (t !== document.body && !t.closest?.('.graphview')) return
      const next = step(order.length, order.findIndex(o => sameRow(o, selection)), e.key)
      if (next === null) return // no move: let the browser scroll instead
      e.preventDefault()
      onSelect(order[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, selection, onSelect])
  // follow the selection when a key moves it off screen; 'nearest' leaves an
  // already-visible row where it is, so this is a no-op for clicks
  useEffect(() => {
    listRef.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selection])
  // dotted overlays crossing commit row i: WIP → HEAD, plus each stash span insertIdx..endIdx
  const dashesFor = (i: number): Dash[] => {
    const out: Dash[] = showWip && headIdx >= 0 && i <= headIdx ? [{ lane: wipLane, end: i === headIdx }] : []
    for (const [insertIdx, list] of placements.byRow) {
      for (const p of list) if (insertIdx <= i && i <= p.endIdx) out.push({ lane: p.lane, end: i === p.endIdx })
    }
    return out
  }
  // dotted overlays crossing the stash row at list position k above commit row i:
  // WIP → HEAD, plus stash spans whose row sits higher and whose base lies at/below i
  const stashDashesFor = (i: number, k: number): Dash[] => {
    const out: Dash[] = showWip && headIdx >= 0 && i <= headIdx ? [{ lane: wipLane, end: false }] : []
    for (const [insertIdx, list] of placements.byRow) {
      list.forEach((p, j) => {
        if (p.endIdx >= i && (insertIdx < i || (insertIdx === i && j < k))) out.push({ lane: p.lane, end: false })
      })
    }
    return out
  }

  return (
    <div className="graphview" ref={listRef}>
      {showWip && (
        <div
          className={`row wip${selection?.kind === 'wip' ? ' selected' : ''}`}
          aria-current={selection?.kind === 'wip' || undefined}
          onClick={() => onSelect(selection?.kind === 'wip' ? null : { kind: 'wip' })}
          onContextMenu={e => openMenu(e, wipItems())}
        >
          <span className="refs" onClick={e => e.stopPropagation()} onContextMenu={inert} />
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
        return (
          <Fragment key={c.hash}>
            {rowStashes?.map((p, k) => (
              <StashRow
                key={p.s.hash}
                s={p.s}
                lane={p.lane}
                passRow={rows[i]}
                width={width}
                dashes={stashDashesFor(i, k)}
                trailLane={trail ? (trail[i].through >= 0 ? trail[i].through : trail[i].incoming) : null}
                selected={selection?.kind === 'commit' && selection.hash === p.s.hash}
                onSelect={() => onSelect(selection?.kind === 'commit' && selection.hash === p.s.hash ? null : { kind: 'commit', hash: p.s.hash })}
                onMenu={e => openMenu(e, stashItems(p.s))}
              />
            ))}
            <CommitRow
              repo={repo}
              c={c}
              row={rows[i]}
              width={width}
              remotes={remotes}
              selected={selection?.kind === 'commit' && selection.hash === c.hash}
              onSelect={() => onSelect(selection?.kind === 'commit' && selection.hash === c.hash ? null : { kind: 'commit', hash: c.hash })}
              dashes={dashesFor(i)}
              trail={trail ? trail[i] : null}
              onCheckout={checkout}
              onChipMenu={(e, chip, hash) => openMenu(e, chipItems(chip, hash))}
              onRowMenu={(e, hash) => openMenu(e, rowItems(hash))}
            />
          </Fragment>
        )
      })}
      {hasMore && <button className="load-more" onClick={onLoadMore}>Load more</button>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

export default memo(GraphView)
