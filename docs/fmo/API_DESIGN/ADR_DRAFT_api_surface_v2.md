# Draft ADR (v2) — AI capabilities API and its delivery

> **Status:** Draft / exploratory, goals-focused. This is the second pass. It
> captures *goals*, not mechanisms, and it deliberately separates two decisions
> that the first draft ran together. Form and wording are still open.

## Context

Several consumers already want AI inside Open edX — the AI coach,
xblock-ai-evaluation, ORA, badges — and more places will (forum, courseware,
other plugins). Today each wires its own provider call, prompt handling,
storage, and error shapes. And the handful of existing "AI XBlocks" that do this
are built on obsolete models and can, at best, tweak a prompt — nothing beyond
it.

This is a new phase of `openedx-ai-extensions`. The project's first phase built
*new* AI surfaces and integrations for the platform. This phase is about
**connecting the capabilities that framework already provides into existing
platform code** — the forum, XBlocks, and other plugins — rather than adding
more new surfaces.

Two distinct questions have emerged, and conflating them muddies both. This ADR
treats them as **two separate decisions**:

- **Decision A — the API:** *what* AI capability we expose to consumers, and the
  goals behind that surface.
- **Decision B — the delivery:** *how* that API reaches consumers in code, and
  the goals behind that mechanism.

### Why expose an API at all

Because the alternative is what we have: every consumer re-implementing the same
provider calls, prompt plumbing, storage, and analytics, with no shared place
for an operator to govern which model runs, with which prompt, or whether AI
runs at all. A single surface lets us (a) give consumers real AI capability
without each reinventing it, (b) put the operator in control, and (c) move the
ecosystem past the prompt-only AI XBlocks toward something extensible.

---

## Decision A — The API surface

### What it exposes (at a glance)

- A single **principal call** to run an AI profile and get a typed result.
- A typed **result envelope** carrying status + payload + metadata (+ session).
- A small set of **value objects** for "where / for whom" a call happens.
- A **profile** concept: good defaults in code, operator override in the DB.
- A **pre-check** to ask "is this usable here?" without running anything.
- **Streamlined session access** — a simple, uniform way to read and write
  session state so consumers don't fiddle with storage internals (the internals
  may still be reachable; they just shouldn't be required).
- The **orchestrator / processor base classes** as the sanctioned way to add
  behavior.

### Goals

**A1. One stable, supported surface.**
Consumers depend on `api.py` and nothing else; internals stay free to change
without a coordinated migration for every plugin that uses AI.

**A2. Predictable, typed, schema-shaped results.**
Callers never receive raw, unstatused LLM text or have to shape-sniff a dict.
Every result states what happened, and the easy path ("just give me the text")
stays easy. Crucially, a consumer should be able to **hand us a schema and get a
response guaranteed to match it** — knowing the shape they'll get back is a
first-class ergonomic (streaming is the one case that needs its own treatment).
Failure modes (not configured, not installed) are fine as long as they are
**predictable and documented**, so downstream code can plan for them rather than
be surprised by an exception.

**A3. Operator authority is structural.**
The operator running the platform — not the developer writing the consumer —
has final say over model/provider, prompt, and whether AI runs at all in a given
scope. This is also a concrete upgrade over the status quo: the existing AI
XBlocks are built on obsolete models and expose little to no control over the
prompt, and nothing beyond it. The framework offers real prompt governance plus
orchestrators and processors for more advanced extension.

**A4. Reach beyond XBlocks.**
XBlocks, other plugins, courseware, and future surfaces all want this. The
inputs a caller passes must be plain, serializable, and free of any XBlock or
ORM shape, so the same API works from a request, a task, or a block.

**A5. Evolve the existing framework, don't rewrite it.**
The surface sits *on top of* what already exists (profiles, scope resolution,
orchestrators, sessions), adding the minimum net-new. Grounding in what's there
is a goal, not an accident. A side effect we accept: the internals of the
existing REST API may need reworking to match what this surface exposes — normal
evolution, recorded as a consequence rather than avoided.

**A6. Make writing orchestrators and processors easy.**
Much of what consumers want may be achievable through a prompt alone — but when
it isn't, writing a custom orchestrator or processor should be a first-class,
well-supported path, not a fight with the framework.

**A7. Define-and-call ergonomics.**
A developer can declare a profile in code and run it immediately, with operator
overrides applied transparently if they exist.

**A8. A durable record — and analytics — for free.**
Consumers get their AI interactions persisted without writing storage code, and
without the response type being entangled with how storage happens. The same
default wires in xAPI, so analytics and the Aspects platform light up out of the
box.

**A9. Long-term supportability by design.**
Adopt the standard longevity practices (explicit public exports, shipped types,
enforced boundaries, staged deprecation) so keeping faith with consumers over
years is cheap rather than heroic.

---

## Decision B — The delivery mechanism

How the API reaches consumers in code. Kept at the goals level here; the
concrete mechanism is its own discussion.

### Goals

**B1. A natural, low-coupling extension point.**
Consumers should reach the API without importing framework internals or coupling
to its release cycle — a clean seam that works for XBlocks today and for the
forum, courseware, and other plugins next.

**B2. The heavy weight is optional, via a library split.**
The definitions and the contract should live in a **light package that is always
safe to depend on**, separate from the package that carries the LLM router and
its unavoidable weight. An install that doesn't use AI should not pay for it.

The arguments for keeping that weight separable:

- LLM routers are a **costly dependency** — many megabytes of downloads and a
  large transitive tree.
- They **release often**; we want the freedom to follow that cadence
  independently, faster than the release rhythm of edx-platform's own
  dependencies.
- For anyone not using AI, carrying the router makes no sense at all.
- Keeping the router separable is also part of an ongoing effort to keep
  **dependency hell** out of the platform — an effort this decision stays in
  line with rather than solves outright.

**B3. Testable against the contract, without the engine.**
A consumer — and we — should be able to test code against what the API is
supposed to return, and to test versions for compatibility, **without installing
the router and the whole AI stack**. The light package must carry enough of the
contract (types, statuses, stubs) to test against on its own.

---

## Non-goals (for now)

- **Human-in-the-loop approval / grading review.** Deliberately out of scope;
  the result shape leaves room for it later.
- **Cost / budget enforcement.** We report usage; we do not police spend yet.
- **Multiple interchangeable engines.** One engine; no plugin-discovery for it.
- **Exposing the LLM / litellm layer.** Internal by intent — and central to
  Decision B's ability to keep the weight out of the light package.

## Trade-offs we are accepting

- **Operator authority can override developer intent** — accepted, because
  operator control is the goal, not a side effect.

---

# Forum reply draft — mapping this to the thread

> *This section is written to be published in the discussion thread
> ([Plugin-provided XBlock runtime services](https://discuss.openedx.org/t/plugin-provided-xblock-runtime-services/18682)),
> not as part of the ADR proper. It ties the ADR back to the points raised there
> and flags what's still open.*

Thanks all — the discussion pushed us to separate two things that were tangled
in our first draft: **what AI capability we expose** (an `api.py` surface) and
**how it's delivered** (an extension point plus a light/heavy library split).
The draft ADR is framed around exactly that split. Here's how it lines up with
what was raised, and where we still owe work.

### Points the ADR now takes a position on

- **Dependency weight** (LiteLLM ≈ 210 MB, 56 packages, ~189 releases in a
  year). We adopt the **two-library split** proposed here: a light package
  carrying models, Open edX adaptors and a stable `api.py` with *no* router
  dependency, and a separate package with the LLM router, processors and example
  profiles. Installs that don't use AI don't pay for it, and the AI package can
  follow the router's fast release cadence independently. (Decision B.)
- **Configuration authority — author vs. admin.** We take a clear stand: the
  **operator/administrator holds final authority** over model, prompt, and
  on/off, per scope; developers ship good defaults that operators can override.
  (Goal A3.)
- **Audit trails for LLM responses.** A durable record is a default, and the
  same path wires in xAPI, so analytics and Aspects light up without extra work.
  (Goal A8.)
- **Abstracting commercial LLMs / keys / streaming / prompt authoring.** All of
  this sits behind the profile + engine, never in the caller's hands; exposing
  the router/litellm layer is an explicit non-goal. (Goals A2/A7 + non-goals.)
- **Contract clarity** (Braden's point that XBlock services lack documented,
  enforced contracts). The contract *is* `api.py`: one supported import path,
  shipped types, enforced module boundaries, and staged deprecation. (Goals A1 +
  A9.) Note we are deliberately **not** trying to define a generic multi-vendor
  service interface — there is one engine, so the contract is "our `api.py`," not
  an ecosystem-wide spec.
- **HITL / safety loops.** Acknowledged and deliberately deferred; the result
  shape leaves room to add approval/review later. (Non-goals.)

### Points the ADR only partially addresses (we owe more)

- **"Installed" vs. "operationally available," and the many failure modes**
  (Dave's point: config-disabled, no-LLM-configured, unavailable-to-this-user,
  only-a-subset-enabled, transient outage). We give *typed* outcomes and a
  side-effect-free pre-check, but the draft currently collapses these distinct
  causes into a single `UNAVAILABLE`. **We should enumerate and surface them as a
  small taxonomy** so consumers can tell "turned off here" from "temporarily
  down" from "not for you."
- **Kill-switch shape — `None` vs. an unavailable object.** In our model there
  are two layers: when the plugin isn't installed, the runtime service is simply
  `None` (standard `@XBlock.wants` degradation); when it *is* installed but
  disabled or unconfigured, the call returns a **typed `UNAVAILABLE` result**.
  We should state that two-layer answer explicitly.
- **What exactly is the "stable API" contract** (versioning, backwards-compat
  window). A9 states the intent; the concrete version scheme and deprecation
  windows still need to be written down.

### Points still open — flagged to work on

- **Is the runtime-service delivery justified now, or deferred?** Braden's
  suggestion to wait for a second implementation before designing a pluggable
  service is fair. Our current position is that two *consumption paths* have
  independent value — a runtime **service** for optional features (zero
  dependency, degrade to `None`, e.g. ORA's AI grading) and a direct **import**
  of the light package for core features — but Decision B stays at the goals
  level and does not settle this. Worth deciding together.
- **Delivery details.** Per-call vs. memoized instantiation, and entry-point
  naming, are intentionally out of this goals-level ADR and belong in the
  delivery design.
- **Testability without the engine.** Being able to test against the API
  contract and check version compatibility *without* installing the router is a
  goal (B3); how the light package ships stubs/types to make that real is still
  to be designed.

We'd love feedback specifically on (a) the two-decision framing, (b) the
failure-mode taxonomy, and (c) whether the service-delivery path is worth
committing to now.
