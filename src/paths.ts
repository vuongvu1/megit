// Display-only path helpers. Pure and DOM-free, so vitest imports them in node.

// Last segment: the repo or folder name. Splits on either separator so a Windows
// path doesn't come back whole.
export const base = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? p

// The home prefix is the longest thing every path in the picker shares and the
// least informative. The separator is part of the test on purpose: /Users/vu must
// not shorten /Users/vuong, which merely starts with it.
export const tilde = (p: string, home: string) =>
  home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))
    ? '~' + p.slice(home.length)
    : p
