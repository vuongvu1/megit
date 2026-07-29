# Security

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | yes |
| < 0.1 | no |

## Reporting a vulnerability

Report privately through [GitHub's security advisory form](https://github.com/vuongvu1/megit/security/advisories/new). Please don't open a public issue for a vulnerability.

Expect a first reply within a week. If a fix is warranted it ships in the next patch release, credited unless you'd rather not be.

## Threat model

megit is a local, single-user tool. It runs a server on your own machine, shells out to your own `git`, and reads your own repositories. There is no account system, no remote backend, and nothing is transmitted anywhere — the one outbound request is an optional Gravatar avatar lookup keyed by the commit author's email hash.

The boundary megit defends is **the browser**: a web page you happen to have open should not be able to reach the local API, read your repositories, or get a shell.

### What is enforced

- **Loopback bind.** The server listens on `127.0.0.1` only, never `0.0.0.0`, so it is not reachable from the network.
- **Host header pinning.** Every request must carry a `Host` of `localhost`, `127.0.0.1`, or `[::1]`. Loopback binding alone does not stop DNS rebinding: an attacker page can repoint `attacker.tld` at `127.0.0.1`, at which point the browser treats the API as same-origin and CORS never applies. A rebound request still carries the attacker's hostname, so pinning `Host` rejects it.
- **WebSocket origin check.** `/api/term` hands out a PTY, and WebSockets bypass CORS entirely. The upgrade is refused unless `Origin` is a loopback URL. A missing `Origin` is allowed, since that means a non-browser client already running on the machine.
- **Repository allow-list.** Every repo-scoped route goes through a guard that rejects any path not registered in `~/.config/megit/config.json`. Pointing megit at a repository is always a deliberate act; a path alone is never enough.
- **Revisions are allow-listed, not escaped.** git treats a leading-dash revision as an option, and options like `git diff --output=<file>` write files. Client-supplied revs must match a hex-hash pattern rather than being escaped.
- **Path containment on blob reads.** Serving worktree file contents resolves through `realpath` and rejects anything landing outside the repository root — a cloned repo can contain a symlink pointing elsewhere, and git will materialise it on checkout. File types are also restricted to a small MIME allow-list.
- **No blocking credential prompts.** Git runs with `GIT_TERMINAL_PROMPT=0` and stub askpass helpers, so a passphrase-protected key or expired token fails fast instead of hanging a request on stdin nobody is attached to.

### What is not

- **There is no authentication.** Anything that can already run code as your user on your machine can talk to the server, and the terminal panel is a full shell with your privileges. On a shared or multi-user machine, treat a running megit as equivalent to an open terminal. Don't run it on a host you don't trust the local users of.
- **megit runs your git, with your config.** Hooks, aliases, `core.fsmonitor`, credential helpers — all of it applies. Opening a repository is as safe, or unsafe, as running `git log` in it.
- **Write operations are real.** Reset, rebase, force-delete and discard do what they say. Destructive items are marked in the UI, but there is no undo beyond git's own reflog.
