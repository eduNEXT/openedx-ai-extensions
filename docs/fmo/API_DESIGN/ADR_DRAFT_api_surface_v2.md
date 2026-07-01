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
it. #::: This already is the main goal of what the OpenEDX-AI-extensions project is built for. However, that project in its first steps what it did was create new surfaces and integrations that were new to the workings of the platform. Now let's call this a second or third phase. What we're doing is trying to connect the capabilities provided by the extensions framework, into existing platform code (forum, xblocks, plugins, ...).

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
is a goal, not an accident. #::: A side effect of this is that we might need to rework the internals of the existing REST API to better match what the API is exposing. But that is normal evolution. It should be a consequence that we can put in an ATR and live fight with it.

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

#::: One goal that I think we're missing here is the ability to test code without having to install like the whole router and AI experience, but being able to know what the API should return and being able to test the different versions for compatibility changes and whatnot, that is still important.

#::: And yet another one that we are sort of touching on B one would be the trying to maintain the dependency hell out of this. That's an ongoing effort and there's always a lot of things to work this out, but we are trying to keep in line with it.

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
