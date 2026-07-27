import { useEffect, useState } from 'react'

// Error surface for the git mutations. `alert()` did this job but blocks the event
// loop — SSE refreshes queue behind it — and only ever shows one message, so a
// second failure overwrites the first before it is read.
//
// ponytail: module-level `push`, not a context provider. One <Toasts/> lives in
// App, so there is nothing to thread through the tree. Breaks the day a second
// host renders; a provider is the upgrade path.
let push: (m: string) => void = () => {}
let seq = 0

export const toastErr = (m: string) => push(m)

export default function Toasts() {
  const [msgs, setMsgs] = useState<{ id: number; m: string }[]>([])

  // In an effect, not the render body: setMsgs is stable, so wiring once keeps
  // render pure and survives StrictMode's double invoke.
  useEffect(() => {
    push = m => {
      const id = ++seq
      setMsgs(l => [...l, { id, m }])
      setTimeout(() => setMsgs(l => l.filter(t => t.id !== id)), 6000)
    }
  }, [])

  if (!msgs.length) return null
  return (
    <div className="toasts">
      {msgs.map(t => (
        // role=alert keeps the announcement alert() gave for free.
        <div key={t.id} className="toast" role="alert" onClick={() => setMsgs(l => l.filter(x => x.id !== t.id))}>
          {t.m}
        </div>
      ))}
    </div>
  )
}
