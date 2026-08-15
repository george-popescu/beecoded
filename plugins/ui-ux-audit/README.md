# UI/UX Audit

`@beecoded/ui-ux-audit` is a standalone browser-first audit skill for Claude Code and Codex. It verifies rendered user journeys across roles, UI states, and viewports, then writes a reproducible coverage matrix instead of an aggregate quality score.

## Install

```bash
npm install --global @beecoded/ui-ux-audit
ui-ux-audit --all
```

Use `ui-ux-audit --claude` or `ui-ux-audit --codex` to select one host. Running `ui-ux-audit --all` again updates only UI/UX Audit. Older package runners are rejected unless the user explicitly invokes `ui-ux-audit --all --allow-downgrade`. Use `ui-ux-audit uninstall --all` to remove only this product's registrations and managed skill.

## Use

- Claude Code: `/ui-ux-audit`
- Codex: `$ui-ux-audit`

Provide the target URL, intended environment, important journeys, and roles. Sign in only through the selected browser when the host asks. Never paste credentials into chat.

The default report is `ui-ux-audit-YYYY-MM-DD.md`. Owned reports and evidence directories carry product markers and existing unmarked paths are never overwritten. Sanitized audit-owned screenshots or traces may be stored under `ui-ux-audit-evidence-YYYY-MM-DD/`; sensitive screens default to stable browser evidence identifiers instead of repository copies. Those are the only project writes; the audit never changes source, Git state, browser settings, or persistent application data and never auto-fixes, commits, pushes, publishes, deploys, initializes Bee/Nectar state, or ships audited code.

## Browser prerequisites

The package bundles no browser, Chromium, Playwright, or MCP server. It discovers the current host's browser capability:

- Claude Code can use Claude in Chrome when the extension/connector, site permission, and plan policy allow it.
- Codex can use its in-app browser or Chrome browser surface; optional Developer mode may expose deeper console and network evidence.

If a rendered browser, authentication, role, route, or safe application state is unavailable, the report marks that coverage `BLOCKED` or `NOT_OBSERVED`. Source inspection remains `SOURCE_TRACED` and cannot produce a completed visual verdict.

## Evidence and coverage

The default rendered matrix is 390x844, 768x1024, and 1440x1000, plus a 320x800 critical reflow check. Applicable success, loading, empty, error, validation, keyboard, focus, overlay, navigation, overflow, console, and network states are recorded in the coverage matrix.

Evidence remains explicitly separated as `BROWSER_VERIFIED`, `AUTOMATION_PROVEN`, `SOURCE_TRACED`, `NOT_OBSERVED`, `BLOCKED`, or `PRODUCT_DECISION`. Findings include route, role/session, viewport, state, reproduction, expected and actual behavior, evidence identifier, severity, and confidence.

Typing and other mutation-capable controls are exercised only in a user-provided disposable record or environment. Repository evidence is minimized and sanitized; raw credentials, headers, network bodies, tokens, session data, and unredacted authenticated screenshots are never retained.

## Development

```bash
npm test --workspace @beecoded/ui-ux-audit
npm run validate --workspace @beecoded/ui-ux-audit
npm run eval:plugins -- --product ui-ux-audit --all --dry-run
npm pack --workspace @beecoded/ui-ux-audit --dry-run
```

Behavioral evaluation is capability-aware: deterministic blocked/source-only cases run without a browser, while a live verified audit requires a host-provided rendered browser and explicit target access.

## Publication

Publishing remains a separate release action:

```bash
npm publish --workspace @beecoded/ui-ux-audit --access public
```

## License

MIT
