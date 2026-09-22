// Which of the three states a local branch is in relative to its remote counterpart,
// and therefore what checking it out means. Kept pure so the destructive case is
// pinned by tests: only a genuine divergence may ever offer a reset.
export type CheckoutPlan = 'plain' | 'fast-forward' | 'ask' | 'reset'

// fromRemote: the click was on the remote chip (origin/x), not the local one. That
// asks for the remote's state, so anything local-only is what the user wants gone —
// but it is still commits leaving the branch, so it asks first.
export function checkoutPlan(localOnly: number, remoteOnly: number, reset: boolean, fromRemote = false): CheckoutPlan {
  // strictly behind: checking out an outdated branch is never what the click meant
  if (localOnly === 0) return remoteOnly > 0 ? 'fast-forward' : 'plain'
  // ahead only — unpushed work, the ordinary state. Checkout, touch nothing.
  if (remoteOnly === 0 && !fromRemote) return 'plain'
  return reset ? 'reset' : 'ask'
}
