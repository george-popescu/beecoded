# Reuse host capabilities

Use this when native checks or a running application can supply selected evidence.
Discover tools actually available in this session; documentation or a model name
does not prove local availability.

Claude Code may provide `/run`, `/verify`, `/code-review` and `/security-review`.
Respect their invocation rules and side effects. Manual-only skills remain manual;
use another permitted check or state the limitation. Read an existing launch recipe
when useful. Do not generate or install one merely to finish an ordinary task.
Avoid generic `verify` or `simplify` skill names: project skills with those names
can introduce native pre-commit checks.

Codex may expose browser control, code review, terminal checks and CI evidence.
Use the available host tools without assuming Claude commands exist. Keep the
user's model and effort settings; Nectar does not select a model tier.

For UI behavior, inspect the affected journey in a running browser when available,
including relevant states and viewports. A build does not prove visual correctness.
Use disposable data for interactions that persist changes. A complete UI/UX audit
is a separate request, not required after every UI edit.

Reuse native or CI evidence only when relevant files, configuration, environment
and acceptance conditions match. Native success does not prove deployment or
unobserved behavior. If a required hook will run a check, account for that execution
instead of scheduling an identical Nectar check immediately before it; inspect its
actual result. Do not disable required checks to save time.

Report uncovered requirements honestly. Avoid new hooks, duplicate reviews, tool
installation and fresh context indexes without a task-specific need.
