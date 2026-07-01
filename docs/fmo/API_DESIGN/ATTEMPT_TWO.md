# `api.py` Design — Attempt Two (grounded in the current code)

> **Status:** illustrative sketch, not working code — same "feel" style as
> Attempt One, but every name here is a **real class or method** in
> `backend/openedx_ai_extensions/`. Bodies are still sketched; signatures are
> not invented.
>
> **What changed from Attempt One.** Attempt One designed a greenfield surface
> *beside* the code. This attempt designs the surface *on top of* what exists:
> `AIWorkflowProfile`, `AIWorkflowScope`, `AIWorkflowSession`,
> `BaseOrchestrator` + its subclasses, the `LLMProcessor`/`LitellmProcessor`
> stack, `settings.AI_EXTENSIONS`, `PromptTemplate`, and the
> `AIExtensionsService` XBlock bridge.
>
> **Two decisions locked before drafting:**
> 1. **Context *wraps*, Scope untouched.** `api.Context` is a thin frozen
>    value object over the resolution inputs; `AIWorkflowScope` keeps its
>    model. No scope-model refactor in this attempt.
> 2. **Real signatures, illustrative bodies.**
>
> Where Attempt One was wrong about the code, there's a **↯ correction** note.

---

## 0. The map: proposal ⟷ what already exists

Read this first. It's the whole point of Attempt Two.

| Surface concept | Backing code (today) |
|---|---|
| `api.Context` | resolution inputs to `AIWorkflowScope.get_profile(course_id, location_id, ui_slot_selector_id)` |
| `api.Actor` | `request.user` — used only for permissions + xAPI (`_emit_workflow_event`), never sent to the LLM |
| the profile you name | `AIWorkflowProfile` = disk JSON5 template (`base_filepath`) + DB `content_patch`; `.config` → `orchestrator_class` + `processor_config` + `actuator_config` |
| "run it" | `AIWorkflowScope.execute(user_input, action, user, running_context)` → `BaseOrchestrator.get_orchestrator(...)` → `getattr(orch, action)(user_input)` |
| the engine / router | `LLMProcessor` / `LitellmProcessor` (completion + responses API + streaming + tools); creds from `settings.AI_EXTENSIONS` |
| `AIResponse` | **does not exist yet** — ad-hoc dicts + raw generators. This is the one net-new type. |
| availability pre-check | `AIWorkflowProfileView.get` → UIComponents config or `{"status": "no_config"}` (the frontend's first of two calls) |
| session | `AIWorkflowSession` (+ growing `metadata` JSON, `local_submission_id`, `remote_response_id`) |

The takeaway: **almost everything already exists.** `api.py` is mostly a
*thin, typed, stable façade* over machinery that's already here. The only new
runtime object worth adding is `AIResponse`.

---

## 1. Package split — the engine is a *backend class*, not an entry point

Keep the heavy dependency (litellm, and the whole `LLMProcessor` stack) out of
the always-importable core. But **not** via a stevedore entry-point group.

> **↯ correction (Attempt One §1).** A `stevedore` `xblock.service.v1`-style
> entry point implies *many interchangeable engines discovered at runtime*. We
> don't have that and don't need it — there is **one** LLM engine. The real
> requirement is only "don't force the heavy import on installs that don't use
> it." The pattern already in this repo for exactly that is the
> **backend-class Django setting** (`edxapp_wrapper/`, `STUDENT_MODULE_BACKEND`).

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

> **Your note (line 65/99/125):** "Maybe entry_point is not necessary, but a
> backend class either way… load the router once in the lifetime of the
> server… the separation we do need is to keep the big heavy dependencies out."
> This is that, exactly: one `lru_cache`'d backend class, heavy import deferred.

The "engine" wraps the *existing* `LLMProcessor`; it is not a new parallel
router. `LLMProcessor(config, user_session, extra_params)` stays the
implementation — the engine is just the seam that lets the core name it
without importing it.

---

## 2. `api.Context` — a thin wrapper over the resolution inputs (Scope untouched)

Per the locked decision, `AIWorkflowScope` keeps its model. `Context` is a
frozen value object carrying exactly the three things
`AIWorkflowScope.get_profile()` already takes, plus `service_variant` (which
`list_profiles_for_context` already reads).

```python
# openedx_ai_extensions/_types.py

from dataclasses import dataclass, field

@dataclass(frozen=True, slots=True)
class Context:
    """
    The transient resolution key. Wraps the inputs to
    AIWorkflowScope.get_profile(); it does NOT replace the scope row.

    Resolving a Context yields a concrete AIWorkflowScope (which carries the
    `enabled` on/off lever and the profile FK).
    """
    course_id: str | None = None
    location_id: str | None = None          # opaque UsageKey string
    ui_slot_selector_id: str | None = None
    service_variant: str | None = None      # "lms" | "cms"

    # smell — deliberately ugly. See §2.1.
    _experimental_extras: dict = field(default_factory=dict)

    @classmethod
    def from_xblock(cls, block, *, ui_slot_selector_id=None) -> "Context":
        """Adapter so XBlocks / the ai_extensions service don't hand-roll this."""
        scope_ids = block.scope_ids
        return cls(
            course_id=str(scope_ids.usage_id.context_key),
            location_id=str(scope_ids.usage_id),
            ui_slot_selector_id=ui_slot_selector_id,
        )

    @classmethod
    def from_request(cls, request) -> "Context":
        """Mirror of api/v1/workflows/permissions.get_context_from_request()."""
        ...

    def resolve_scope(self) -> "AIWorkflowScope | None":
        """The existing resolver, unchanged. None ⇒ nothing configured/enabled."""
        from openedx_ai_extensions.workflows.models import AIWorkflowScope
        return AIWorkflowScope.get_profile(
            course_id=self.course_id,
            location_id=self.location_id,
            ui_slot_selector_id=self.ui_slot_selector_id,
        )
```

> **Your note (line 153):** Context info currently lives in `AIWorkflowScope`,
> which "is critical because it contains the only on/off lever in the system"
> (`enabled`). With the *wrap* decision, `Context` is the transient key and the
> resolved `Scope` is still the authority — the `enabled` lever is untouched.
> The frozen-dataclass ergonomics you liked apply to the *key*, not the row.

### 2.1 The extras escape hatch, marked as shame

> **Your note (line 192):** mark the hatch as clearly experimental/unstable —
> "take a clue from the shame.css movement."

`_experimental_extras` carries a leading underscore *and* the word
experimental. It is **not** in `__all__`-blessed territory, it's excluded from
the stability guarantee (§11), and a static-analysis rule can flag any consumer
that touches it. It exists, but you have to be ashamed to use it.

---

## 3. `api.Actor` — kept deliberately small

> **Your notes (lines 25/183/184/185):** the only real reasons for an Actor
> today are **roles/permissions** and **xAPI tracking**. The actor is *never*
> sent to the LLM. Keep it real.

```python
@dataclass(frozen=True, slots=True)
class Actor:
    """Who the call is for. Feeds permission checks and xAPI events only."""
    user_id: int | None = None
    roles: frozenset[str] = frozenset()   # course_staff, instructor, student…
    # NOTE: no `language`, no `username` until something actually needs them.
```

The principal method still takes the Django `user` object where permission
backends need it (`permission_is_course_staff(user, course_id)`); `Actor` is
the serializable shadow used for Celery hand-off and `_emit_workflow_event`.

---

## 4. `AIResponse` — the one net-new type (the beachhead)

This is the highest-value, lowest-disruption change: today orchestrators return
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

> **Your note (line 213):** the exact status set isn't final. Operational
> issues (key/quota/service-down), on/off (temporal vs definitive), and
> no-engine are *distinct problems* that probably collapse to the same
> `UNAVAILABLE` result for the caller. Kept to four; the reason lives in
> `_message`, not in more enum members.

> **Your note (line 221):** `reason` felt too specific. Renamed `_message`,
> underscored, framed as "the thing the failing code chose to say" — like an
> exception message — not a first-class field callers branch on.

> **Your note (line 218) — storage hook.** The envelope is the right home for
> "when a stream finishes, persist it (to edX submissions)." Sketch:

```python
    def with_storage(self, hook) -> "AIResponse":
        """
        Attach a callback invoked when the payload is fully realized
        (immediately for dicts; on stream-close for StreamingBody).
        Lets the engine persist to submissions transparently for the caller.
        """
        ...
```

> **Your note (line 244) — Meta.** For now it is "whatever litellm returns";
> the value is *consistency of what we expose*, evolvable later. So `Meta`
> stays intentionally thin and is populated from
> `LitellmProcessor.get_usage()`:

```python
@dataclass(frozen=True, slots=True)
class Meta:
    model: str | None = None
    usage: dict | None = None     # the serialized litellm Usage we already build
    profile_slug: str | None = None
```

---

## 5. The principal method — one entry, wrapping `scope.execute()`

> **Your notes (lines 38–41):** the principal method is heavier than "sugar."
> Think `evaluate_llm(profile, scope, user, input, sync=True, …)` as the trunk,
> with `run_by_profile()`, `evaluate_async()`, etc. as configured callers —
> exact split still TBD, and helpers are a *second loop*, not now.

So Attempt Two commits to the **trunk only** and shows the helpers as one-liners
to prove they're thin. The trunk wraps the existing execute path and returns an
`AIResponse`.

```python
# openedx_ai_extensions/_run.py

def run(                                   # working name; could be evaluate_llm
    *,
    context: Context,
    user,                                  # Django user for permission backends
    action: str = "run",                   # selects the orchestrator METHOD
    user_input: dict | None = None,
    sync: bool = True,
) -> AIResponse:
    """
    Resolve context → scope, honor the `enabled` lever, dispatch the
    orchestrator action, wrap the result. This is a typed façade over
    AIWorkflowScope.execute(); it does not reimplement it.
    """
    scope = context.resolve_scope()
    if scope is None:                      # no enabled scope ⇒ unavailable
        return AIResponse(Status.UNAVAILABLE, _message="no_config")

    if get_engine() is None:
        return AIResponse(Status.UNAVAILABLE, _message="no_engine")

    running_context = {
        "course_id": context.course_id,
        "location_id": context.location_id,
    }
    effective_action = action if sync else "run_async"
    result = scope.execute(                # ← the real, existing method
        user_input=user_input or {},
        action=effective_action,
        user=user,
        running_context=running_context,
    )
    if is_generator(result):
        return AIResponse(Status.OK, payload=StreamingBody(result))   # §10
    return AIResponse.from_orchestrator_result(result)
```

Helpers (the "second loop", shown only to prove thinness):

```python
def run_by_profile(profile_slug, *, user, user_input=None): ...   # bypass scope
def run_async(*, context, user, user_input=None):
    return run(context=context, user=user, user_input=user_input, sync=False)
def get_status(*, context, user):
    return run(context=context, user=user, action="get_run_status")
```

> **↯ correction (Attempt One §6).** There is no `evaluate()` and no `chat()`
> here. `action` already selects the orchestrator method — sync/async/status is
> `run`/`run_async`/`get_run_status`, not new verbs. The verb *is* the trunk;
> everything else is an `action` string or a thin caller.

> **Your note (line 414):** grounding the AIResponse idea in the current models
> is exactly what makes it a real refactor rather than a redesign — the trunk
> above changes no orchestrator, only what the *view* and the *service* receive.

---

## 6. Profiles — the template+patch reality, and `run_ad_hoc_profile`

> **↯ correction (Attempt One §4).** `api.register_profile(Profile(model=…,
> system=…, params=…))` does not match the code. A profile is
> `AIWorkflowProfile`: a disk **JSON5 template** (`base_filepath`) plus a DB
> **`content_patch`** merged into `.config`. Model, prompt, params, streaming,
> and the orchestrator all live *inside* `processor_config` /
> `settings.AI_EXTENSIONS`, not as flat fields.

So there's nothing to "register" from Python — the code-side default is the
disk template; the operator override is the DB patch. That machinery already
answers considerations #3/#8.

> **Your note (line 285):** the piece worth adding is `run_ad_hoc_profile` —
> "check the backend (DB) for an override to this profile; if present use it,
> else use the code/disk default — and loop over the scope, because different
> scopes can carry different versions of the same profile."

```python
def run_ad_hoc_profile(profile_slug, *, context: Context, user, user_input=None) -> AIResponse:
    """
    Run a named profile without a UI-slot scope match.

    Resolution, grounded in the existing models:
      1. Look for an AIWorkflowScope in `context` bound to this profile
         (scope-specific DB override / version).  ← the "loop with the scope"
      2. Fall back to the AIWorkflowProfile row (disk template + content_patch).
    """
    ...
```

The scope resolver itself (`get_profile`, `list_profiles_for_context`,
`specificity_index`) is **already built and correct** — Attempt One's invented
`site > org > course` ordering is dropped.

---

## 7. Availability — keep the separate pre-check, fold the states into `Status`

> **Your notes (lines 338/347/363):** keep the pre-check separate (the frontend
> does two calls today: "is there a workflow here?" then "run it"), but don't
> invent a parallel `Availability` enum — fold those states into the one
> `Status`.

```python
def describe(*, context: Context, user) -> AIResponse:
    """
    The typed form of AIWorkflowProfileView.get — the frontend's first call,
    and what an XBlock backend-render can use to decide whether to draw a button.

    OK          → payload carries the UIComponents config (render the button)
    UNAVAILABLE → nothing enabled here (draw nothing / disabled state)
    """
    scope = context.resolve_scope()
    if scope is None:
        return AIResponse(Status.UNAVAILABLE, _message="no_config")
    return AIResponse(Status.OK, payload=scope.profile.get_ui_components())
```

> The kill-switch story is unchanged: `AIWorkflowScope.enabled` is the granular
> lever; `AI_EXTENSIONS_ENGINE_BACKEND` unset is the global one. Your note
> (line 371) that the framework will likely grow *one big kill switch* is
> future work, and `describe()` is the natural place to consult it.

---

## 8. Sessions — first-class get/create + store/load over `AIWorkflowSession`

> **Your note (line 220):** sessions "turned out to be very important." Today
> the metadata JSON just grows, one per scope, and every orchestrator
> hand-rolls `self.session.metadata[...] = …; self.session.save()`. Give
> downstream users transparent helpers.

```python
def get_or_create_session(*, context: Context, user) -> "SessionHandle":
    """
    Thin wrapper over AIWorkflowSession.objects.get_or_create(
        user=…, scope=…, profile=…, course_id=…, location_id=…).
    Returns a handle with load()/store()/thread() so callers never touch
    `.metadata` directly.
    """
    ...

class SessionHandle:
    def store(self, key, value): ...      # namespaced write into metadata (+save)
    def load(self, key, default=None): ...
    def thread(self) -> list[dict]:       # delegates to get_combined_thread()
        ...
```

> This is a *wrapper*, not a new model — `AIWorkflowSession`,
> `local_submission_id` (edX submissions), `remote_response_id` (provider
> thread), and `get_combined_thread()` stay. The win is that
> `EducatorAssistantOrchestrator` and friends stop poking `metadata` by hand.
> Worth revisiting the "one growing JSON" shape once the trunk is settled.

---

## 9. Orchestrators & processors stay the extension surface (base classes kept)

> **↯ correction (Attempt One §1 aside).** Attempt One argued *against* base
> classes ("a protocol so consumers don't inherit"). That's right for the
> *engine* (one impl) but **wrong for orchestrators/processors**.

> **Your note (line 135):** "there might be hundreds of orchestrators/processors
> out there for a myriad use cases. For the lib and the router there will be one
> of each." So the design keeps `BaseOrchestrator` /
> `LitellmProcessor` as first-class, inheritable extension points — that's where
> the variety lives — and reserves the *no-inheritance* treatment for the single
> engine seam in §1.

`api.py` therefore exports the base classes as **supported** surface:

```python
# api.py
from openedx_ai_extensions.workflows.orchestrators import BaseOrchestrator
from openedx_ai_extensions.processors.llm.litellm_base_processor import LitellmProcessor
```

Grading fits here too:

> **Your notes (lines 419/425/460):** there is no separate grading verb. ORA and
> the evaluation XBlocks do a **plain `run`**; structured output is already
> handled by an orchestrator + a response schema (`response_format`, e.g.
> `educator_quiz_questions.json`). A dedicated *grading orchestrator* is the
> future home — a subclass, not a new API verb. `Evaluation` is dropped; we do
> not duplicate OpenEdX submissions/grading.

---

## 10. Streaming — kept, grounded in the real path

> **Your notes (lines 533/534/690):** streaming exists and stays; evaluate it
> against `AIWorkflowSession` + `session_based_orchestrator`.

Streaming is already: `DirectLLMResponse._stream_and_emit` (emits the xAPI event
on close) → a generator → `StreamingHttpResponse`, with the `||{error_marker}||`
protocol from `LLMProcessor._handle_streaming_completion`. Attempt Two only
gives the generator a typed wrapper so it can live in `AIResponse.payload` and
carry the §4 storage hook:

```python
class StreamingBody:
    """Wraps the existing orchestrator generator; realizes Meta + fires the
    storage hook when the stream closes (parity with _stream_and_emit)."""
    def __init__(self, generator): self._gen = generator
    def __iter__(self): yield from self._gen
    def result(self) -> AIResponse: ...   # final envelope after drain
```

The view keeps returning `StreamingHttpResponse(response.payload, …)` — no
behavior change, just a typed handle in front of the same generator.

---

## 11. Stability — unchanged from Attempt One (you agreed 100%)

> **Your note (line 585):** all best practices, keep them. Verbatim intent:

- `api.py` is the **only** supported import path; everything else is `_private`.
- `py.typed` (PEP 561); `import-linter` forbids importing `_*` from outside.
- Dual-modality deprecation (PEP 702 `@warnings.deprecated` + a filterable
  `RemovedInAIExtNWarning` subclass).
- `Context._experimental_extras` and the storage/streaming hooks ship marked
  **Provisional** — exempt from the compat guarantee until promoted.

```python
__all__ = [
    "Context", "Actor", "AIResponse", "Status", "Meta",
    "run", "run_async", "run_by_profile", "run_ad_hoc_profile",
    "get_status", "describe", "get_or_create_session",
    "BaseOrchestrator", "LitellmProcessor",   # the extension surface (§9)
]
```

---

## 12. Before & after — with the real call sites

> **Your note (line 679):** redo these once the methods are grounded. Here they
> are against the *actual* entry points.

### The XBlock service (`xblock_service/service.py`) — today a stub

```python
# before: AIExtensionsService.run_profile returns a canned dict
def run_profile(self, profile_id, user_input):
    return {"status": "ok", "stub": True, "response": "[stubbed…]", ...}
```

```python
# after: the stub becomes a real, typed call — no new machinery
def run_profile(self, profile_id, user_input):
    from openedx_ai_extensions import api
    response = api.run_ad_hoc_profile(
        profile_id,
        context=api.Context.from_xblock(self.xblock),
        user=self._user(),                 # resolved from scope_ids.user_id
        user_input=user_input,
    )
    return response                        # typed AIResponse, .ok / .text / .payload
```

### The REST view (`api/v1/workflows/views.py`)

```python
# before: branch on is_generator(result) and "error" in result, build dicts by hand
result = workflow_profile.execute(user_input=…, action=action, user=…, running_context=…)
if not is_generator(result) and isinstance(result, dict) and "error" in result:
    return JsonResponse({"error": {...}, "status": "error", ...}, status=500)
if is_generator(result):
    return StreamingHttpResponse(result, content_type="text/plain")
return JsonResponse(result, status=200)
```

```python
# after: one typed object decides the HTTP shape
response = api.run(
    context=api.Context.from_request(request),
    user=request.user,
    action=request.data.get("action", "run"),
    user_input=request.data.get("user_input", {}),
)
if isinstance(response.payload, StreamingBody):
    return StreamingHttpResponse(response.payload, content_type="text/plain")
if response.status is Status.ERROR:
    return JsonResponse({"error": response._message}, status=500)
return JsonResponse(response.payload, status=200)
```

Every "after" reuses `scope.execute`, the orchestrators, the processors, and the
resolver as-is. The only thing that changed is that the boundary now speaks
`AIResponse` instead of shape-sniffing dicts.

---

## 13. Open questions carried to Attempt Three

1. **Trunk name and signature** — `run` vs `evaluate_llm`; is `action` the right
   dispatch key, or should sync/async be a real parameter over a smaller action
   set? (§5)
2. **`AIResponse` first, refactor second?** The envelope is additive — could
   land on its own as a PR before any Context/session work. (§4)
3. **Session shape** — wrap the growing-JSON `metadata` (§8), or is that the
   moment to reconsider the one-session-per-scope model? Deferred, but flagged.
4. **`describe()` + a global kill switch** — where the framework-wide off-switch
   lives when it arrives. (§7)
5. **Do we ever want `run_by_profile` to skip the `enabled` lever?** Bypassing
   scope also bypasses the only on/off control — needs a rule. (§6)
6. **Prompt-template engine location** — still deferred; the coming refactor
   reshapes the question. (your note, line 694)
