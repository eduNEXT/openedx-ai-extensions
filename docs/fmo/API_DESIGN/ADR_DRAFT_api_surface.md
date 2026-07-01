# Draft ADR — The `openedx-ai-extensions` public API surface

> **Status:** Draft / exploratory. This captures the *goals* behind the design
> in `ATTEMPT_TWO.md`, not the mechanisms and not a finished decision. Form,
> structure, and wording are all still open — the point here is to agree on what
> we are trying to achieve before we argue about how.

## Context

The plugin already has real consumers reaching for AI (AI coach,
xblock-ai-evaluation, ORA, badges) plus the framework's own workflows. Today
each reaches in through different, unstable seams and gets back ad-hoc shapes.
We want to name **one supported surface** — an `api.py` — that these consumers
call, so the framework can keep evolving underneath without breaking them.

This ADR records *what that surface is meant to expose* and *why*, so later
design and review can be measured against the goals rather than against taste.

## What the API exposes (at a glance)

- A single **principal call** to run an AI profile and get a typed result.
- A typed **result envelope** carrying status + payload + metadata (+ session).
- A small set of **value objects** for "where/for whom" a call happens.
- A **profile** concept: good defaults in code, operator override in the DB.
- A **pre-check** to ask "is this usable here?" without running anything.
- **Session** access that hides the storage details.
- The **orchestrator/processor base classes** as the sanctioned extension point.

Everything else — the LLM engine, litellm, the persistence backend, the
resolution internals — is deliberately *not* exposed.

## Goals

**1. One stable, supported surface.**
Consumers should depend on `api.py` and nothing else. Internals must be free to
change without a coordinated migration for every plugin that uses AI.

**2. Totality — the surface never punishes absence.**
Importing the API must always work, and a call must always return a typed
outcome — never raise because an engine, key, or configuration is missing.
"Not available" is a normal, typed answer, not an exception the caller handles.

**3. Predictable, typed outcomes.**
Callers should never receive raw, unstatused LLM text or have to shape-sniff a
dict. Every result states what happened; the easy path ("just give me the
text") stays easy without letting a caller skip the status by accident.

**4. Operator authority is structural.**
The operator running the platform — not the developer writing the consumer —
holds final say over which model/provider and prompt run, and whether AI runs at
all in a given scope. Developers supply good defaults; operators override them.

**5. Reach beyond XBlocks.**
Many kinds of consumers want this (XBlocks, other plugins, courseware, future
surfaces). The inputs a caller passes must be plain, serializable, and free of
any XBlock or ORM shape, so the same API works from a request, a task, or a
block.

**6. Evolve the existing framework, don't rewrite it.**
The surface should sit *on top of* the machinery that already exists
(profiles, scope resolution, orchestrators, sessions), adding the minimum
net-new. Grounding in what's there is a goal, not an accident.

**7. Keep heavy dependencies optional and internal.**
The LLM engine (and its heavy libraries) must stay out of the always-importable
core and be swappable behind one internal seam — there is one engine, and it is
an implementation detail, never part of the contract.

**8. Extensibility lives in orchestrators, not the engine.**
We expect *many* orchestrators/processors for a myriad of use cases; that is the
sanctioned place to add behavior, via subclassing. The API should make that the
obvious extension path while keeping the engine singular and closed.

**9. Developer ergonomics: define-and-call.**
A developer should be able to declare a profile in code and run it immediately,
with operator overrides applied transparently if they exist — no ceremony, no
model authoring required for the common case.

**10. A durable record of AI work, for free.**
Consumers should get their AI interactions persisted without writing storage
code, and without the response type being entangled with how storage happens.

**11. Long-term supportability by design.**
The surface should adopt the standard longevity practices (explicit public
exports, shipped types, enforced boundaries, staged deprecation) so that keeping
faith with consumers over years is cheap rather than heroic.

## Non-goals (for this surface, now)

- **Human-in-the-loop approval / grading review.** Acknowledged, deliberately
  out of scope; the result shape leaves room for it later.
- **Cost/budget enforcement.** We report usage; we do not police spend yet.
- **A separate "grading" or "chat" verb.** These are use-cases served by
  orchestrators, not first-class API verbs.
- **Multiple interchangeable engines.** One engine; no plugin-discovery for it.
- **Exposing the LLM/litellm layer.** Internal, by intent.

## Key trade-offs we are accepting

- **A thin façade adds an indirection layer** over machinery consumers could
  call directly — accepted, because the stability and totality guarantees are
  worth it.
- **Operator authority can override developer intent** — accepted, because
  operator control is the goal, not a side effect.
- **One profile model change** (a code-origin default) is required to reach the
  define-and-call ergonomic — accepted as the single structural cost.
