# Beecoded agent plugins

Bee, Nectar, Code Audit, and UI/UX Audit are independently distributed npm packages, each usable by both Claude Code and Codex:

| Product | npm package | Claude Code | Codex |
|---|---|---|---|
| Bee | `@beecoded/bee` | `/bee-init` | `$bee-init` |
| Nectar | `@beecoded/nectar` | `/nectar-shape` | `$nectar-shape` |
| Code Audit | `@beecoded/code-audit` | `/code-audit` | `$code-audit` |
| UI/UX Audit | `@beecoded/ui-ux-audit` | `/ui-ux-audit` | `$ui-ux-audit` |

The npm installer creates standalone, product-prefixed user skills. Claude Code
uses `/bee-*`, `/nectar-*`, `/code-audit`, and `/ui-ux-audit`; Codex uses the same names with `$`. The plugin
manifests retain hooks and agents but do not expose a second namespaced command
surface.

The complete Bee surface is preserved, including `/bee-review-implementation`, `/bee-fix-implementation`, and `/bee-archive-spec` on Claude Code, with the corresponding `$bee-...` skills on Codex.

## Install

Run the package you want. The installer detects Claude Code and Codex in `PATH`; when both are present, it installs into both automatically.

```bash
npx @beecoded/bee@latest
npx @beecoded/nectar@latest
npx @beecoded/code-audit@latest
npx @beecoded/ui-ux-audit@latest
```

To target one host explicitly:

```bash
npx @beecoded/bee@latest --claude
npx @beecoded/bee@latest --codex
```

Global npm installation is also supported. Global installation exposes the runner, which is then executed once to configure the detected hosts:

```bash
npm install --global @beecoded/bee@latest
bee

npm install --global @beecoded/nectar@latest
nectar

npm install --global @beecoded/code-audit@latest
code-audit

npm install --global @beecoded/ui-ux-audit@latest
ui-ux-audit
```

The runner manages the host marketplace registration internally; users do not need to run `claude plugin` or `codex plugin` commands themselves.

## Update, downgrade, and uninstall

Running the latest package again updates only that product on every detected host. A package older than the installed version is rejected unless the user explicitly confirms the downgrade:

```bash
npx @beecoded/code-audit@latest --all
npx @beecoded/ui-ux-audit@latest --all

code-audit --all --allow-downgrade
ui-ux-audit --all --allow-downgrade
```

The `--allow-downgrade` form is intended for a globally installed or deliberately version-pinned runner. Uninstall removes only the selected product's owned skills, plugin registration, and local marketplace; the other products remain installed:

```bash
code-audit uninstall --all
ui-ux-audit uninstall --all
```

Use `--claude` or `--codex` instead of `--all` for a single host.

## Audit boundaries

Code Audit writes `code-audit-YYYY-MM-DD.md` by default and may use another safe path requested by the user; a rerun can replace an existing normal target, so choose an unused path when existing content must be preserved. UI/UX Audit writes `ui-ux-audit-YYYY-MM-DD.md`, refuses existing unmarked reports, and may retain sanitized, audit-owned evidence under `ui-ux-audit-evidence-YYYY-MM-DD/`.

UI/UX Audit requires a host-provided rendered browser; it does not bundle Chromium, Playwright, or an MCP server. Evidence remains labeled `BROWSER_VERIFIED`, `AUTOMATION_PROVEN`, `SOURCE_TRACED`, `NOT_OBSERVED`, `BLOCKED`, or `PRODUCT_DECISION`. Missing browser capability, authentication, role, route, or safe state remains an explicit gap, and source-only inspection never becomes a verified visual verdict.

Both audit products are report-only: they never auto-fix, commit, push, publish, deploy, initialize Bee/Nectar state, or ship audited code.

## Structure

Each package is a complete plugin root and contains both host manifests:

```text
plugins/<product>/
  package.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  internal-skills/
```

Bee keeps its canonical workflow definitions in `workflows/` and thin generated
entry sources in `internal-skills/`. Nectar keeps its ten canonical entry
sources in `internal-skills/`. Code Audit generates its single standalone entry
and the Nectar compatibility entry from one shared risk methodology. UI/UX Audit keeps one
browser-first entry plus host capability references and does not bundle a browser or MCP server. The installer materializes those entries into
each selected host's user skill directory with Beecoded ownership metadata and
durable references to the managed package under `~/.beecoded/`.

Claude Code and Codex use separate marketplace formats. The npm runner creates a persistent, product-specific local marketplace under `~/.beecoded/marketplaces/` and registers it automatically in every detected host.

## Development

```bash
npm install
npm run generate:codex
npm run generate:installers
npm run generate:audit-surfaces
npm run validate
npm run eval:plugins -- --all --dry-run
npm run pack:check
```

The generated Bee wrappers, audit compatibility surfaces, and managed package installers are committed and
checked before packing. Package validation, installer lifecycle smoke, and
behavioral-eval discovery all derive their product roster from
`tools/plugin-products.mjs`; adding a package does not require a second list in
the root scripts. Behavioral evals use host-neutral contracts and expose
Claude/Codex execution only when the corresponding CLI is selected.

Before a breaking release, the opt-in host smoke invokes installed Bee and
Nectar skills through both real CLIs. It uses isolated plugin homes,
temporarily copies the existing Codex login without printing it, and can incur
model usage:

```bash
npm run test:installed-commands
```

Nectar's Atlas release gate is deterministic and does not invoke a model. It
packs and globally installs the actual tarball in isolated homes, validates the
Claude Code and Codex MCP registrations, and exercises the complete Atlas
lifecycle:

```bash
npm run test:atlas-release
```

## Publishing

Publish the packages independently from this workspace:

```bash
npm publish --workspace @beecoded/bee
npm publish --workspace @beecoded/nectar
npm publish --workspace @beecoded/code-audit
npm publish --workspace @beecoded/ui-ux-audit
```

Publishing is intentionally separate from validation. The package runner changes host configuration only when the user invokes it through `npx`, `bee`, `nectar`, `code-audit`, or `ui-ux-audit`; npm lifecycle scripts never do so implicitly.
