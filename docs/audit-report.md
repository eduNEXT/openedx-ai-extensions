# Repository Audit — openedx-ai-extensions

*Principal-level audit. Analysis only; no source files were modified.*
*Date: 2026-07-14. Reviewer scope: full backend read; frontend via targeted deep-dive + spot verification; tutor/CI/docs/git verified directly.*

---

## 1. Executive Summary

**Overall health grade: B− (healthy for its stated maturity — "experimental / Alpha, not for production" — but carrying several security and correctness items that must close before any production use).**

This is an unusually well-built experimental plugin: a clean three-layer architecture (workflow → orchestrator → processor), a genuinely extensible config-driven design, 14k lines of backend tests against 7.9k lines of backend source, thoughtful ADRs, and provider abstraction over LiteLLM that already handles OpenAI server-side threading and Anthropic prompt caching. The engineering instincts are good. The gaps are the ones typical of a fast-moving prototype that outran its own documentation and its authorization model.

**Top 3 risks**
1. **Authorization is too weak on the two learner-facing endpoints.** `AIGenericWorkflowView` and `AIWorkflowProfileView` gate only on `IsAuthenticated` (`api/v1/workflows/views.py:39,86`). Any logged-in user can trigger paid LLM calls for any course by passing an arbitrary `courseId`. There is no per-user rate limiting configured in production settings. ADR 0007 acknowledges this but is still "Proposed."
2. **LLM-generated HTML is rendered into the Studio author's session without sanitization** (`library-problem-creator/.../QuestionCard.tsx:126`, `SaveStep.tsx:99`). Course content flows through the LLM and back into raw DOM — a prompt-injection XSS path.
3. **Releases cannot be trusted or reproduced.** Every version file says `2.5.1` (`backend/__init__.py:5`, `tutor/…/__about__.py:1`, `frontend/package.json:3`) even at git tag `v2.9.1`; `backend/setup.py:165` declares the license as Apache 2.0 while the project is AGPL-3.0; and the release workflow was deleted with only an untracked draft to replace it. You cannot currently cut a correctly-labeled, correctly-versioned build. (Related: `backend/CLAUDE.md`/`frontend/CLAUDE.md` describe an obsolete architecture and license — actively misleading in an AI-agent-developed repo.)

**Top 3 opportunities**
1. Close the auth gap (implement ADR 0007's `CourseEnrollmentPermission` + enable DRF throttling for the workflow endpoint) — small change, removes the biggest abuse/cost vector.
2. Add a sanitizer at the HTML render boundary and back-fill tests for the two untested high-blast-radius units (the streaming parser and the OLX parser).
3. De-duplicate the two feature forks (`useAsyncTaskPolling`, `workflowActions`) and introduce one typed workflow-result contract to kill a whole class of shape-sniffing bugs.

---

## 2. Repo Map

**Purpose.** A pluggable "AI Extensibility Framework" for Open edX: config-driven AI workflows (summarize, chat-in-context, quiz/flashcard generation, course-wide content suggestions) surfaced through MFE plugin slots, with no edits to platform core. Intended users: Open edX operators and course teams; developers building new AI workflows via JSON profiles.

**Stack.**
- **Backend:** Django 4.2 + DRF 3.16, Python 3.11/3.12, LiteLLM 1.80 (multi-provider gateway), Celery for async workflows, edx-submissions (chat persistence), openedx-events (event bus), event-routing-backends (xAPI analytics), opaque-keys.
- **Frontend:** React + TypeScript, `@openedx/frontend-plugin-framework` slots, Paragon UI, built with `fedx-scripts babel` (no webpack), `react-markdown` for rendering.
- **Ops:** Tutor plugin (hatch-built wheel that force-includes `backend/` and `frontend/` as package data), tutor-mfe build contexts, Superset asset templates for analytics.

**Architecture sketch (request flow).**
```
MFE slot widget (ConfigurableAIAssistance)
  → POST /openedx-ai-extensions/v1/workflows/  (AIGenericWorkflowView)
    → AIWorkflowScope.get_profile(context)      # specificity-ranked routing
    → scope.execute(action) → BaseOrchestrator.get_orchestrator(...)
      → Orchestrator.run()
        → OpenEdXProcessor  (extract course content from modulestore)
        → LLMProcessor      (LiteLLM completion/responses, streaming, tools)
        → SubmissionProcessor (persist chat as edx-submissions)
    → StreamingHttpResponse (text/plain) or JsonResponse
```
Config lives in on-disk JSON5 **templates** (`workflows/profiles/`) merged with per-`AIWorkflowProfile` DB `content_patch` (RFC 7386 merge). `AIWorkflowScope` rows bind a profile to a course/location-regex/UI-slot with a computed `specificity_index` for resolution.

**Key directories.**
| Path | Role |
|---|---|
| `backend/openedx_ai_extensions/workflows/` | Models (Profile/Scope/Session), orchestrators, template merge/validate |
| `backend/openedx_ai_extensions/processors/llm/` | LiteLLM processors, provider quirks, tool executor |
| `backend/openedx_ai_extensions/processors/openedx/` | Modulestore content extraction, OLX generation, content libraries |
| `backend/openedx_ai_extensions/api/v1/workflows/` | DRF views, serializers (with secret redaction), permissions |
| `backend/openedx_ai_extensions/workflows/profiles/` | On-disk JSON5 workflow templates (base/examples/experimental) |
| `frontend/src/` | Slot widgets, streaming service, feature dirs (flashcard-study, library-problem-creator) |
| `tutor/openedx_ai_extensions/` | Tutor plugin: slot wiring, settings patches, key flow |
| `docs/decisions/` | 12 ADRs (several still untracked in git) |

**Surprising / notable.**
- Version integrity is broken: every version file says `2.5.1` even at git tag `v2.9.1`, and `CHANGELOG.rst` tops out at `1.0.0 (2025-12-24)` with an empty "Unreleased." Tags were cut without bumping versions, and the changelog is unmaintained.
- `LLMProcessor.answer_question()` ships a literal *"Roll a dice…"* experimental prompt (`processors/llm/llm_processor.py:489`).
- `frontend/src/plugin.jsx` exports a `RedLine` red-`<div>` debug component from the public package surface.
- The pyproject wheel does a `force-include` of the entire `backend/` and `frontend/` trees into `openedx-ai-extensions-backend`/`-frontend` package-data folders — unusual but intentional for the tutor-plugin packaging model.

---

## 3. Audit Report

Severity: **Critical** (exploitable/data-loss now) · **High** (must fix before production) · **Medium** (fix soon) · **Low** (cleanup). *[F]* = fact, *[J]* = judgment.

### Security

**S1 — HIGH — Learner endpoints authorize on `IsAuthenticated` only.** *[F]* `api/v1/workflows/views.py:39` (`AIGenericWorkflowView`) and `:86` (`AIWorkflowProfileView`) require only authentication. `get_context_from_request` takes `courseId`/`locationId` from the query param with no relationship check to the user. *[J]* Any authenticated user can (a) enumerate a course's workflow configuration and (b) trigger real, paid LLM executions against any course. Cost-abuse and information-disclosure vector. Fix is specified but unimplemented — ADR 0007 (`docs/decisions/0007-enrollment-check-on-learner-views.md`, status *Proposed*).

**S2 — HIGH — No rate limiting on the paid workflow endpoint in production.** *[F]* `settings/production.py` and `settings/common.py` set no `DEFAULT_THROTTLE_*`; throttling appears only in `backend/test_settings.py:97`. *[J]* Even a single authenticated learner can loop the workflow endpoint and run up unbounded LLM spend. Pair with S1.

**S3 — HIGH — LLM-generated HTML rendered unsanitized in Studio (frontend).** *[F]* `library-problem-creator/components/EditModal/QuestionCard.tsx:126` and `SaveStep.tsx:99` use `dangerouslySetInnerHTML` on `questionHtml`, which originates from LLM output parsed via `topDiv.innerHTML` (`EditModal/utils.ts:80,109`). No DOMPurify/rehype-sanitize anywhere in the package. *[J]* Course content → LLM → raw DOM is attacker-influenceable via prompt injection; executes in the authenticated author's session. High (not Critical) because the content is produced by the operator's own backend workflow.

**S4 — MEDIUM — Tool-calling can read arbitrary course content with no access check.** *[F]* `get_location_content` / `get_course_info` (`processors/openedx/openedx_processor.py:93,431`) accept LLM-supplied `location_id`/`course_id` and call `modulestore().get_item()` directly, with no enrollment/staff gate inside the tool. *[J]* Combined with S1, a user can steer the model to surface content of courses they have no relationship to. Modulestore reads published content, which limits blast radius, but there is no authorization boundary at the tool layer.

**S5 — MEDIUM — CI runs untrusted fork code with live LLM API keys (with a TOCTOU window).** *[F]* `integration-test-trigger.yml` dispatches on a `/integration-test` comment gated to `MEMBER`/`OWNER`; `integration-tests.yml:51-56` checks out `inputs.repository`/`inputs.sha` (the fork) and `:72-77` runs `make test-integration` with `secrets.OPENAI_API_KEY`/`ANTHROPIC_API_KEY`. The head sha is fetched *at trigger time*, not pinned in the comment. *[J]* A maintainer comment runs arbitrary fork code (test files, `conftest`, Makefile) with production keys in scope; worse, a commit pushed between review and comment executes unreviewed. Hardening: require/verify the sha in the comment, use a dedicated low-limit CI key, and gate the keys behind a GitHub Environment protection rule.

**S6 — MEDIUM — OLX generated by Jinja with autoescaping off.** *[F]* `processors/openedx/utils/json_to_olx.py:6` builds a `jinja2.Template` (autoescape defaults to False) and interpolates LLM values into XML, including an attribute: `display_name="{{ p.display_name }}"` (`:7`). *[J]* A `"` or `<` in an LLM field produces malformed OLX or attribute injection into the content library. Correctness + minor injection concern; escape via `autoescape` or `xml.sax.saxutils.quoteattr`.

**S8 — HIGH — Backend package declares the wrong license.** *[F]* `backend/setup.py:165` sets `license="Apache Software License 2.0"` with a matching classifier (`:173`), while the repo `LICENSE`, root `pyproject.toml:6` (`AGPL-3.0-only`), and README all say AGPL-3.0. *[J]* Legal/compliance defect: the published backend package metadata would misstate its license to downstream consumers. One-line fix, but consequential.

**S7 — LOW — Regex from admin evaluated at request time.** *[F]* `AIWorkflowScope.get_profile` runs `re.search(scope.location_regex, location_id)` (`workflows/models.py:296`) with course-staff-authored regex. *[J]* ReDoS is possible but the author is a trusted role and `re.error` is caught; low priority.

*Positive:* secret redaction in the profiles-list serializer is done properly and recursively (`api/v1/workflows/serializers.py:23-60`); `.env` is **not** tracked (verified via `git ls-files`); API keys flow through the tutor `openedx-auth` patch (the correct sensitive-settings store), not common settings; template loading has explicit path-traversal defense (`workflows/template_utils.py:95-127`); frontend does zero token handling and delegates to `getAuthenticatedHttpClient()`.

### Architecture & Design

**A1 — MEDIUM — God files.** *[F]* `AISidebarResponse.tsx` (770 lines, 13 coordinating `useRef`s), `ConfigurableAIAssistance.tsx` (455 lines mixing module-load registration, config fetch, and orchestration), `LibraryProblemCreatorContext.tsx` (414-line provider, 28-field context value); backend `workflows/models.py` `AIWorkflowSession.get_combined_thread` is a single ~120-line method (`:532-654`) with O(n·m) message merging. *[J]* All function today; the sidebar's untested imperative scroll state machine is the most likely to regress silently.

**A2 — MEDIUM — Two divergent forks of the same code (frontend).** *[F]* `flashcard-study/hooks/useAsyncTaskPolling.ts` (106 lines) and `library-problem-creator/hooks/useAsyncTaskPolling.ts` (87 lines) have diverged (different error contracts, one hard-codes a `questionSlots` check inside a "generic" hook); `data/workflowActions.ts` is ~80% duplicated across the two dirs. Only the flashcard fork has tests. *[J]* Bug fixes will land in one fork only.

**A3 — MEDIUM — No typed contract for the workflow response; consumers re-sniff shapes.** *[F]* The orchestrator `response` state is a plain string that is sometimes markdown, sometimes `JSON.stringify(...)` (`ConfigurableAIAssistance.tsx:264`), re-parsed downstream (`AISidebarResponse.tsx:128-141`, `FlashcardStudyResponse.tsx:29-35`); the `response || message || content || result` fallback is copy-pasted in three places. *[J]* One `normalizeWorkflowResult()` removes the duplication and the F4-class bug below.

**A4 — LOW — Orchestrator resolution mixes a hardcoded name map with dotted-path import.** *[F]* `base_orchestrator.py:121-137` keeps a `LOCAL_PATH_MAPPING` of friendly names plus arbitrary `importlib.import_module` on the config string. *[J]* Fine and guarded by a `BaseOrchestrator` subclass check, but the dual path is easy to get subtly wrong as orchestrators multiply; a registry/entry-point would scale better.

*Positive:* the layer separation (workflow/orchestrator/processor) is clean and consistently applied; the frontend `extensionRegistry.ts` is exemplary (two deliberate storage models, documented rationale, tiny surface); provider quirks are isolated in one `providers/__init__.py` module; secret handling and read-only serializers are disciplined.

### Code Quality

**Q1 — MEDIUM — Non-streaming response can be blanked (frontend bug).** *[F]* `GetAIAssistanceButton.tsx:86-104` carefully resolves the message, then `:107` unconditionally runs `setResponse(data.response || buffer)`; for responses delivered in `message`/`content`/`result`, `buffer` is `''`, overwriting the value with empty string → `AIResponseComponent` renders nothing. *[J]* One-line fix (delete `:107`).

**Q2 — MEDIUM — Failed request re-throws into an uncaught onClick (frontend).** *[F]* `ConfigurableAIAssistance.tsx:299` re-throws after handling; `AIRequestComponent.tsx:64` wires `onClick={onAskAI}` with no catch. *[J]* Every failed request yields an unhandled promise rejection.

**Q3 — MEDIUM — Streaming error-marker parser has swallow/hang edge cases.** *[F]* `services/aiPipelineService.ts:141-169` scans for the literal `||{"error_in_stream":` marker: an incomplete marker at EOF is silently dropped and the call resolves as `success` with truncated text; the "safe chunk" branch (`:148`) doesn't kick `processChunkQueue`, risking a non-terminating drain loop; JSON parse failures are swallowed (`:164-167`). The `||…||` convention is also in-band and spoofable if the LLM emits that literal. *[J]* This is a load-bearing, entirely untested code path.

**Q4 — LOW — Dead / experimental code shipped.** *[F]* `LLMProcessor.answer_question` dice-roll prompt (`processors/llm/llm_processor.py:489`); `frontend/src/plugin.jsx` `RedLine` exported publicly; `NO_RESPONSE_MSG` hardcoded English bypassing i18n (`constants.ts:34`); `services/utils.ts:73` `validateEndpoint` unused. *[J]* Trivially removable; `RedLine` in a published API invites accidental dependence.

**Q5 — LOW — `noImplicitAny` off + 44 `any` at API boundaries.** *[F]* `@edx/typescript-config` sets `strict:true` but `noImplicitAny:false`; 44 `any` in non-test source, concentrated exactly at the backend-shape boundary (`ConfigurableAIAssistance.tsx:128`, `LibraryProblemCreatorContext.tsx:121,164,218`). *[J]* `npm run types` passes but proves little where A3's coupling lives. Partly an upstream Open edX config choice.

**Q6 — LOW — Pervasive broad `except Exception`.** *[F]* Dozens of `except Exception: ... return {"error": ...}` / log-and-continue across processors and orchestrators. *[J]* Consistent with a resilience-first prototype, but it hides real failures (e.g. `questionToOlx` silently returns original OLX on error — `EditModal/utils.ts:289`, losing user edits with no signal). Worth tightening on the write/persist paths specifically.

*Positive:* backend code is well-docstringed and readable; the `ToolExecutor` and provider-adaptation logic were extracted into pure, testable helpers; frontend i18n discipline is strong (~1,100 lines of message definitions, error-code→localized-message mapping).

### Testing

**T1 — HIGH — Frontend test coverage is inverted relative to risk.** *[F]* All 9 frontend test files live in `flashcard-study/`. Zero tests for `services/` (incl. the 233-line streaming parser), `ConfigurableAIAssistance.tsx`, `AISidebarResponse.tsx`, the entire `library-problem-creator/` (incl. the 292-line OLX parser), and `ai-extensions-settings/`. `package.json:30` uses `--passWithNoTests`; no `coverageThreshold`. *[J]* The flashcard tests are genuinely behavioral, so the skill exists — the highest-blast-radius code is simply untested. The OLX parser and stream-marker logic are ideal pure-function targets.

**T2 — LOW — Backend tests are strong and behavioral.** *[F]* ~14k lines across 38 test files; `test_api.py` (66 tests), `test_llm_processor.py` (56), `test_models.py` (41); a separate live-LLM integration suite with an LLM-judge harness. *[J]* This is a real strength; the main gap is that CI runs only one axis (py3.12 + django42), so the py3.11 support claim (pyproject `requires-python>=3.11`, classifiers list 3.11) is unverified in CI.

### Performance

**P1 — MEDIUM — N+1 / disk-read amplification in the profiles-list serializers.** *[F]* `PromptTemplateSerializer.get_usage` iterates candidate profiles and computes each `profile.config` (disk template load + merge) per template (`serializers.py:78-119`); `AIWorkflowProfileListSerializer.get_usage` issues a `.count()` per profile (`:230-232`). *[J]* The Studio panel calls the list endpoint; with many profiles this is repeated disk I/O + a query per row. Cache `config` (already `cached_property` per instance) across the request or precompute counts with an annotation.

**P2 — LOW — Stale docstring claims caching that isn't there.** *[F]* `AIWorkflowScope.get_profile` docstring says results are cached with `functools.lru_cache (max 128)` and "cleared on save/delete" (`workflows/models.py:268`), but there is no `lru_cache` on the method (`grep` finds the claim only in the docstring). *[J]* Every request re-queries + regex-loops. Either implement the cache or fix the docstring; the docstring is currently misleading.

**P3 — LOW — Python `str(dict)` used as LLM context.** *[F]* Orchestrators pass `str(content_result)` (Python `repr`, single-quoted) as the model context (`direct_orchestrator.py:66`, `threaded_orchestrator.py:163`, `content_suggestions_orchestrator.py:144`). *[J]* Works, but wastes tokens and is lower-fidelity than JSON; minor cost/quality drag.

### Dependencies

**DEP1 — HIGH — Django 4.2-only, and stale within the series.** *[F]* `requirements/base.txt` pins `django==4.2.20`; `tox.ini` envlist and CI matrix test only `py312-django42`. Django 4.2 LTS extended support ended April 2026 (now past EOL) and 4.2.20 predates the final 4.2.x security patches; Open edX master has moved to Django 5.x. *[J]* No Django 5.2 lane exists, so the plugin is untested against the platform version it will actually run on next. Add a django52 tox/CI leg and run `make upgrade`.

*[F]* Otherwise dependencies are current and cleanly pinned: `litellm==1.80.16`, `openai==2.15.0`, `djangorestframework==3.16.0`, `celery==5.6.0`; `base.in` is minimal and constraint-driven; `package-lock.json` is committed and `dist/` gitignored; frontend peerDependencies (react/paragon/frontend-platform) use realistic ranges. *[J]* Two minor notes: the single runtime dep `react-markdown: "^8 || ^9"` resolves to ESM-only v9 while `package.json` exports map claims a `require` (CJS) condition pointing at the same babel output (`F13`, cosmetic today); and LiteLLM is a heavy, near-daily-release surface with a history of advisories — the ~6-month-old compile is worth refreshing. `setup.cfg` still carries `[wheel] universal = 1`, a meaningless py2/py3 leftover.

### DevEx & Operations

**O1 — HIGH — Release integrity is broken: frozen version + deleted pipeline.** *[F]* All three version files read `2.5.1` (`backend/__init__.py:5`, `tutor/…/__about__.py:1`, `frontend/package.json:3`) — and `git show v2.9.1:backend/…/__init__.py` *also* reads `2.5.1`, so tags v2.6.0–v2.9.1 were cut without a version bump. The release workflow was deliberately removed (commit `968808d`, PR #240) and exists only as an untracked draft (`docs/decisions/release-workflow.md`). *[J]* Any wheel/npm package built from recent tags is mislabeled, and there is no reproducible publish path. Combined with the Apache/AGPL license mislabel (S8), release metadata is currently untrustworthy.

**O2 — MEDIUM — Tutor plugin: `_mount_plugin` ignores its `path` argument.** *[F]* `tutor/openedx_ai_extensions/plugin.py:36-40` is registered on `IMAGES_BUILD_MOUNTS` but adds the backend mount unconditionally instead of matching `os.path.basename(path)`. *[J]* Any `tutor mounts add <anything>` injects this plugin's backend mount. Also `:31-34`: if neither candidate dir resolves, `FRONTEND_PATH`/`BACKEND_PATH` are `None` and the build command gets the literal string `…=None` — a confusing late failure instead of an early error.

**O3 — MEDIUM — Wheel `force-include` has no excludes.** *[F]* `pyproject.toml:79-81` force-includes the whole `backend/` and `frontend/` trees into the wheel; only the *sdist* target excludes `frontend/node_modules` (`:69-71`), and hatchling `force-include` bypasses pattern filtering. *[J]* A wheel built from a used working tree (this one holds `backend/venv/`, `.tox/`, `default.db`, `coverage.xml`, `frontend/node_modules`) would package all of it. Safe only from a fresh clone/sdist — so builds must go through sdist or a clean checkout. The mono-wheel mechanism itself (shipping backend+frontend so tutor build contexts resolve) is clever but installs a non-importable `openedx-ai-extensions-backend/` dir at the site-packages root.

**O4 — MEDIUM — Live-LLM tests also run on every push to `main`.** *[F]* `integration-tests.yml:3-6` triggers on push to main with no concurrency/cancel guard. *[J]* Recurring API spend per merge; acceptable if intentional, but add a concurrency group.

**O5 — LOW — CI matrix is single-axis; assorted CI nits.** *[F]* `ci.yml` `toxenv: [quality, pii_check, django42]`, python 3.12 only (3.11 claim untested); `commitlint.yml` uses an unpinned `@master` ref; `actions/setup-node` pinned at obsolete v2.5.2; no dependabot/CodeQL/CODEOWNERS. The `llm-judge.log` artifact upload (`integration-tests.yml:93-99`) exposes prompt/response content to any logged-in user on a public repo (no secrets).

*Positive:* `make validate` (quality + pii + tests) and the frontend `make validate` (lint `--max-warnings 0` + tsc + test + build) are real, currently-green gates; conventional commits are enforced via `commitlint.yml`; PII annotations are CI-checked; the tutor plugin cleanly auto-discovers sibling `backend/`/`frontend/` for local builds and wires MFE slots + Superset assets.

### Documentation

**D1 — HIGH — `CLAUDE.md` files contradict the code.** *[F]* `backend/CLAUDE.md` states License Apache 2.0 (actual: AGPL-3.0), version 0.0.1, describes `AIWorkflow`/`AIWorkflowConfig` models and a single `orchestrators.py` (actual: `AIWorkflowProfile`/`Scope`/`Session` and an `orchestrators/` package), and claims "prototype mode: save() calls commented out" (no longer true). `frontend/CLAUDE.md` cites `.jsx`, `prop-types`, and endpoint `/aiext/v1/pipeline/chat/completions/` (actual: `/openedx-ai-extensions/v1/...`). *[J]* In an AI-agent-developed repo, a wrong `CLAUDE.md` is worse than none — it will actively mislead future work. Highest-leverage doc fix.

**D2 — MEDIUM — CHANGELOG unmaintained; version skew.** *[F]* Top entry `1.0.0 (2025-12-24)`, empty "Unreleased," while tags reach v2.9.1 and code says 2.5.1 — eight-plus releases undocumented. *[J]* Restore the discipline or the changelog becomes noise. (See O1.)

**D3 — MEDIUM — ADR numbering collisions; half the ADRs uncommitted.** *[F]* Two ADRs are numbered `0004` (`0004-llm-caching-strategy.rst`, `0004-submission-as-chat-storage.rst`) and two `0011` (`0011-live-llm-provider-integration-tests.md` tracked, `0011-forum-reply-draft.md` untracked). ADRs `0007`, `0008`, `0009`, `release-workflow.md`, and the Spanish design doc are untracked, so the on-`main` record skips 0007–0009 entirely. *[J]* Decisions the team relies on live outside version control and the numbering can't be trusted; renumber, commit the real ones, delete scratch.

*Positive:* README install/config instructions are accurate against the actual tutor packaging (verified the `AI_EXTENSIONS` config → `openedx-auth` patch flow, demo-fixtures step, and per-profile key override); minor nits only (empty "Usage" section, README points at the `openedx` org while active dev is on the eduNEXT fork, prerequisites say Node 18 while CI uses Node 20). ADRs, where present, are high quality and explain the *why* (routing specificity, submission-as-chat-storage, Anthropic caching, event bus). Junk files (`default.db`, `coverage.xml`, `venv/`, `.tox/`, egg-info, caches, `.env`) are **not** tracked and never were — the git index is clean despite a cluttered working tree.

---

## 4. Improvement Strategy

**Theme 1 — Establish the authorization boundary the endpoints assume but don't enforce.**
Target: learner endpoints check enrollment (or course-staff for authoring), tool-layer content reads respect that boundary, and the paid endpoint is throttled. Principle: *authorize at the trust boundary, not after the LLM call.* Trade-off: don't over-engineer per-workflow ACLs for an experiment — implement the one `CourseEnrollmentPermission` from ADR 0007 plus DRF throttle classes. **Done signals:** an authenticated-but-unenrolled user gets 403 on `workflows/` and `profile/`; a throttle class caps requests/min; a test asserts both.

**Theme 2 — Sanitize and test the two attacker-influenceable data paths.**
Target: all LLM→DOM rendering passes through DOMPurify; OLX generation escapes attributes; the streaming parser and OLX parser have unit tests. Principle: *content that transits the LLM is untrusted.* Trade-off: accept that backend workflow output is operator-originated (so High, not Critical) — sanitize at the boundary rather than trying to constrain the model. **Done signals:** DOMPurify wraps `questionHtml` renders; `json_to_olx` escapes attributes; new tests cover the `||…||` marker EOF/hang cases and OLX round-trip.

**Theme 3 — One source of truth for shape and for docs.**
Target: a typed `normalizeWorkflowResult()` on the frontend; merged polling/actions helpers; `CLAUDE.md`/CHANGELOG either corrected or deleted. Principle: *duplication and stale docs are the same defect — two descriptions of one thing that will diverge.* Trade-off: not every doc needs to be perfect for an experiment; prioritize the ones agents and contributors actually read. **Done signals:** a single result-normalizer consumed by all response components; one `useAsyncTaskPolling`; `CLAUDE.md` matches `git grep`-able reality or is removed.

**Theme 4 — Make releases trustworthy and CI honest.**
Target: version files match tags, the backend package states AGPL, a release gate exists, and CI tests every claimed Python/Django. Principle: *don't ship metadata you don't verify.* Trade-off: skip full PyPI automation until the project leaves "experimental," but stop the version/license drift and the "build from a dirty tree" hazard now. **Done signals:** `setup.py` license = AGPL-3.0; a tagged build carries a matching version; `Unreleased` populated; py3.11 + django52 legs green (or the claims dropped); wheels are produced only from sdist/clean checkout.

**Explicitly NOT worth fixing now:** the `str(dict)`→LLM context (P3), the orchestrator name-map/dotted-path duality (A4), and the exports-map `require` condition (F13) — all cosmetic for an experiment. The broad-`except` pattern (Q6) should be tightened only on persist/write paths, not swept globally.

---

## 5. Task Plan

Milestones: **M0** safety net → **M1** security/correctness → **M2** high-leverage → **M3** polish.

| # | Title | Milestone | Effort | Change risk | Deps |
|---|---|---|---|---|---|
| 1 | Test the streaming marker parser + OLX parser | M0 | M | Low | — |
| 2 | Add py3.11 + Django 5.2 CI/tox legs (or drop 3.11 claim) | M0 | S | Low | — |
| 3 | Fix `setup.py` license → AGPL-3.0 (S8) | M1 | S | Low | — |
| 4 | Sync version files (2.5.1→real) + restore a tag→build release workflow (O1) | M1 | M | Low | — |
| 5 | Implement `CourseEnrollmentPermission` (ADR 0007) on learner views (S1) | M1 | M | Med | — |
| 6 | Enable DRF throttling for the workflow endpoint in prod settings (S2) | M1 | S | Low | 5 |
| 7 | Sanitize `questionHtml` at render (DOMPurify) (S3) | M1 | S | Low | — |
| 8 | Escape attributes in `json_to_olx` (autoescape/quoteattr) (S6) | M1 | S | Low | 1 |
| 9 | Fix `GetAIAssistanceButton` blanking bug (Q1) + stop re-throw (Q2) | M1 | S | Low | — |
| 10 | Fix streaming EOF-truncation & drain-loop edge cases (Q3) | M1 | M | Med | 1 |
| 11 | Access-check tool-layer content reads (S4) | M1 | M | Med | 5 |
| 12 | Harden `/integration-test` trigger: pin/verify sha, scoped CI key (S5) | M1 | S | Low | — |
| 13 | Add wheel excludes / build only from sdist; fix `_mount_plugin` path guard (O2/O3) | M2 | S | Med | — |
| 14 | Correct or delete `backend/` & `frontend/` `CLAUDE.md` (D1) | M2 | S | Low | — |
| 15 | Merge polling/workflowActions forks; add `normalizeWorkflowResult` (A2/A3) | M2 | L | Med | 1 |
| 16 | Cache/annotate profiles-list usage counts (P1) | M2 | M | Low | — |
| 17 | Fix `get_profile` caching docstring or implement lru_cache (P2) | M2 | S | Low | — |
| 18 | CHANGELOG to 2.x; renumber/commit ADRs; remove scratch (D2/D3) | M3 | S | Low | — |
| 19 | Remove dead/demo code: `answer_question`, `RedLine`, `validateEndpoint`; i18n `NO_RESPONSE_MSG` (Q4) | M3 | S | Low | — |
| 20 | Split `AISidebarResponse` scroll state machine into a tested hook (A1) | M3 | L | Med | 1 |

**Quick wins (high impact, S effort):** #2, #3, #6, #7, #9, #12, #14, #17, #19.

### Top-3 implementation sketches

**Task 5 — `CourseEnrollmentPermission` on learner views.**
Approach: add a DRF permission class in `api/v1/workflows/permissions.py` mirroring the existing `CourseStaffPermission` structure. Steps: (1) baseline `IsAuthenticated`; (2) `is_staff`/`is_superuser` short-circuit; (3) read `course_id` from `get_context_from_request`; if present, check enrollment through a new `edxapp_wrapper` backend (`CourseEnrollment.is_enrolled`), following the wrapper pattern already used for `student_module` — do **not** import `common.djangoapps.student` directly (keeps the package installable standalone); (4) if no `course_id`, allow (course-agnostic calls). Wire it onto `AIGenericWorkflowView` and `AIWorkflowProfileView`. Gotchas: preserve the standalone/test fallback (no enrollment model → allow) so the existing 14k-line suite stays green; add a test that an unenrolled non-staff user gets 403.

**Task 7 — Sanitize `questionHtml`.**
Approach: introduce DOMPurify as a dependency and a tiny `SafeHtml` wrapper. Steps: (1) add `dompurify`; (2) replace the two `dangerouslySetInnerHTML={{__html: questionHtml}}` sites (`QuestionCard.tsx:126`, `SaveStep.tsx:99`) with `dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(questionHtml)}}` via the wrapper; (3) also sanitize the round-trip at `EditModal/utils.ts:174` before saving. Gotchas: keep MathJax/allowed problem markup in the allowlist (Open edX problems use specific tags) — test against a real generated problem so sanitization doesn't strip legitimate content.

**Task 1 — Test the streaming marker parser + OLX parser.**
Approach: these are near-pure functions — ideal first tests. Steps: (1) extract/point tests at `aiPipelineService`'s marker handling; assert (a) a complete `||{json}||` mid-stream surfaces the coded error, (b) a *truncated* marker at EOF does **not** silently succeed (this test will fail first — it documents Q3/Task 8), (c) literal-`||`-in-content doesn't false-positive; (2) for `EditModal/utils.ts`, assert `olxToQuestion(questionToOlx(x)) ≈ x` round-trips and that malformed OLX yields `parseError` rather than a thrown exception. Gotchas: mock the streaming `ReadableStream`/reader; write the failing EOF test now and let Task 8 make it pass.

---

## 6. Open Questions (need a human decision)

1. **Product intent for endpoint authorization:** should learner workflows require *enrollment*, or is authenticated-any-course intentional for some slots (e.g. a course-agnostic assistant)? This determines whether Task 3 is a straight enrollment gate or needs a per-scope allow-list.
2. **Cost controls:** what per-user / per-course LLM budget or rate is acceptable? Drives the throttle numbers in Task 4 and whether a spend cap belongs in the backend.
3. **Python 3.11:** is it actually a support target? If yes, add the CI leg; if no, drop it from `pyproject`/classifiers.
4. **Release model:** is the project ready to re-establish a tag→build→publish flow, or stay install-from-git while "experimental"? Affects Task 14 and the version-skew fix.
5. **Deprecation candidates:** `answer_question` (dice-roll), `RedLine`, and the `examples/` profile zoo — keep as living examples or prune? 
6. **`str(dict)` LLM context:** intended, or should content be JSON-serialized for the model? Low urgency but a product/quality call.

---

*Areas that received lighter review, disclosed for honesty:* the xAPI transformers (`xapi/transformers.py`), the Superset asset templates, migration correctness across the 8 migrations, and the `component_extractors.py` block-type coverage were skimmed, not deeply audited. The core ~20% (workflow routing, orchestrators, LLM/submission processors, API layer, streaming, tutor wiring) was read in full.
