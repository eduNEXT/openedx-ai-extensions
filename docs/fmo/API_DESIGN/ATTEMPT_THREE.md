# `api.py` Design — Attempt Two

> **Status:** illustrative sketch, not working code. Every name here is a
> **real class or method** in `backend/openedx_ai_extensions/`; bodies are
> sketched, signatures are not invented. Read it for the *feel* of the surface.
>
> The surface is designed *on top of* what already exists: `AIWorkflowProfile`,
> `AIWorkflowScope`, `AIWorkflowSession`, `BaseOrchestrator` and its subclasses,
> the `LLMProcessor`/`LitellmProcessor` stack, `settings.AI_EXTENSIONS`,
> `PromptTemplate`, and the `AIExtensionsService` XBlock bridge.

---

## 0. The map: surface concept ⟷ what already exists

Read this first.

| Surface concept | Backing code (today) |
|---|---|
| `api.ScopeSelectors` | resolution inputs to `AIWorkflowScope.get_profile(course_id, location_id, ui_slot_selector_id)` |
| `api.Actor` | `request.user` — used only for permissions + xAPI (`_emit_workflow_event`), never sent to the LLM |
| the profile you name | `AIWorkflowProfile` = disk JSON5 template (`base_filepath`) + DB `content_patch`; `.config` → `orchestrator_class` + `processor_config` + `actuator_config` |
| "run it" | `AIWorkflowScope.execute(user_input, action, user, running_context)` → `BaseOrchestrator.get_orchestrator(...)` → `getattr(orch, action)(user_input)` |
| the engine | `LLMProcessor` / `LitellmProcessor` (completion + responses API + streaming + tools); creds from `settings.AI_EXTENSIONS` |
| `AIResponse` | **does not exist yet** — ad-hoc dicts + raw generators. This is the one net-new type. |
| availability pre-check | `AIWorkflowProfileView.get` → UIComponents config or `{"status": "no_config"}` (the frontend's first of two calls) |
| session | `AIWorkflowSession` (+ growing `metadata` JSON, `local_submission_id`, `remote_response_id`) |

The takeaway: **almost everything already exists.** `api.py` is mostly a
*thin, typed, stable façade* over machinery that's already here. The only new
runtime object worth adding is `AIResponse`.

---

## 1. Package split — the engine is a *backend class*, not an entry point

Keep the heavy dependency (litellm, and the whole `LLMProcessor` stack) out of
the always-importable core. There is exactly **one** LLM engine, so this needs
no plugin-discovery machinery — just the backend-class Django setting the repo
already uses for swappable backends (`edxapp_wrapper/`, `STUDENT_MODULE_BACKEND`).

```python
# openedx_ai_extensions/_engine.py  (CORE — no litellm import at module load)

from functools import lru_cache
from django.conf import settings
from django.utils.module_loading import import_string

@lru_cache(maxsize=1)                     # loaded ONCE per process, never swapped
def get_engine():
    """
    Resolve the LLM engine backend named in settings.

    Mirrors how the repo already resolves swappable backends
    (see edxapp_wrapper/student_module.py). Returns None if unset, so the
    core stays importable and every call degrades to a typed 'unavailable'.
    """
    path = getattr(settings, "AI_EXTENSIONS_ENGINE_BACKEND", None)
    if not path:
        return None
    return import_string(path)()          # e.g. the LLMProcessor-backed engine
```

```python
# settings/common.py
AI_EXTENSIONS_ENGINE_BACKEND = (
    "openedx_ai_extensions.processors.llm.engine.LiteLLMEngine"
)
```

The engine wraps the *existing* `LLMProcessor`; it is not a new parallel router.
`LLMProcessor(config, user_session, extra_params)` stays the implementation —
the engine is only the seam that lets the core name it without importing it, and
the reason litellm never gets imported on installs that don't use AI.

---

## 2. `api.ScopeSelectors` — a thin wrapper over the resolution inputs

`AIWorkflowScope` keeps its model. `ScopeSelectors` is a frozen value object
carrying exactly the three things `AIWorkflowScope.get_profile()` already takes,
plus `service_variant` (which `list_profiles_for_context` already reads).

```python
# openedx_ai_extensions/_types.py

from dataclasses import dataclass, field

@dataclass(frozen=True, slots=True)
class ScopeSelectors:
    """
    The transient resolution key. Wraps the inputs to
    AIWorkflowScope.get_profile(); it does NOT replace the scope row.

    Resolving it yields the applicable profile configuration (and the concrete
    AIWorkflowScope, which carries the `enabled` on/off lever).
    """
    course_id: str | None = None
    location_id: str | None = None          # opaque UsageKey string
    ui_slot_selector_id: str | None = None
    service_variant: str | None = None      # "lms" | "cms"

    # smell — deliberately ugly. See §2.1.
    _experimental_extras: dict = field(default_factory=dict)

    @classmethod
    def from_xblock(cls, block, *, ui_slot_selector_id=None) -> "ScopeSelectors":
        """Adapter so XBlocks / the ai_extensions service don't hand-roll this."""
        scope_ids = block.scope_ids
        return cls(
            course_id=str(scope_ids.usage_id.context_key),
            location_id=str(scope_ids.usage_id),
            ui_slot_selector_id=ui_slot_selector_id,
        )

    @classmethod
    def from_request(cls, request) -> "ScopeSelectors":
        """Mirror of api/v1/workflows/permissions.get_context_from_request()."""
        ...

    def resolve_profile(self) -> "AIWorkflowScope | None":
        """
        The existing resolver, unchanged. Returns the best-matching enabled
        scope (which carries `.profile` and the `enabled` lever), or None when
        nothing is configured/enabled here.
        """
        from openedx_ai_extensions.workflows.models import AIWorkflowScope
        return AIWorkflowScope.get_profile(
            course_id=self.course_id,
            location_id=self.location_id,
            ui_slot_selector_id=self.ui_slot_selector_id,
        )
```

The frozen-dataclass ergonomics apply to the *key*; the resolved
`AIWorkflowScope` remains the authority and the only on/off lever (`enabled`).

> **Naming is not final.** `Context` was too loaded; `ScopeSelectors` is the
> working name (a one-word `Selectors` is the alternative). See §13.

### 2.1 The extras escape hatch, marked as shame

`_experimental_extras` carries a leading underscore *and* the word experimental.
It is not part of the supported surface (§11), it is excluded from the stability
guarantee, and a static-analysis rule can flag any consumer that touches it. It
exists, but you have to be ashamed to use it. It is the pressure valve that
keeps new fields from leaking into the stable surface before they've earned it.

---

## 3. `api.Actor` — small, and cheap to construct

The only real reasons for an Actor today are **permissions** and **xAPI
tracking**. The actor is never sent to the LLM, so it carries the minimum.

Crucially, it does **not** precompute roles: role/permission resolution can be
an expensive, context-dependent query, and most calls never need it. Instead the
actor carries identifiers the platform already has cheaply — the numeric
`user_id` and the platform anonymized/actor UUID (the same one Aspects/xAPI use)
— and leaves role computation to whoever actually needs it.

```python
@dataclass(frozen=True, slots=True)
class Actor:
    """Who the call is for. Feeds permission checks and xAPI events only."""
    user_id: int | None = None
    anonymized_id: str | None = None     # easy to get in the xblock context
    # roles are intentionally NOT precomputed — a consumer that needs them
    # derives them lazily from user_id in its own context.
```

The principal method still takes the Django `user` object where permission
backends need it (`permission_is_course_staff(user, course_id)`); `Actor` is the
serializable shadow used for Celery hand-off and `_emit_workflow_event`.

---

## 4. `AIResponse` — the one net-new type (the beachhead)

The highest-value, lowest-disruption change. Today orchestrators return
`{"response": …, "status": "completed"}`, `{"error": …, "status": "…"}`, or a
raw generator, and the view branches on `is_generator(result)` and
`"error" in result`. `AIResponse` wraps all of that in one typed envelope
**without changing the orchestrators' internals** — the façade adapts their
dicts.

```python
class Status(str, Enum):
    OK = "ok"
    UNAVAILABLE = "unavailable"   # not enabled, no engine, no profile/scope
    PENDING = "pending"           # async task in flight (maps to "processing")
    ERROR = "error"               # provider/tool/timeout

@dataclass(frozen=True, slots=True)
class AIResponse:
    status: Status
    payload: object = None        # str | dict | StreamingBody (see §10)
    metadata: "Meta | None" = None
    session_id: str | None = None
    _message: str | None = None   # like Exception.args[0]: set by the failing code

    @property
    def ok(self) -> bool:
        return self.status is Status.OK

    @property
    def text(self) -> str:
        if isinstance(self.payload, str):
            return self.payload
        if isinstance(self.payload, dict):
            return self.payload.get("response", "")
        return ""

    @classmethod
    def from_orchestrator_result(cls, result, *, session_id=None) -> "AIResponse":
        """
        Adapter over the current ad-hoc dicts. This is what makes AIResponse
        additive: DirectLLMResponse.run() etc. can stay exactly as they are.
        """
        if isinstance(result, dict) and "error" in result:
            return cls(Status.ERROR, _message=result.get("status"))
        status = (result or {}).get("status")
        if status == "processing":
            return cls(Status.PENDING, payload=result, session_id=session_id)
        return cls(Status.OK, payload=result, session_id=session_id)
```

The status set is intentionally minimal. Operational problems (bad key, quota,
service down), on/off states (temporary vs definitive), and "no engine
installed" are distinct causes that collapse to the same `UNAVAILABLE` *result*
for the caller; the human-readable cause lives in `_message`, not in more enum
members. `_message` is underscored on purpose — it's "what the failing code
chose to say," like an exception message, not a field callers branch on.

**The shape of `payload` is owned by the orchestrator.** The orchestrator runs
whatever computation it needs, parses the LLM response, and returns the value
the consumer receives — `AIResponse` only carries it. A completion orchestrator
yields a string; a structured one (grading, quiz generation) yields a dict whose
keys *it* defines (e.g. ORA's `rubric_choice`). So "what's in `payload`" is a
per-orchestrator contract, not something the envelope prescribes.

### 4.1 Persistence is built in, not bolted on

Storing a response is not something a downstream developer should have to wire
up. When a call runs, the framework persists it — to edX submissions, via
`SubmissionProcessor` / `AIWorkflowSession.local_submission_id` — as a
first-class, default behavior. The consumer gets a durable record for free and
never touches storage code.

That persistence stays behind a seam so the response type is not entangled with
submissions: `AIResponse` knows nothing about `SubmissionProcessor`, and the
storage backend can change without touching the envelope. The seam is an
internal detail, not an API the caller is expected to operate. (An optional
override — "persist this one somewhere else too" — can exist for advanced cases,
but it is not the path any normal consumer walks.)

### 4.2 Meta

`Meta` is intentionally thin — for now it exposes what litellm already gives us
(`LitellmProcessor.get_usage()`); the value is consistency of what we expose,
evolvable later.

```python
@dataclass(frozen=True, slots=True)
class Meta:
    model: str | None = None
    usage: dict | None = None     # the serialized litellm Usage we already build
    profile_slug: str | None = None
    created_at: str | None = None # ISO timestamp of the completion
```

---

## 5. The principal method — one entry, wrapping `scope.execute()`

There is one trunk method, `run`. It resolves a profile, honors the `enabled`
lever, dispatches the orchestrator action, and returns a **realized**
`AIResponse` — never a task handle. Asynchronous execution is a separate,
explicit sibling (`run_async`, polled with `get_status`), so that a call to
`run` never surprises you with a delayed task. Under the hood these map to the
orchestrator's `run` / `run_async` / `get_run_status` actions.

The profile argument is either a **slug** (resolved from an existing
`AIWorkflowProfile`) or an **in-memory `Profile`** declared in code (§6) — so a
consumer can define a profile and call it in the same breath.

```python
# openedx_ai_extensions/_run.py

def run(
    profile,                               # slug (str) OR an in-memory Profile (§6)
    *,
    scope: ScopeSelectors,
    user,                                  # Django user for permission backends
    action: str = "run",                   # selects the orchestrator METHOD
    user_input: dict | None = None,
) -> AIResponse:
    """
    Resolve profile (code default + DB override, §6), honor the `enabled`
    lever, dispatch the orchestrator action, wrap the result. A typed façade
    over AIWorkflowScope.execute(); it does not reimplement it. Always returns
    a realized AIResponse — for a task handle use run_async().
    """
    resolved = resolve(profile, scope)     # §6 — code default merged with DB patch
    if resolved is None or not resolved.enabled:
        return AIResponse(Status.UNAVAILABLE, _message="no_config")

    if get_engine() is None:
        return AIResponse(Status.UNAVAILABLE, _message="no_engine")

    result = resolved.execute(             # ← the real, existing method
        user_input=user_input or {},
        action=action,
        user=user,
        run_scope=scope,                   # existing param is `running_context`;
    )                                      # worth renaming to drop the loaded "context"
    if is_generator(result):
        return AIResponse(Status.OK, payload=StreamingBody(result))   # §10
    return AIResponse.from_orchestrator_result(result)
```

Asynchronous work is its own method, not a flag on `run`:

```python
def run_async(profile, *, scope, user, user_input=None) -> AIResponse:
    """
    Explicit async entry: dispatches the orchestrator's `run_async` action and
    returns immediately with Status.PENDING and a session_id to poll. Separate
    from run() precisely so `run` never hands back a delayed task.
    """
    ...

def get_status(profile, *, scope, user) -> AIResponse:
    """Poll a previously launched run_async via the `get_run_status` action."""
    ...
```

---

## 6. Profiles — code defaults with a DB-override loop

The current design pairs a disk JSON5 template (`base_filepath`, the good
default that lives in code) with a DB `content_patch` (the easy override). Those
two properties — **good defaults in code, easy override in the DB** — are the
point, and they stay.

Attempt Two extends *where the default can come from*: besides a disk path, a
consumer can declare the default **in code** as an in-memory `Profile` and call
it immediately. `Profile` is a *semi-frozen, structured* class — typed fields,
not a free-form JSON blob — so a definition is hard to break by accident. It
lives in memory and is never persisted on its own; to make it an
operator-editable row, convert it to the Django model.

```python
@dataclass
class Profile:
    """
    An in-memory, structured profile definition — the code-side default.
    Semi-frozen on purpose: typed fields rather than a free-form JSON blob.
    Not stored in the DB; convert to/from AIWorkflowProfile to persist.
    """
    slug: str
    orchestrator_class: str
    processor_config: dict
    actuator_config: dict | None = None

    def to_model(self) -> "AIWorkflowProfile": ...   # persist as an editable row
    @classmethod
    def from_model(cls, row) -> "Profile": ...       # and back


def resolve(profile, scope: ScopeSelectors):
    """
    1. If `profile` is an in-memory Profile, that is the code default.
       If it is a slug, the code default is the AIWorkflowProfile's disk template.
    2. Look up a DB override matched by `scope` (a scope bound to this profile).
    3. No match  → run the code default as-is.
       Match     → apply the scope's JSON5 patch on top of the code default.
    """
    ...


# A consumer declares a profile and calls it in the same place:
feedback = api.Profile(
    slug="ai_coach_feedback",
    orchestrator_class="DirectLLMResponse",
    processor_config={
        "LLMProcessor": {
            "provider": "default",         # overridable by operator
            "prompt": "Evaluate the answer to {{question}}: {{answer}} ...",
        },
    },
)
response = api.run(feedback, scope=ctx, user=user, user_input={...})
```

This requires a change to the profile model so its base can be a code-origin
definition, not only a disk file — the one model change this attempt asks for.
The scope resolver itself (`get_profile`, `list_profiles_for_context`,
`specificity_index`) is already built and correct and is reused untouched. The
override loop is specifically what lets operators re-point **provider
configuration and the prompt** without a code change, per-scope.

---

## 7. Availability — a separate pre-check, sharing the one `Status`

The frontend makes two calls today: "is there a workflow here?" then "run it."
Keep that pre-check as its own verb, but express its outcome with the same
`Status` enum rather than a parallel `Availability` type.

```python
def describe(*, scope: ScopeSelectors, user) -> AIResponse:
    """
    The typed form of AIWorkflowProfileView.get — the frontend's first call,
    and what an XBlock backend-render can use to decide whether to draw a button.

    OK          → payload carries the UIComponents config (render the button)
    UNAVAILABLE → nothing enabled here (draw nothing / disabled state)
    """
    resolved = scope.resolve_profile()
    if resolved is None:
        return AIResponse(Status.UNAVAILABLE, _message="no_config")
    return AIResponse(Status.OK, payload=resolved.profile.get_ui_components())
```

The kill-switch story: `AIWorkflowScope.enabled` is the granular lever;
`AI_EXTENSIONS_ENGINE_BACKEND` unset is the global one. A framework-wide
off-switch, when it arrives, is consulted here.

---

## 8. Sessions — a stable handle over `AIWorkflowSession`

Sessions matter, and today every orchestrator hand-rolls
`self.session.metadata[...] = …; self.session.save()`. The API offers a handle
with transparent get/store/load.

The handle exists for one specific reason: it is the **stable façade that does
not leak the Django model across the api boundary**. If a caller has the
`AIWorkflowSession` model in hand, the handle adds little. But the moment the
model lives behind the api surface — or eventually moves into the engine/
implementation package — consumers must not be importing it directly. The handle
is what lets the storage shape change (including revisiting the "one growing
JSON blob per scope" design) without breaking a single consumer.

```python
def get_or_create_session(*, scope: ScopeSelectors, user) -> "SessionHandle":
    """
    Thin wrapper over AIWorkflowSession.objects.get_or_create(
        user=…, scope=…, profile=…, course_id=…, location_id=…).
    Callers use the handle instead of touching `.metadata` or the model.
    """
    ...

class SessionHandle:
    def store(self, key, value): ...      # namespaced write into metadata (+save)
    def load(self, key, default=None): ...
    def thread(self) -> list[dict]:       # delegates to get_combined_thread()
        ...

# Usage: a consumer keeps per-session state without knowing the model exists.
session = api.get_or_create_session(scope=ctx, user=user)
session.store("draft", draft_text)
history = session.thread()
```

`AIWorkflowSession`, `local_submission_id` (edX submissions), `remote_response_id`
(provider thread), and `get_combined_thread()` all stay.

---

## 9. Orchestrators are the extension surface; the engine is internal

Two different treatments for two different populations:

- **The engine is singular and internal.** There is one LLM engine, and its
  litellm-based processor stack (`LitellmProcessor`, `LLMProcessor`) is *not*
  part of the supported surface — having litellm is an implementation detail of
  the framework. Consumers never subclass or import it.
- **Orchestrators are many and public.** There may be hundreds of orchestrators
  and processors for a myriad of use cases; this is where the variety lives. So
  the base classes are first-class, inheritable, supported surface.

```python
# api.py — supported extension points
from openedx_ai_extensions.workflows.orchestrators import BaseOrchestrator
# (likely also a fuller, batteries-included orchestrator base for common cases)
```

Grading fits here, not as a new verb: ORA and the evaluation XBlocks do a plain
`run`, and structured output is already handled by an orchestrator plus a
response schema (`response_format`, e.g. `educator_quiz_questions.json`). A
dedicated grading orchestrator is the future home — a subclass — and OpenEdX
submissions/grading are not duplicated.

---

## 10. Streaming — kept, with a typed wrapper

Streaming exists and stays. Today it is `DirectLLMResponse._stream_and_emit`
(emits the xAPI event on close) → a generator → `StreamingHttpResponse`, with
the `||{error_marker}||` protocol from
`LLMProcessor._handle_streaming_completion`. Attempt Two only gives the
generator a typed wrapper so it can live in `AIResponse.payload` and trigger
§4.1 persistence on close:

```python
class StreamingBody:
    """Wraps the existing orchestrator generator; realizes Meta + persists the
    response when the stream closes (parity with _stream_and_emit)."""
    def __init__(self, generator): self._gen = generator
    def __iter__(self): yield from self._gen
    def result(self) -> AIResponse: ...   # final envelope after drain
```

The view keeps returning `StreamingHttpResponse(response.payload, …)` — no
behavior change, just a typed handle in front of the same generator. Introducing
this wrapper is also the natural moment to standardize the streaming contract and
decouple it from litellm's chunk shape (see §13).

---

## 11. Stability

- `api.py` is the **only** supported import path; everything else is `_private`.
- `py.typed` (PEP 561); `import-linter` forbids importing `_*` from outside.
- Dual-modality deprecation (PEP 702 `@warnings.deprecated` + a filterable
  `RemovedInAIExtNWarning` subclass).
- `ScopeSelectors._experimental_extras` and the storage/streaming hooks ship
  marked **Provisional** — exempt from the compat guarantee until promoted.

```python
__all__ = [
    "ScopeSelectors", "Actor", "AIResponse", "Status", "Meta", "Profile",
    "run", "run_async", "get_status", "describe", "get_or_create_session",
    "BaseOrchestrator",                   # the extension surface (§9)
]
```

Note what is absent: `LitellmProcessor` and the LLM processor stack are not
exported — the engine is internal.

---

## 12. How the real consumers call it

The examples that matter are the plugins already using AI: **AI coach**,
**xblock-ai-evaluation**, **ORA**, and **badges**. They reach the framework
through the `ai_extensions` XBlock runtime service (ADR-0011), which is a thin
adapter over the same `api.run`. (The internal REST view,
`api/v1/workflows/views.py`, is not the audience here.)

### The XBlock service bridge (`xblock_service/service.py`) — today a stub

```python
# before: AIExtensionsService.run_profile returns a canned dict
def run_profile(self, profile_id, user_input):
    return {"status": "ok", "stub": True, "response": "[stubbed…]", ...}
```

```python
# after: the bridge is a thin pass-through to api.run / api.run_async
def run(self, profile, user_input=None):
    from openedx_ai_extensions import api
    return api.run(
        profile,                                   # slug or in-memory Profile
        scope=api.ScopeSelectors.from_xblock(self.xblock),
        user=self._user(),                         # from scope_ids.user_id
        user_input=user_input,
    )

def run_async(self, profile, user_input=None):
    from openedx_ai_extensions import api
    return api.run_async(
        profile,
        scope=api.ScopeSelectors.from_xblock(self.xblock),
        user=self._user(),
        user_input=user_input,
    )
```

### AI coach — single completion for feedback

```python
service = self.runtime.service(self, "ai_extensions")
r = service.run(
    api.Profile(
        slug="ai_coach_feedback",
        orchestrator_class="DirectLLMResponse",
        processor_config={"LLMProcessor": {
            "provider": "default",
            "prompt": "Evaluate my answer to {{question}}: {{answer}}. "
                      "Assess correctness and how to improve.",
        }},
    ),
    user_input={"question": self.question, "answer": student_answer},
)
return r.text if r.ok else _("Feedback is unavailable right now.")
```

### xblock-ai-evaluation — evaluate a coding answer

```python
r = service.run(
    "code_evaluation",                             # operator-managed profile slug
    user_input={
        "prompt": self.evaluation_prompt,
        "question": self.question,
        "answer": answer,
        "language": self.language,
    },
)
return r.text if r.ok else _("Evaluation unavailable.")
```

### ORA — grade against a rubric (a plain run + a structured schema)

```python
r = service.run(
    "ora_grade",                                   # profile pins model + response_format
    user_input={"question": question, "answer": answer, "rubric": rubric},
)
if r.ok:
    return r.payload.get("rubric_choice")          # structured, status-checked
```

Here the `ora_grade` orchestrator does the work: it calls the LLM, parses the
response, and builds the `{"rubric_choice": …}` dict that lands in
`r.payload` (see §4 — payload shape is the orchestrator's contract).

### Badges — image generation, asynchronously

```python
# ScopeSelectors/Actor are flat dataclasses, so they hand off cleanly to Celery.
# Explicitly async: run_async returns immediately with a PENDING response.
r = service.run_async("badge_image", user_input={...})
if r.status is api.Status.PENDING:
    poll(r.session_id)                             # service.get_status(...) later
```

Every call reuses `scope.execute`, the orchestrators, the processors, and the
resolver as-is. The only thing that changed at the boundary is that it now speaks
`AIResponse` instead of shape-sniffing dicts.

---

## 13. Open questions

1. **Name for `ScopeSelectors`.** Working name is `ScopeSelectors` (clearer);
   the one-word `Selectors` is the alternative. (§2)
2. **Trunk name and dispatch.** `run` vs `evaluate_llm`; and is a free `action`
   string the right dispatch key, or should the common actions be named methods?
   (Async is already settled as its own `run_async`.) (§5)
3. **Profile-model change for code-origin defaults.** The in-memory `Profile`
   + override loop needs the profile's base to come from code, not only a disk
   path — scope the migration, plus the `to_model()`/`from_model()` bridge. (§6)
4. **`AIResponse` first, refactor second?** The envelope is additive and could
   land as its own PR before any ScopeSelectors/session work. (§4)
5. **Session storage shape.** The handle lets us revisit the one-growing-JSON-
   per-scope model without breaking consumers — when, and to what? (§8)
6. **Standardize streaming off litellm.** The `StreamingBody` wrapper is the
   opening to define our own chunk contract and drop the litellm-shaped
   dependency at the boundary — worth it? (§10)
7. **Framework-wide kill switch.** Where the global off-switch lives when it
   arrives, and how `describe()` reports it. (§7)
