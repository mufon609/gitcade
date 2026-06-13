# CLAUDE.md — GitCade Operating Contract

You are building **GitCade**: a platform where AI-built, open-source browser games are published, played, forked, remixed, and governed by community vote. This file is loaded every session. It tells you *how to operate* — it does not restate what the other docs own. Read it, read the docs it points to, then act.

---

## Read order (every session, before any work)
1. **This file** — how to operate.
2. **MASTER-PLAN.md** — *what to build*: the locked decisions (§2), build order + monorepo layout (§3), the phase you're on (its prompt, Definition of Done, handoff contract), and the validation gates (§4).
3. **ENVIRONMENT.md** — *the machine*: what's installed, the no-sudo rule, ports, container/networking traps, and the full escalation protocol.
4. **DECISIONS.md** — assumptions inherited from prior phases. Append to it; never contradict it. *(Created in Phase 0; may not exist yet on a fresh box.)*
5. **BLOCKED.md** — open blockers. If a `[CRITICAL]` or `[PUBLISH]` entry is unresolved and your phase depends on it, stop and say so. *(Created on first blocker; may not exist yet.)*

**Precedence when they conflict:** ENVIRONMENT.md (machine reality) > Locked Decisions (MASTER-PLAN §2) > phase prompt > this file's guidance. A locked decision is never overridden by convenience.

Authoritative homes — do not duplicate these here:
- **Locked product/security rules** (the "never" rules: config-as-data, the storage bridge, no GitHub Actions on game repos, artifact-server-only serving, public-repos-only, etc.) → **MASTER-PLAN.md §2**.
- **Machine facts** (Node/npm, no-sudo, Postgres/MinIO URLs + keys, ports, S3 path-style, container traps) → **ENVIRONMENT.md**.
- **Conventions** (monorepo layout, the two game tiers, npm publishing + version pinning, TypeScript/Vitest) → **MASTER-PLAN.md §2–§3**.

---

## The one rule that matters most
**One phase per session. Do not cross phase boundaries.** Build exactly the phase you're given, to its Definition of Done — no more (don't pull work forward from later phases) and no less (don't declare done with DoD items failing). Each phase ends at a handoff contract the next session depends on; honoring that boundary is what makes this project work.

## The second rule: respect frozen contracts
Once a phase freezes something (the SDK schema, a published package's public API), its **shape and contracts are immutable**. Bug fixes are still allowed via the **patch-release protocol** — fix without changing any contract, bump PATCH, write a `[PUBLISH]` entry to BLOCKED.md, repin affected consumers. A fix that *requires* a contract change is not a patch — it HALTS for a human decision. Full protocol in **MASTER-PLAN.md §3**.

---

## Escalation — when you hit a wall
Two tiers (full detail in **ENVIRONMENT.md**):
- **CORE blocker** (database, build pipeline, artifact storage/serving, auth, SDK/schema contract — anything a later phase inherits frozen) → **HALT.** Write a `[CRITICAL]` entry at the top of BLOCKED.md, print it as your final output, end the session. **Never mock or stub the foundation.**
- **PERIPHERAL blocker** (optional tool, nice-to-have) → log it in BLOCKED.md and route around. Stubs allowed ONLY behind an interface, marked `// STUB:`, and listed in BLOCKED.md.
- **Ambiguous whether it's core?** → it's core. Halt.
- **Ambiguous about a requirement** (not a blocker)? → choose the most reversible option, record it in DECISIONS.md, continue.

Halting is cheap; lying with stubs is never worth it.

---

## Definition of done discipline
A phase is done when **every** DoD item in MASTER-PLAN passes — verified, not assumed. Before declaring done:
1. Run the phase's tests and the relevant `gitcade validate` checks; paste real output, don't claim green.
2. Confirm the handoff artifacts exist and are named exactly as the next phase expects.
3. Append this session's assumptions to DECISIONS.md.
4. If anything is incomplete, say so plainly and list what remains — a half-done phase honestly reported beats a "done" that the next session discovers is hollow.

## Working style for this project
Bias to action within the current phase; ask nothing about requirements (make the reversible choice and log it). Keep changes scoped — don't refactor neighboring phases' code. Comment the non-obvious, especially anything touching a frozen contract. When you finish, your last message is a short status: what's done, DoD verification, what the next session inherits.
