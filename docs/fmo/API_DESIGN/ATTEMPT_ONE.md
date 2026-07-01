# `api.py` Design — Attempt One

> **Status:** illustrative sketch, not working code. The goal is to give us
> something concrete to *react* to — to see what we like and what we don't —
> before we commit to a shape. Code here is deliberately incomplete: docstrings
> are short, error handling is sketched, imports are loose. Read it for the
> *feel* of the surface, not for correctness.
>
> This attempt tries to answer every question in
> `API_DESIGN_CONSIDERATIONS` and apply the stability patterns from
> `API_DESIGN_CONSIDERATIONS_PARADIGMS_AND_LIFECYLE`. Where a decision is
> genuinely open, I picked one option and flagged it with **⟂ open** so we can
> revisit.

---

## 0. The shape in one breath

```python
from openedx_ai_extensions import api

response = api.run(
    "ora.grade",                       # profile name (chosen by scope + default) #::: if we where to override this what do we do? we create a profile by this name? probably we need a api.Scope(course_id=..., usage_id=..., profile_name="...")
    context=api.Context(course_id=..., usage_id=...), #::: I like the api.Whatever (this way we only import api)
    actor=api.Actor(user_id=...), #:::how much do we need the actor now?
    inputs={"question": q, "answer": a, "rubric": r},
)

if response.ok:
    use(response.payload)              # typed, never raw text without status  
```

One principal verb (`run`), a couple of pieces of syntactic sugar
(`evaluate`, `chat`), value objects that are flat and serializable, and a
return value that *always* carries a typed status. Everything below is the
expansion of this paragraph.

#::: what I mean by principal + syntactic is not so light.
#::: more like one evaluate_llm(profile, scope, user, input, sync=True, ...)
#::: and helpers like run_by_profile(), evaluate_async(), .... all of which call evaluate_llm with different configurations
#::: the specifics of what is the main method and what the other offer is still TBD

---

## 1. Two packages: the stable core and the optional engine

The considerations asked for "a stable library definition" plus "an optional
implementation library that contains the routing library (litellm) to keep it
out of the core." So the very first decision is the package split.

```
openedx-ai-extensions/                 # THE STABLE CORE — always importable
└── openedx_ai_extensions/
    ├── api.py                         # the ONE supported surface (OEP-0049)
    ├── _types.py                      # Context, Actor, AIResponse, enums
    ├── _profiles.py                   # profile registry + resolution
    ├── _router.py                     # Router PROTOCOL only (no litellm)
    ├── py.typed                       # PEP 561 marker — types are supported
    └── ...

openedx-ai-extensions-engine/          # OPTIONAL — pulls in litellm
└── openedx_ai_extensions_engine/
    └── litellm_router.py              # concrete Router, registered via entry point

#::: this I like. Maybe entry_point is not necessary, but a backend class eitherway. not having it means the api.py has a default implementation that only responds "not available" or similar.
```

The core **never imports litellm** (or `openai`, or `httpx`). It defines a
`Router` protocol and looks one up at call time. If no engine is installed,
the core still imports fine and every call returns a typed `UNAVAILABLE`
response instead of raising. This is the "api.py is total" property from the
considerations: *always importable, never throws on absence, always returns a
typed status.*

```python
# openedx_ai_extensions/_router.py  (in the CORE — no litellm here)

from typing import Protocol, runtime_checkable

@runtime_checkable
class Router(Protocol):
    """The contract an engine must satisfy. The core only ever sees this."""

    def complete(self, *, model: str, messages: list[dict], **params) -> "RawCompletion":
        ...

    def stream(self, *, model: str, messages: list[dict], **params):
        ...  # yields chunks


def _load_router() -> Router | None:
    """Resolve the installed engine via entry point, or None if absent.

    Mirrors how XBlocks are discovered (xblock.v1). Cached per process,
    including the cached miss, so 'no engine installed' is one dict lookup.
    """
    return _ENGINE_CACHE.get_or_load("openedx_ai_extensions.router.v1")
```
#::: performance considerations, we should only load the router once in the lifetime of the server. We are not swapping dinamically. Only allowing downstream developers to not need everything



```python
# openedx_ai_extensions_engine/litellm_router.py  (in the OPTIONAL package)

import litellm
from openedx_ai_extensions._router import Router, RawCompletion

class LiteLLMRouter:                    # structurally a Router; no inheritance needed
    def complete(self, *, model, messages, **params) -> RawCompletion:
        resp = litellm.completion(model=model, messages=messages, **params)
        return RawCompletion.from_litellm(resp)

    def stream(self, *, model, messages, **params):
        yield from litellm.completion(model=model, messages=messages, stream=True, **params)
```
#::: this works as an abstraction for the llm_procesor (which does the router bits), but has no relation to the current scope, orchestrator and processors. Take a look at /data/eduNEXT/ws-community/2025/aiext-azimut/aiext/src/openedx-ai-extensions/backend/openedx_ai_extensions/workflows/models.py


```toml
# the engine package's pyproject.toml registers itself
[project.entry-points."openedx_ai_extensions.router.v1"]
litellm = "openedx_ai_extensions_engine.litellm_router:LiteLLMRouter"
```
#::: having a steveadore entry-point sort of points towards having different implementations. We dont have that and that is not a explicit need right now. The separation we do need to keep the big heavy dependencies out.



> **Why a protocol and not a base class?** Same reasoning as ADR-0011's
> service contract: "the providing package does not need to import xblock at
> all." An operator can ship their own router (vLLM, Bedrock, a mock for
> tests) without importing our core. The considerations noted that needing a
> base class to write a custom orchestrator was a pain point — this removes it.

#::: this is a worry for orchestrators because we believe there might be hundreds of orchestrators/processors out there to support a myriad use cases. For the lib and the implementation of the router there will be one of each.


---

## 2. Value objects: `Context` and `Actor` (flat, serializable, non-XBlock)

Consideration #6: *many things want to use this framework (xblocks, forums,
plugins, courseware)*, so the inputs must not be XBlock-shaped. These are
plain frozen dataclasses — trivially serializable for Celery, caching, and
audit.

```python
# openedx_ai_extensions/_types.py

from dataclasses import dataclass, field

@dataclass(frozen=True, slots=True)
class Context: #::: this type of info we are keeping it in the AIWorkflowScope,  how can we join those two concepts. Even when that means refactoring the current scope model. I very much like the idea of the frozen data classes. The AIWorkflowScope is critical because at the moment it contains the only on/off lever in the system.
    """Where the AI work is happening. Flat, JSON-able, no ORM, no XBlock."""
    course_id: str | None = None
    usage_id: str | None = None          # block location, if any
    block_type: str | None = None
    org: str | None = None
    extras: dict = field(default_factory=dict)   # escape hatch for niche needs

    @classmethod
    def from_xblock(cls, block) -> "Context":
        """Convenience adapter so XBlocks don't hand-roll this every time."""
        return cls(
            course_id=str(block.scope_ids.usage_id.course_key),
            usage_id=str(block.scope_ids.usage_id),
            block_type=block.scope_ids.block_type,
        )


@dataclass(frozen=True, slots=True)
class Actor:
    """Who the work is for/by. Not a Django User — just the facts we need."""
    user_id: int | None = None
    username: str | None = None
    roles: frozenset[str] = frozenset()   # {"student"} / {"staff"} / ...
    language: str = "en"

    @classmethod
    def from_request(cls, request) -> "Actor":
        ...
```
#::: The reasons we have right now for having an actor are mostly about roles and permissions. this could evolve but lets keep it real for now.
#::: We don't pass the actor to the LLM in any form
#::: Other than that, the other thing we do is we send XAPI messages. This is tracking messages to the backend to make sure that we record that someone used an AI workflow.


> **⟂ open:** `extras: dict` is an escape hatch and escape hatches rot. The
> alternative is to forbid it and force every new field through a version bump.
> I leaned permissive for attempt one; we may want to tighten this.

#::: What I would do here is mark the hatch as completely experimental. Make it so that it has an underscore as a way to show that it's bright bad or call it experimental or call it like smell or shame. Take a clue from the shame.css movement.


---

## 3. The return value: always a typed `AIResponse`

Consideration #5: *never return raw LLM text without status and metadata.*
Every verb returns the same envelope. Streaming is the one exception and gets
its own return type (section 7).

```python
# openedx_ai_extensions/_types.py

from enum import Enum

class Status(str, Enum):
    OK = "ok"
    UNAVAILABLE = "unavailable"   # feature off, no engine, no key, scope says no
    PENDING = "pending"           # async / awaiting human approval
    ERROR = "error"               # provider failed, bad input, timeout
#::: This I kind of like and I know I know I had it in my notes But these specific error or status messages don't necessarily need to be the final ones. We know we have operation issues (key, quota, service down, ... so many), we know we have to turn things on and off (temporal or definitive), we know sometimes there will be no engine, so this is a separate problem but probably the same result.

@dataclass(frozen=True, slots=True)
class AIResponse:
    status: Status
    payload: object = None        # str for completions; Evaluation for grading #::: We still don't know what we will have in terms of payloads. It makes sense to have a completions but also a streaming response. This should also be part of the response. I don't see why we should have anything else. But perhaps this class could also handle storage locally. So even if it's a stream response, when the response finishes streaming, we store it in our database. For that we're using edX submissions. But ideally it would be a sort of hook that we can call from the implementation.
    metadata: "Meta" = None       # model, tokens, cost, latency, cache hit
    session_id: str | None = None  #::: This is something that has turned to be very important. Right now we are storing sessions in a JSON that just grows big and we have one of those per scope (or per something else managed by the orchestrator) I would like to give more support to the downstream users, so have proper getter create session or methods to store or load information from a session and have that be transparent for them if they don't want to deal with that.
    reason: str | None = None  #::: It looks to me to be too specific, I would not have it in an AI response yet, unless it was like a global message or something like that. we could have it as Exception do and let them have a message that is changed by the code that is defining the response (ostensibly error response).

    # --- ergonomic sugar so consumers don't compare enums everywhere ---
    @property
    def ok(self) -> bool:
        return self.status is Status.OK

    @property
    def text(self) -> str:
        """The common case: 'just give me the string'. Empty if not OK."""
        return self.payload if isinstance(self.payload, str) else ""


@dataclass(frozen=True, slots=True)
class Meta:
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float | None = None
    latency_ms: int | None = None
    cached: bool = False
    profile: str | None = None
```
#::: This metamodel is worth looking into more detail later. For now everything we have is what light LM returns, but should that ever change, I would like to have like some consistency in the things that we are exposing. It could evolve with time, we dont need to have it right now.



The point of `.ok` and `.text` is that the 90% caller writes
`if r.ok: use(r.text)` and the 10% caller who cares reaches into `.metadata`
and `.payload`. We never make the easy case hard, and we never let the easy
case skip the status check by accident (raw text is only reachable through a
property that already gated on type).

#::: its a nice dev helper. I like it

---

## 4. Profiles: code-defined, operator-overridable, scope-resolved

Considerations #3 and #8: the **developer writes** profiles in code, but the
**operator holds final authority** and can override in the DB. Resolution is
*by scope* with an explicit default.

A profile is the unit that bundles "which model, which prompt template, which
parameters, which guardrails" under a name. The consumer names the profile;
it does not name a model. That directly fixes the "hardcoded models age out"
pain point — the model lives in one overridable place.

```python
# A plugin (e.g. openedx-ai-badges) declares its profiles in code:

from openedx_ai_extensions import api

api.register_profile(
    api.Profile(
        name="badges.generate_image",
        model="anthropic/claude-opus-4-8",     # a DEFAULT, overridable by operator
        system="You design achievement badge artwork. ...",
        params={"temperature": 0.7, "max_tokens": 1024},
        kind="completion",                      # completion | evaluation | chat
    )
)
```
#::: To land this you definitely need to look at backend/openedx_ai_extensions/workflows/models.py.| orchestrator already have a lot of thought put into them. You can define them and also use the provided ones with a lot of flexibility. 
#::: What I'm thinking is we should have something that ammounts to run_ad_hoc_profile And this method will check the backend, probably the database for an existing override to this profile, and if there is one, it will take it, otherwise it will take what's defined in the code. However, for that to work we definitely need to include some loop with the scope because different scopes could have different versions of the same profile.



Resolution order when `api.run("badges.generate_image", ...)` is called:

```python
# openedx_ai_extensions/_profiles.py  (sketch of the resolution logic)

def resolve_profile(name: str, context: Context) -> ResolvedProfile:
    base = _CODE_REGISTRY[name]                 # 1. developer's code default

    # 2. operator override, scoped most-specific-wins:
    #    site  >  org  >  course  >  global   (DB-backed)
    override = ProfileOverride.objects.best_match(name=name, context=context)

    # 3. operator's kill switch is consulted here too (section 5)
    return base.merged_with(override)
```
#::: As with the previous one, we already have a lot of code written about how we can resolve a scope into a profile. So go check that first before we even waste more time on this.



> **Authority model:** the developer's `register_profile` is a *default*, never
> the last word. Any field — model, prompt, params, or "is this allowed at
> all" — can be overridden by an operator row scoped to site/org/course. The
> developer cannot opt out of operator control. This is the "el operador tiene
> que tener esto" line from the considerations, made structural.

> **⟂ open:** the override granularity (site > org > course > global) is a
> guess. ORA grading might want per-block overrides too (usage_id scope).

#::: Again go check the actual code, read what profile presolution does right now and what the scopes do.

---

## 5. Availability: "yes / never / not now" — and never an exception

Consideration #4: the only questions that matter are *is it usable now?* with
answers **yes / never / not now**. "Is it installed?" is explicitly *not* a
question the caller should have to ask — absence just resolves to `UNAVAILABLE`.

```python
class Availability(str, Enum):
    READY = "ready"        # call it, it'll work
    NEVER = "never"        # disabled by operator, or no profile — don't bother
    NOT_NOW = "not_now"    # rate-limited, engine down, key missing — try later


def availability(name: str, *, context: Context, actor: Actor) -> "AvailabilityResult":
    """Cheap, side-effect-free probe. Lets a UI hide a button without a call."""
    ...
```
#::: I don't see the need to have this being separate from status, we could merge some of this availability status into the current status enum that we have from above.


This lets a frontend decide whether to even render the "Generate" button,
*without* making an LLM call, and without try/except. And because `run` itself
returns `UNAVAILABLE` rather than raising, a consumer that doesn't care to
pre-check just calls `run` and branches on status. Both styles work; neither
throws.

#::: The way frontend currently does this is it has two calls in order to run an AI workflow. First call just checks if there is a workflow defined for this profile, and the second one executes the profile.
#::: This is useful because we check if the profile is available with an invisible component, and depending on that response, we actually render or not the button that says call AI for this task.
#::: Ideally, Xblocks or other colors for or whatever can do the same even if it all happens in the backend for one server render.


```python
# UI style: ask first
if api.availability("badges.generate_image", context=ctx, actor=who).ready:
    show_generate_button()

# Lazy style: just run, handle the status
r = api.run("badges.generate_image", context=ctx, actor=who, inputs=...)
if r.status is Status.UNAVAILABLE:
    show_disabled_state(r.reason)   # "AI image generation is turned off here"
```

#::: I think the ask first makes a lot more sense because after the consumer asks we will be able to render two different things.


The operator kill-switch from the pain-points list lives here: a global
off-switch (no engine / feature flag) yields `NEVER`/`NOT_NOW` for everything;
a scoped override (section 4) marked `enabled=False` yields `NEVER` for one
profile in one course. *No deleting the component to turn it off.*

#::: This is what we have right now, but I think the extension framework will grow into having one big kill switch as well.

---

## 6. The verbs

### 6.1 `run` — the principal verb

Everything is expressible as `run`. The sugar verbs below are thin wrappers.

```python
def run(
    profile: str,
    *,
    context: Context,
    actor: Actor,
    inputs: dict | None = None,      # template variables for the profile's prompt
    session: "str | Session | None" = None,
    overrides: dict | None = None,   # caller nudges (rarely needed); operator still wins
) -> AIResponse:
    prof = resolve_profile(profile, context)         # §4
    avail = _check_availability(prof, context, actor) # §5
    if not avail.ready:
        return AIResponse(status=Status.UNAVAILABLE, reason=avail.reason)

    router = _load_router()                           # §1
    if router is None:
        return AIResponse(status=Status.UNAVAILABLE, reason="No AI engine installed")

    messages = prof.render(inputs or {}, session=session)
    try:
        raw = router.complete(model=prof.model, messages=messages, **prof.params)
    except Exception as exc:                          # never leak provider errors
        return AIResponse(status=Status.ERROR, reason=str(exc))

    return AIResponse(
        status=Status.OK,
        payload=raw.text,
        metadata=Meta(model=raw.model, tokens_out=raw.tokens_out, profile=profile),
        session_id=getattr(session, "id", None),
    )
```

#::: In order to properly evaluate this, we need to ground it in the current models. But the idea of returning an AI response that is a structure data class or even having data classes for some of the things that are being passed around, I think is a very solid one, and we could refactor and improve the current framework with this idea.


### 6.2 `evaluate` — sugar for structured, high-risk, idempotent grading

#::: There is no reason that Aura should have a different way of evaluating. We don't have any methods for grading now, so right now ORA or any xblock evaluating just does a regular run. That is for the best. In the future we will probably have an orchestrator that is special for grading and that should also be it.

ORA and the evaluation XBlocks don't want a string; they want a score per
criterion, and they must **not grade twice on retry**. `evaluate` is `run`
with a structured payload and idempotency baked in.

#::: While this is true, we already have ways of dealing with this with orchestrators because we can pass an esquema and have the orchestrator parse and respond programmatically to the answers that are provided in that schema.

```python
def evaluate(
    profile: str,
    *,
    context: Context,
    actor: Actor,
    inputs: dict,
    idempotency_key: str | None = None,   # default: hash(context.usage_id, actor, inputs)
    force: bool = False,                  # re-grade even if a result exists
) -> AIResponse:
    """Returns AIResponse whose .payload is an Evaluation (score per criterion)."""
    key = idempotency_key or _derive_key(context, actor, inputs)

    if not force:
        prior = GradingRecord.objects.filter(key=key).first()
        if prior:
            return prior.as_response()    # idempotent: same result, no second call

    r = run(profile, context=context, actor=actor, inputs=inputs)
    if r.ok:
        r = _coerce_to_evaluation(r)      # parse the structured payload
        GradingRecord.objects.create(key=key, response=r)  # local record of work
    return r
```

```python
@dataclass(frozen=True, slots=True)
class Evaluation:
    overall: float | None
    criteria: dict[str, float]            # {"correctness": 0.8, "clarity": 1.0}
    feedback: str = ""
    rubric_choice: str | None = None      # ORA's "RUBRIC_OPTION_IS: 3"
```
#::: no need for this dataclass. Also, remember that we're working within the scopes and the limitations of the OpenEdX ecosystem. We already have evaluations, grading, submissions, and a bunch of other objects that we are not going to duplicate here.



> This answers two pain points at once: *"no record of the student's work"*
> (we persist a `GradingRecord`) and *"if ORA retries, don't grade twice"*
> (idempotency key + `force`). HITL is acknowledged but deferred — see §8.

### 6.3 `chat` — sugar for stateful, multi-turn

#::: This one is cool though. However, before we do anything more on the syntactic sugar, we would want to have the original method well scoped and well planned before we create helpers for it.


```python
def chat(
    profile: str,
    message: str,
    *,
    session: "str | Session",
    context: Context,
    actor: Actor,
    stream: bool = False,
) -> "AIResponse | StreamingResponse":
    """Stateful. Appends to the session, returns the assistant turn."""
    ...
```

> **Do `evaluate`/`chat` earn their keep, or is `run(kind=...)` enough?** This
> is the central question from consideration #1 — which differences are *real*
> vs *incidental*. My attempt-one bet: the **idempotency + persistence** of
> `evaluate` and the **session + streaming** of `chat` are real enough to
> justify named sugar, but they are *only sugar* — each is `run` plus one
> concern. If we decide those concerns belong to the caller, both collapse
> into `run` and this section disappears.

---

## 7. Sessions and streaming

Sessions are the "create/read/store info in a session" capability. A session
is a serializable handle, not an ORM object handed to the caller.

```python
def get_or_create_session(
    *, scope: str, context: Context, actor: Actor
) -> Session:
    """scope='course' gives the course-wide session badges uses; 'block' a per-block one."""
    ...

@dataclass(frozen=True, slots=True)
class Session:
    id: str
    messages: list[dict]            # prior turns, already trimmed to budget
```

Streaming gets its own return type because it cannot carry a final status up
front — the status resolves as the stream ends.

```python
@dataclass
class StreamingResponse:
    chunks: "Iterator[str]"
    def result(self) -> AIResponse:
        """Call after draining chunks to get the final typed envelope (tokens, cost)."""
        ...
```

> **⟂ open:** streaming is the messiest corner. Attempt one keeps it out of the
> uniform envelope and gives it a `.result()` you call at the end. If most
> consumers never stream (today: none do), we could even leave streaming out
> of attempt one entirely and add it later under the deprecation policy.


#::: This is only worth evaluating after you have read the session model and the session based orchestrator.
#::: /data/eduNEXT/ws-community/2025/aiext-azimut/aiext/src/openedx-ai-extensions/backend/openedx_ai_extensions/workflows/orchestrators/session_based_orchestrator.py

---

## 8. What attempt one deliberately leaves out

The considerations flag these as "responsibility of a future API" — I'm
honoring that, but naming them so we don't pretend they're solved:

- **Human-in-the-loop approval.** `evaluate` can return `Status.PENDING` and
  persist a `GradingRecord` in a "needs approval" state, but the *approve/
  reject/recover* surface is not in attempt one. The envelope is shaped to
  allow it later (`PENDING` + `session_id` to retrieve) without a breaking
  change.
- **Cost/budget enforcement.** `Meta.cost_usd` is reported; enforcing a budget
  ceiling is future work.


#:::  I like really leaving both human in the loop and cost budgets out of the current attempt.


---

## 9. How the surface stays stable (applying the lifecycle research)

From `..._PARADIGMS_AND_LIFECYLE`, the concrete commitments for attempt one:

```python
# openedx_ai_extensions/api.py  — the ONLY supported import path (OEP-0049)

from ._types import Context, Actor, AIResponse, Status, Meta, Evaluation, Session
from ._profiles import Profile, register_profile
from ._verbs import run, evaluate, chat, availability, get_or_create_session

__all__ = [                              # explicit public surface; wildcard-safe
    "Context", "Actor", "AIResponse", "Status", "Meta", "Evaluation", "Session",
    "Profile", "register_profile",
    "run", "evaluate", "chat", "availability", "get_or_create_session",
]
```

- **`api.py` is the single supported surface.** Everything else is `_private`.
  `Service` and the XBlock entry point (ADR-0011) are *thin adapters* over
  these same functions — the considerations' "Service and import are thin
  adapters over the same api.py."
- **`py.typed` ships**, types are part of the contract (PEP 561).
- **import-linter** forbids any consumer importing from `_*` modules.
- **Deprecation is dual-modality** (PEP 702): when a signature must change we
  keep the old name with `@warnings.deprecated("use X")` for a full release,
  plus a version-targeted warning subclass so operators can filter:

#:::  These are all best practices that I 100% agree we should do.


```python
import warnings

class RemovedInAIExt2Warning(DeprecationWarning):
    """Filterable: operators can silence only our v2 removals."""

@warnings.deprecated("Use run(profile, ...) instead", category=RemovedInAIExt2Warning)
def run_completion(*args, **kwargs):     # old name kept alive one full cycle
    return run(*args, **kwargs)
```

- **Experimental flag.** Streaming (§7) and HITL hooks (§8) ship marked
  *Provisional* — exempt from compat guarantees until promoted.

---

## 10. Before & after: the four real consumers

The test of the surface is whether the existing consumers get *shorter* and
*safer*. Sketches:

### ORA grading — before (today)

```python
openai.api_key = get_openai_key()
completion = openai.ChatCompletion.create(
    model="gpt-3.5-turbo",            # hardcoded, ages out
    messages=[...],                   # hand-built every time
    max_tokens=1000, temperature=0.7,
)
return completion.choices[0].message["content"]   # raw text, no status, grades on every retry
```

### ORA grading — after

```python
r = api.evaluate(
    "ora.grade",                                  # model lives in the profile
    context=api.Context.from_xblock(self),
    actor=api.Actor(user_id=self.runtime.user_id),
    inputs={"question": q, "answer": answer, "rubric": rubric},
    # idempotency_key defaults to (usage_id, actor, answer) — no double-grading
)
if r.ok:
    return r.payload.rubric_choice                # structured, persisted, status-checked
```

### ai-coach evaluate — after

```python
r = api.run(
    "coach.feedback",
    context=api.Context.from_xblock(self),
    actor=api.Actor(user_id=self.runtime.user_id),
    inputs={"question": self.question, "answer": student_answer},
)
return r.text if r.ok else _("Feedback is unavailable right now.")
```

### badges image generation — after (via Celery, note the serializable args)

```python
# Context/Actor/Session are flat dataclasses, so they pickle cleanly for .delay()
@shared_task
def generate_badge_image(context_dict, actor_dict, session_id):
    r = api.run(
        "badges.generate_image",
        context=api.Context(**context_dict),
        actor=api.Actor(**actor_dict),
        session=session_id,
    )
    ...
```

### xblock-ai-evaluation — after

```python
r = api.evaluate(
    "code.evaluate",
    context=api.Context.from_xblock(self),
    actor=api.Actor(user_id=self.runtime.user_id),
    inputs={"prompt": self.evaluation_prompt, "question": self.question,
            "answer": answer, "language": self.language},
)
return r.payload.feedback if r.ok else _("Evaluation unavailable.")
```

Every "after" is shorter, names a profile instead of a model, can't grade
twice, and can't leak a provider exception or raw unstatused text.


#::: These examples are nice for understanding the feel. We will do them again once we redefine the methods in attempt 2.

---

## 11. Open questions carried forward (for the next attempt)

1. **Do `evaluate` and `chat` survive, or collapse into `run`?** (§6.3) The
   real-vs-incidental question. #::: Run will be the main method, and if we ever do evaluate and chat as helpers to select a particular profile, then this is a second loop of development, not necessarily to do right now.
2. **`Context.extras` — keep the escape hatch or forbid it?** (§2)  #::: We keep something like it, but we clearly mark it as experimental or unstable.
3. **Override scope granularity** — is `usage_id`-level operator override
   needed for ORA? (§4) #::: I don't see it for the moment, but as it will be part of the base method evaluation, be that run or whatever name we choose, then it will be around.
4. **Streaming in v1 at all?** No consumer streams today. (§7) #::: We do have streaming right now and we want to keep having it.
5. **Is `availability()` worth a separate public verb,** or should callers
   always just `run` and branch on `UNAVAILABLE`? (§5)   #::: separate, but keep in mind my inline notes
6. **Where does the prompt-template engine live** — in `Profile.render`, or is
   that a second pluggable protocol like `Router`? (implied by §4/§6.1) #::: This goes too deep in the weeds and the major refactor that's coming up will completely change the shape of this question, so I'm not going to answer it now.
