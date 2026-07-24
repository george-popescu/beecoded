# Beecoded agent plugins

Bee and Nectar are distributed as two npm packages, each usable by both Claude Code and Codex:

| Product | npm package | Claude Code | Codex |
|---|---|---|---|
| Bee | `@beecoded/bee` | `/bee-init` | `$bee-init` |
| Nectar | `@beecoded/nectar` | `/nectar-shape` | `$nectar-shape` |

The npm installer creates standalone, product-prefixed user skills. Claude Code
uses `/bee-*` and `/nectar-*`; Codex uses the same names with `$`. The plugin
manifests retain hooks and agents but do not expose a second namespaced command
surface.

The complete Bee surface is preserved, including `/bee-review-implementation`, `/bee-fix-implementation`, and `/bee-archive-spec` on Claude Code, with the corresponding `$bee-...` skills on Codex.

## Install

Run the package you want. The installer detects Claude Code and Codex in `PATH`; when both are present, it installs into both automatically.

```bash
npx @beecoded/bee@latest
npx @beecoded/nectar@latest
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
```

The runner manages the host marketplace registration internally; users do not need to run `claude plugin` or `codex plugin` commands themselves.

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
sources in `internal-skills/`. The installer materializes those entries into
each selected host's user skill directory with Beecoded ownership metadata and
durable references to the managed package under `~/.beecoded/`.

Claude Code and Codex use separate marketplace formats. The npm runner creates a persistent, product-specific local marketplace under `~/.beecoded/marketplaces/` and registers it automatically in every detected host.

## Development

```bash
npm install
npm run generate:codex
npm run validate
npm run pack:check
```

The generated Bee wrappers are committed and validated against the canonical
workflow roster.

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
```

Publishing is intentionally separate from validation. The package runner changes host configuration only when the user invokes it through `npx`, `bee`, or `nectar`; npm lifecycle scripts never do so implicitly.
