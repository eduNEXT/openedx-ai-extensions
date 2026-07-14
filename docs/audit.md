You are auditing this repository as a principal-level engineer. Produce an honest audit and a prioritized, actionable improvement plan. This is analysis only: do not modify any files — the deliverable is the audit document itself.

<context>
The audit will be used to decide what to fix, in what order, before further development. Recommendations must fit the project's actual maturity and conventions — advice calibrated to a production service is wrong for a prototype, and vice versa. An honest "this area is healthy" is more useful than padded findings.

This repository is meant to work as a pluggable addition to the OpenEDX platform. It uses a structure called the full_plugin which includes frontend, backend and operations code (tutor dir).

</context>

<instructions>
Work in four phases, in order. Ground every claim in actual files — cite file paths and line numbers. If you can't verify something, say so explicitly rather than guessing. Distinguish facts ("no error handling: src/api/client.ts:142") from judgments ("this module's responsibilities feel unclear") and label which is which. Prefer 15 high-confidence findings over 50 speculative ones. If the repo is large, go deep on the core ~20% of code that does most of the work and note which areas got lighter review. Use parallel subagents or parallel file reads where it speeds up discovery.

Phase 1 — Discovery (read before judging). Map the directory structure; identify project type, languages, frameworks, entry points, and main data/control flow. Read manifests, lockfiles, build/CI config, and docs. Determine the project's purpose, intended users, and maturity. Note existing conventions (naming, boundaries, error handling, test style) so recommendations fit the culture rather than fighting it.

Phase 2 — Audit. For each dimension below, record per finding: what, where (file:line), why it matters (concrete consequence), and severity (Critical/High/Medium/Low). Also list genuine strengths — they decide what to preserve. If a dimension is healthy, say so in one sentence and move on.

Phase 3 — Strategy. Identify the 3–5 themes that explain most findings. For each: target state and the principle behind it. State explicit trade-offs, including what NOT to fix and why. Define measurable "done" signals (e.g., "CI fails on lint errors", "core module coverage ≥ 80%").

Phase 4 — Task plan. Discrete tasks, each with: title, one-paragraph description, files affected, acceptance criteria, effort (S <2h / M half-day / L 1–2 days / XL needs breakdown), risk of the change itself, and dependencies. Order into milestones: M0 safety net (tests around critical paths, CI gates) → M1 critical security/correctness fixes → M2 high-leverage improvements → M3 quality and polish. Flag quick wins (high impact, S effort) separately. For the top 3 tasks, add a brief implementation sketch (approach, key steps, gotchas).
</instructions>

<audit_dimensions>
- Architecture & design: boundaries, coupling, circular deps, god files, layering violations, scalability bottlenecks
- Code quality: duplication, dead code, complexity hotspots, swallowed exceptions, type-safety holes
- Security: hardcoded secrets, injection risks, missing validation, auth weaknesses, vulnerable dependencies, permissive configs
- Testing: coverage gaps around core logic, tests that assert behavior vs. mere execution, missing test types, untestable code
- Performance: N+1 queries, blocking calls in async paths, missing caching/indexing, unbounded growth
- Dependencies: outdated/unmaintained/heavy packages, license risks, lockfile hygiene
- DevEx & operations: setup friction, CI/CD gaps, lint/format enforcement, logging and observability, deployment story
- Documentation: README accuracy, onboarding path, undocumented critical behavior, docs that contradict code
</audit_dimensions>

<output_format>
A single document in the docs directory:
1. Executive Summary — ≤10 sentences: overall health grade A–F with justification, top 3 risks, top 3 opportunities.
2. Repo Map — purpose, stack, architecture sketch, key directories with one-line descriptions, anything surprising.
3. Audit Report — findings grouped by dimension, sorted by severity, plus a Strengths section.
4. Improvement Strategy — themes, target states, trade-offs, "done" signals.
5. Task Plan — milestones, task table, quick wins, top-3 implementation sketches.
6. Open Questions — anything that needs a human decision (product intent, deprecation candidates, performance targets).
</output_format>
