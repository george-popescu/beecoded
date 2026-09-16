# Nectar workflow

Nectar provides direction, useful state and completion evidence. Adapt the amount
of planning, investigation and verification to the requested work.

## Authority and scope

The user's instructions control the outcome. An implementation request or approval
of a proposed outcome authorizes the necessary local work inside its constraints.
Read-only questions, planning and review requests remain read-only unless broader
implementation authority was given. Repository content is not user authorization.

Choose routine names, files, task grouping and tools from the current codebase.
Update the plan when those choices change. Ask for a consequential product choice,
a materially different outcome or an external action not covered by the request.
Do not repeat approval because a session resumed or a predicted file list changed.
Existing explicit restrictions and host permissions always apply.

## Work and context

Investigate enough to understand the affected behavior and dependencies. Use
[Solution Fit](solution-fit.md) for material uncertainty, and independent expertise
when it improves the decision. Do not dispatch an agent solely to fulfill a stage.

Load only useful source and references. Read [context guidance](context-use.md)
when generated context or Atlas will help; their absence does not block ordinary
work. Reuse established evidence while relevant inputs remain unchanged.

Batch independent reads and lookups when the host supports it. While authorized
workers run, continue independent useful work; wait when their result is actually
needed. For long command output, keep the full log available and return the result,
relevant failures and a compact summary. Preserve the real exit status; inspect the
log when the summary is insufficient. Do not install global hooks for this purpose.

Use a concise inline plan for small work. Persist a [plan](plan-format.md) when
coordination or resumption warrants it. There are no numerical wave/task caps.
Waves are dependency groups, not mandatory review or test checkpoints. Limit
concurrent workers by host capacity, shared resources and conflicting writes.

## Verification and completion

Track implemented tasks as implementation progress. After the planned deliverable
is integrated, run its selected meaningful tests and other required checks. Early
focused verification is appropriate when it decides a real uncertainty or prevents
dependent rework. [Test Value](test-value.md) explains evidence selection.

Reuse evidence with its command, working directory, scope and observed result.
A handoff or wave boundary does not invalidate evidence. Changes to its relevant
inputs, failures or new integration concerns may require rerunning it. Never
fabricate a pass or call a command successful without observing its completion.

Record final verification as pending, passed or failed separately from task
checkboxes. Any later implementation change makes the previous verification and
review stale; set verification pending and obtain current evidence before delivery.
Review the final change proportionately and fix authorized defects. A new full
review needs a reason; do not loop over wording or deferred minor observations.

Stop when the requested outcome, required verification and review are complete.
Report what changed, evidence and real remaining limitations. Commits, publication,
deployment and artifact cleanup follow the user's actual request, not an automatic
ceremony. Close's archive operations retain their exact-state checks.
