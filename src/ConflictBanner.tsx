import type { OpKind } from '../server/operation.ts'

const VERB: Record<OpKind, string> = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
}

export default function ConflictBanner({ op, conflicts, busy, onAbort, onContinue }: {
  op: { kind: OpKind; label: string }
  conflicts: number
  busy: boolean
  onAbort: () => void
  onContinue: () => void
}) {
  return (
    <div className="conflict-banner">
      <span className="cb-verb">{VERB[op.kind]}</span>
      {op.label && <span className="cb-label">{op.label}</span>}
      <span className="cb-count">
        {conflicts === 0
          ? 'all conflicts resolved'
          : `${conflicts} conflict${conflicts > 1 ? 's' : ''} remaining`}
      </span>
      <button className="danger" disabled={busy} onClick={onAbort}>Abort</button>
      <button className="primary" disabled={busy || conflicts > 0} onClick={onContinue}>Continue</button>
    </div>
  )
}
