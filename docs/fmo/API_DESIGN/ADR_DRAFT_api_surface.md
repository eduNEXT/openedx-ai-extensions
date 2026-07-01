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


#::: I think this lacks an explanation of why we are trying to expose things and sort of splitting the decision into two. One about the API that we're exposing and the primary purposes of it and what we're trying to achieve with it. And the second one about the delivery mechanism for this API. The delivery mechanism ties into the previous discussion we have had about the API being passed as an extension point for Xbox and even the library being split into two, one that doesn't carry all the weight and and contains just the definitions and another one that has the router with the undesired but obligatory weight. Take a look again at the discussion in https://discuss.openedx.org/t/plugin-provided-xblock-runtime-services/18682/9

## What the API exposes (at a glance)

- A single **principal call** to run an AI profile and get a typed result.
- A typed **result envelope** carrying status + payload + metadata (+ session).
- A small set of **value objects** for "where/for whom" a call happens.
- A **profile** concept: good defaults in code, operator override in the DB.
- A **pre-check** to ask "is this usable here?" without running anything.
- **Session** access that hides the storage details. #::: The goal is not to hide the details of storage, the goal is to simplify access and make it streamlined. If the details can be also exposed, this is fine, but the idea is that developers downstream don't need to fiddle with the details.
- The **orchestrator/processor base classes** as the sanctioned extension point.

Everything else — the LLM engine, litellm, the persistence backend, the
resolution internals — is deliberately *not* exposed. #::: Part of the reason for this is that we want to retain the option of splitting the library in two and not installing the LM engine with the router and all the wait every time.

## Goals

**1. One stable, supported surface.**
Consumers should depend on `api.py` and nothing else. Internals must be free to
change without a coordinated migration for every plugin that uses AI.

**2. Totality — the surface never punishes absence.** #::: I don't really care about this. Importing the API should work and if error ocurr they should not be catastrophic. That means it's perfectly fine. We erase errors of not configured or not installed as long as they are predictable and that we are exposing or we are telling the developers downstream to take a look at this in their APIs and plan for those responses.

Importing the API must always work, and a call must always return a typed
outcome — never raise because an engine, key, or configuration is missing. 
"Not available" is a normal, typed answer, not an exception the caller handles.

**3. Predictable, typed outcomes.**  #::: I think that one of the key discussions here should be that we make it easy for developers to pass a schema that we then make sure that the LLM answers in. For streaming responses it might be a little bit different, but still we should make it easy for the developers to know what they should expect in their response.
Callers should never receive raw, unstatused LLM text or have to shape-sniff a
dict. Every result states what happened; the easy path ("just give me the
text") stays easy without letting a caller skip the status by accident.

**4. Operator authority is structural.**  #::: Not only is this true, but we can also lean on the fact that the three or four available interfaces for extending OpenEDX with Xbox already are using obsolete models and have mostly limited to none capabilites of modifying the promtp. Obviously they don't have any capabilities beyond the prompt itself, which is what the framework offers in terms of orchestrators and processors and more advanced ways of extening AI connection.
The operator running the platform — not the developer writing the consumer —
holds final say over which model/provider and prompt run, and whether AI runs at
all in a given scope. Developers supply good defaults; operators override them.

**5. Reach beyond XBlocks.**   #::: this is good
Many kinds of consumers want this (XBlocks, other plugins, courseware, future
surfaces). The inputs a caller passes must be plain, serializable, and free of
any XBlock or ORM shape, so the same API works from a request, a task, or a
block.

**6. Evolve the existing framework, don't rewrite it.**   #::: this is good
The surface should sit *on top of* the machinery that already exists
(profiles, scope resolution, orchestrators, sessions), adding the minimum
net-new. Grounding in what's there is a goal, not an accident.

**7. Keep heavy dependencies optional and internal.**   #::: I think we need to put our arguments forward for this, and the main one is that LLM routers are costly are costly dependency, it adds a lot of megabytes of downloads and also have many frequent releases. We would like to keep those releases in a cadence that can be faster than the dependencies of the OpenEDX project itself. Also, for someone that's not using AI capabilities, the heavy dependency makes no sense.
The LLM engine (and its heavy libraries) must stay out of the always-importable
core and be swappable behind one internal seam — there is one engine, and it is
an implementation detail, never part of the contract.

**8. Extensibility lives in orchestrators, not the engine.**   #::: This is true, but it's also a marketing pitch of some sort. There might not be that many orchestrators processors coming up, and it could be that a lot of the things that developers want to accomplish can be done via prompt. Still I think it's worth saying that we want them to write orchestrators and we want them to write specific processors and we want to make that possible and easy.
We expect *many* orchestrators/processors for a myriad of use cases; that is the
sanctioned place to add behavior, via subclassing. The API should make that the
obvious extension path while keeping the engine singular and closed.

**9. Developer ergonomics: define-and-call.**   #::: this is good 
A developer should be able to declare a profile in code and run it immediately,
with operator overrides applied transparently if they exist — no ceremony, no
model authoring required for the common case.

**10. A durable record of AI work, for free.**  #::: This is true and we can also add XAPI, that means analytics, and the aspects platform hooked in by default.
Consumers should get their AI interactions persisted without writing storage
code, and without the response type being entangled with how storage happens.

**11. Long-term supportability by design.**  #:::  this is good 
The surface should adopt the standard longevity practices (explicit public
exports, shipped types, enforced boundaries, staged deprecation) so that keeping
faith with consumers over years is cheap rather than heroic.

## Non-goals (for this surface, now)   #:::  this is good 

- **Human-in-the-loop approval / grading review.** Acknowledged, deliberately
  out of scope; the result shape leaves room for it later.
- **Cost/budget enforcement.** We report usage; we do not police spend yet.
- **A separate "grading" or "chat" verb.** These are use-cases served by
  orchestrators, not first-class API verbs. #::: We might get into this later and no one has talked about a separate grading or chat birds, so you can safely delete this slide.
- **Multiple interchangeable engines.** One engine; no plugin-discovery for it.
- **Exposing the LLM/litellm layer.** Internal, by intent.

## Key trade-offs we are accepting 

- **A thin façade adds an indirection layer** over machinery consumers could
  call directly — accepted, because the stability and totality guarantees are
  worth it. #::: This I don't understand it.
- **Operator authority can override developer intent** — accepted, because
  operator control is the goal, not a side effect. #:::  this is good 
- **One profile model change** (a code-origin default) is required to reach the
  define-and-call ergonomic — accepted as the single structural cost. #:::  this is good and not a big deal leave it out.
