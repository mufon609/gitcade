# BLOCKED.md — GitCade Open Blockers

`[CRITICAL]` and `[PUBLISH]` entries go at the TOP and halt/gate work. Plain
`[PERIPHERAL]` entries are logged-and-routed-around per the ENVIRONMENT.md
two-tier escalation protocol. Resolve and strike through (or delete) entries as
they are cleared.

---

## [RESOLVED 2026-06-13] System Chromium binary is not actually installed — raised 2026-06-13 (Phase 1)

**Was:** ENVIRONMENT.md listed Chromium as apt-installed, but the apt package is
uninstallable on this rolling box (`dpkg -l chromium` state `rc`; a reinstall
fails on a `libflac12` / `chromium-common` dependency conflict — not a sudo
issue, the package simply isn't installable). No binary existed on PATH.

**Resolution:** A working headless **and** headed browser already exists in
user-space — Playwright's Chrome-for-Testing 148 under `~/.cache/ms-playwright`,
verified launching with `--disable-gpu --use-gl=swiftshader` and rendering DOM.
A `~/.local/bin/chromium` shim (on PATH) now exposes it as `chromium`, resolving
the newest cached build dynamically. ENVIRONMENT.md's tool table + testing-
constraints section were corrected to describe this instead of apt. The apt
package is **not needed**: Phase 4A's builder image bundles its own Chromium, and
manual site browsing uses the installed `firefox`. Phase 1 was completed and
verified without a browser regardless (Node-simulation smoke + dev-server HTTP
probe). No follow-up required.
