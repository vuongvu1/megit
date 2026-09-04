# Security

## Supported versions

| Version | Supported |
| --- | --- |
| 0.10.x | yes |
| < 0.10 | no |

## Reporting a vulnerability

Report privately through [GitHub's security advisory form](https://github.com/vuongvu1/megit/security/advisories/new). Please don't open a public issue for a vulnerability.

Expect a first reply within a week. If a fix is warranted it ships in the next patch release, credited unless you'd rather not be.

## Threat model

megit is a local, single-user tool. It runs a server on your own machine, shells out to your own `git`, and reads your own repositories. There is no account system and no remote backend. The only outbound traffic is author avatar resolution: the GitHub commits API maps a commit's author email to an account, the photo itself comes from `avatars.githubusercontent.com`, and anything GitHub can't resolve falls back to a Gravatar lookup keyed by the SHA-256 of the email. Turning off **author avatars** in Settings stops all of it; nothing else leaves the machine.

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

## Dependency alerts

megit's runtime dependency tree is three packages: `ws`, plus the optional `node-pty` and its own `node-addon-api`. Everything else — React, Vite, xterm.js, diff2html — is a `devDependency` that Vite inlines into `dist/` at build time and never installs on a user's machine. That is deliberate, and it means supply-chain scanners have very little to report.

What they do report is mostly a description of what megit is. A git GUI with an embedded terminal genuinely uses **shell access**, **filesystem access**, **environment variable access** and **native code** (the PTY binding), and it genuinely runs an **install script** (`node-gyp` building that binding). `node-pty` loads through a dynamic `import()` so it costs nothing until you open the terminal, which also shows up as **dynamic require**. **Network access** in megit itself is the avatar resolution described above; in the dependencies it is `ws`, which is a WebSocket library. None of these are findings so much as an accurate inventory.

The one class worth spelling out is [Socket](https://socket.dev/npm/package/megit-app)'s `gptAnomaly`, "AI-detected potential code anomaly", because the name suggests more than the contents. As of 0.8.0 it reports three instances, all in dependency files and none in megit's own code:

- `ws` → `lib/event-target.js`. Socket's own analysis text concludes it is a standard EventTarget mixin with "no suspicious patterns such as dynamic code execution, hardcoded secrets, or network activity".
- `node-addon-api` → `tools/clang-format.js`, reached transitively through `node-pty`. Socket's text again concludes it is a "legitimate formatting helper" with no malicious behaviour. It is a repo tooling script that never executes at runtime.
- `node-pty` → `deps/winpty/misc/FontSurvey.cc`. This one is a real command injection — argv interpolated into `sprintf` and handed to `system()` — in a vendored Windows console debugging tool. The file is not referenced by `node-pty`'s `binding.gyp`, so it is never compiled and never ships as a binary; it is dead source in the tarball. It is gone in `node-pty` 1.2.0, which drops winpty entirely, and megit will pick that up when 1.2.0 leaves beta.

Clearing the first two from megit's side would mean dropping `ws` for a hand-rolled RFC 6455 implementation, and clearing the third would mean dropping the terminal. Neither trade is worth making for findings whose own evidence says they are benign.

Socket's **URL strings** alert is an inventory of every URL literal in the published tarball, and most of its entries are not megit's: React's `react.dev/errors/`, XML namespace constants, highlight.js issue links, and the GitHub links in diff2html's syntax themes all arrive inside the bundled `dist/`. The ones megit itself contributes are `127.0.0.1` for the loopback bind, `github.com/vuongvu1/megit` for the link in Settings, and the avatar endpoints listed in the threat model. The alert reports that URLs exist in the source, not that any of them is contacted — only the avatar endpoints ever are, and only with avatars on.

If you find a dependency alert that *isn't* covered above, please report it — through the advisory form if it looks exploitable, or as a normal issue if you just want it triaged.
