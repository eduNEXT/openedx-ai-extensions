# Agent context — plugin-provided XBlock runtime services (Option 5 PoC)

Purpose: everything a fresh agent needs to continue, test, or extend this work
without re-deriving it. Read this first, then ADR-0011.

## Ground rules (from Felipe)

- **Never commit anything.** All work stays in the working tree; Felipe decides
  what gets committed or discarded.
- **Never switch git branches** (`git checkout` / `git switch`). Write files in
  the current working tree.
- Upstream changes (XBlock lib) will only ever merge with community approval —
  the local edits are a proof of concept to inform a public PR, not the PR
  itself.

## The problem in one paragraph

`openedx-ai-extensions` wants to expose an `"ai_extensions"` XBlock service so
any XBlock can call `self.runtime.service(self, "ai_extensions")` without
importing the plugin. There is no supported way for a pip-installed plugin to
register an XBlock runtime service: service wiring is hardcoded in
edx-platform. ADR-0005 (`0005-xblock-ai-service-registration.rst`) explored 4
options (monkey-patch, platform entry points, Django setting, openedx-filters)
and deferred all of them. The community thread is
<https://discuss.openedx.org/t/plugin-provided-xblock-runtime-services/18682>;
Dave Ormsbee replied there that services "were broadly intended to be
pluggable" and asked for a concrete consuming API.

## The key technical insight (verified in code)

All Open edX runtimes resolve services through ONE base method,
`xblock.runtime.Runtime.service()` in the `openedx/XBlock` library:

- Legacy LMS/CMS/Studio build service dicts and stuff them into
  `runtime._services`:
  - `lms/djangoapps/courseware/block_render.py` (~line 597, dict of ~30
    services; `runtime._services.update(services)` at ~line 655)
  - `cms/djangoapps/contentstore/views/preview.py` (~line 210)
  - `cms/djangoapps/contentstore/utils.py:load_services_for_studio` (~line 1270)
  - Lookup happens in `xmodule/x_module.py:ModuleStoreRuntime.service()`
    (~line 1545) which calls `super().service()` → the base method. (Note: if
    the returned service is callable it calls `service(block)` — relevant for
    class-registered services like `XBlockI18nService`.)
- Modern runtime `openedx/core/djangoapps/xblock/runtime/runtime.py:
  XBlockRuntime.service()` (~line 274): hardcoded if/elif chain for ~15
  services, then `return super().service(block, service_name)` → same base
  method. `OpenedXContentRuntime` (learning core / content libraries) inherits
  it.

Therefore one fallback in the base method covers every runtime plus the
xblock-sdk workbench. Zero edx-platform changes. This is "Option 5".

Supporting precedent inside `openedx/XBlock`:

- `xblock/plugin.py` — generic entry-point loader (`Plugin.load_class`) used
  for `xblock.v1` and `xblock_asides.v1` groups. Has: PLUGIN_CACHE (caches
  hits AND misses), `AmbiguousPluginError` on duplicate names, a
  `<group>.overrides` mechanism (`default_select`), and
  `register_temp_plugin(class_, identifier, group)` for tests.
- `xblock/reference/plugins.py:Service` — docstring states the original
  intent: services should "load through Stevedore, and have a plug-in
  mechanism similar to XBlock". Its `__init__(**kwargs)` reads `runtime`,
  `xblock`, `user` kwargs — our instantiation contract mirrors this.
- edx-platform ADR-0006 ("Role of XBlocks") pushes back on expanding the
  *platform's* XBlock runtime; Option 5 sidesteps it because the platform is
  untouched.

## Local repo locations (this machine)

| Repo | Path | State |
|---|---|---|
| openedx-ai-extensions (this repo) | `/data/eduNEXT/ws-community/2025/aiext-azimut/aiext/src/openedx-ai-extensions` | branch `fmo/xblock-connection`; backend lives under `backend/` |
| openedx/XBlock checkout | `/data/eduNEXT/ws-community/2025/aiext-azimut/aiext/src/XBlock` | master @ c57c1bd, clean before PoC; PoC edits uncommitted |
| edx-platform (reference only, "garbage" scratch checkout) | `/data/eduNEXT/ws-community/2025/garbage/edx-platform` | read-only reference for runtime code |

## What has been implemented (uncommitted working-tree changes)

### 1. XBlock library PoC (`src/XBlock`)

- `xblock/runtime.py`:
  - import `Plugin, PluginMissingError` from `xblock.plugin`
  - new class `ServiceProvider(Plugin)` with
    `entry_point = 'xblock.service.v1'` (placed just above `class Runtime`)
  - `Runtime.service()` now tries
    `self._load_service_from_entry_point(block, service_name)` when
    `self._services` has no entry, BEFORE the `need`-raises-NoSuchServiceError
    check. Runtime-provided services therefore always shadow plugin ones.
  - `_load_service_from_entry_point` catches `PluginMissingError` → returns
    None; otherwise instantiates `service_class(runtime=self, xblock=block)`
    per call (no memoization yet — open question #1).
  - Gotcha: `Plugin.load_class(name, default=None)` RAISES
    `PluginMissingError` on a miss (the `default` short-circuit only fires for
    non-None defaults), hence the try/except.
  - Gotcha: `Plugin.load_class` lowercases the identifier.
- `xblock/test/test_plugin_services.py` (new): 5 tests using
  `ServiceProvider.register_temp_plugin(..., group='xblock.service.v1')` and
  `TestRuntime` from `xblock.test.tools`:
  1. service loads from entry point, gets runtime+block bound;
  2. runtime-provided service shadows the plugin one;
  3. missing + `wants` → None;
  4. missing + `needs` → NoSuchServiceError;
  5. registered but undeclared by the block → NoSuchServiceError.
- Tests were NOT run (no dev env yet; deps like `web_fragments` missing in
  the ambient Python). Felipe said to assume they pass; whoever gets a dev env
  should run `pytest xblock/test/test_plugin_services.py`. The repo has
  `uv.lock` and `tox.ini`.

### 2. openedx-ai-extensions PoC (this repo, `backend/`)

- `backend/openedx_ai_extensions/xblock_service/` (new package):
  `AIExtensionsService` with `run_profile(profile_id, user_input)` returning a
  BOGUS stubbed response — piping only, no LLM/workflow call yet. It extracts
  context from the injected `xblock`/`runtime` kwargs (usage_id, course key
  via `scope_ids.usage_id.context_key`, user_id via `scope_ids.user_id`)
  without importing `xblock` itself (loose coupling: the provider contract is
  just "class instantiable with `runtime=`, `xblock=` kwargs").
- `backend/setup.py`: added entry point group:
  `"xblock.service.v1": ["ai_extensions = openedx_ai_extensions.xblock_service:AIExtensionsService"]`
- `backend/tests/test_xblock_service.py` (new): unit tests with mock
  block/runtime, no Django needed.

(If those files are missing, the PoC step was interrupted — recreate from
this description.)

## How to test end-to-end (suggested, not yet done)

1. Stand up a dev env where both `xblock` (the PoC checkout) and
   `openedx-ai-extensions` are `pip install -e` into the same virtualenv as
   edx-platform (tutor mounts or devstack).
2. `pip install -e` of the ai-extensions backend re-registers entry points —
   needed for `xblock.service.v1` to be visible (`importlib.metadata`).
3. In an XBlock (or a Django shell with a real runtime), declare
   `@XBlock.wants("ai_extensions")` on a test block, render it, and call
   `self.runtime.service(self, "ai_extensions").run_profile("p1", "hello")`;
   expect the stubbed payload.
4. Verify precedence/no-regression: stock services (`user`, `i18n`,
   `field-data`) still resolve; a block that never declared `ai_extensions`
   still gets `NoSuchServiceError`.
5. Watch for: per-request instantiation cost, behavior under the CMS preview
   runtime, and the `ModuleStoreRuntime` "callable service" quirk (our
   provider returns an instance, not a class, so it is NOT called with
   `(block)` — instances aren't callable unless `__call__` is defined; keep it
   that way).

## Documents

- `docs/decisions/0011-xblock-service-entry-points.rst` — the ADR (design,
  comparison vs options 1–4, open questions, path forward).
- `docs/decisions/0011-forum-reply-draft.md` — draft reply for the forum
  thread (Felipe will edit/post; answers Dave's API question).
- `docs/decisions/0005-xblock-ai-service-registration.rst` — prior art; its
  Decision section is extended by 0011. Contains links to earlier PoC commits
  for options 1–3 (incl. commits in Henrrypg's edx-platform fork).

## Open questions (need community/maintainer input)

1. Instantiation contract: per-call vs memoized per `(runtime, service_name)`.
2. Operator kill-switch setting vs install-time trust.
3. Group naming: `xblock.service.v1`.
4. Failure isolation: provider import/instantiation errors → None for `wants`
   blocks, or propagate?

## Next steps

1. Felipe reviews/posts the forum reply.
2. Agents test the PoC in a real env (see "How to test" above) before any
   public PR.
3. If community signals positive: draft PR to `openedx/XBlock` (mechanism +
   tests + docs + ADR in that repo), referencing the forum thread.
4. After upstream release: add the entry point to `openedx-ai-extensions`
   releases, replace the stub with the real workflow call (`run_profile` →
   workflows engine), un-defer ADR-0005.
