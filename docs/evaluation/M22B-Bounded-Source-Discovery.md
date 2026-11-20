# M22B · Bounded Source discovery

**Ready for the controlled M22C pilot.** The real Dashboard journey and manual path passed against the reference stack. The reviewed base was `0cfef5136992e811339673fcd43bc3de3989258b` on `feature/M22A-source-onboarding`. Remote `main` was `b8073dad43a72ae5d108d2d8a3f40dcf1706a6a6` and did not contain the reviewed commit. Teammate review is pending.

## Operator workflow and limits

On an approved web Source, choose **Create draft → Get a profile suggestion**. Supply a permitted homepage and keyword, or permitted results and representative detail URLs for the same keyword. Review the observed values, reasons, request limits and stop stage. **Apply to editor** updates the local form and offers Undo. Continue through explicit draft creation, Preview, Validate and approval. Existing record types, field types and identity choices are sent as hints. An unresolved mapping stays editable. The endpoint returns a transient result and writes no Profile, Job, binding or discovery evidence.

`POST /api/v1/sources/{source_id}/profile-suggestions` requires `mode` and `keyword` with either `homepage_url` or both `results_url` and `detail_url`. The optional `record_schema` is the existing Core schema. Source policy and the shared Redis request slot apply to every stage. Actual transport attempts include redirect and failed attempts. The ledger reports stage and reservation state without URLs.

| Effective limit | Controlled fixture | Public HTTPS |
| --- | --- | --- |
| Requests | Up to five for a homepage, up to three for examples | Up to three. Homepage requests stop in preflight |
| Overall deadline | Up to 20 s | Up to 15 s |
| Per request | Up to 512,000 body bytes and 2 s including DNS | Same |
| Cumulative body bytes | Request cap times per-response cap, at most 2,560,000 | At most 1,536,000 |
| Shared pacing | At least 2,000 ms, raised by Source or robots policy | Same |

The Source model has no reviewed onboarding cap. Public discovery therefore uses the conservative three-request and 15-second publisher ceilings without inferring broader permission from a publisher name or URL. Approved and formerly approved search Profiles on the selected Source and origin can only tighten the effective cap. HTTP discovery requires the existing fixture mode. There is one origin, one robots request, at most one navigation hop and one fetched detail. The operation has zero redirects, retries and pagination. Shared pacing and permission are checked before transport, including after a reserved slot waits.

The supported homepage shape is a unique static GET keyword form with a Core-representable target, directly or behind one unambiguous search link. Examples must reproduce a single-parameter keyword search and name a detail linked in the eligible results. Repeated structural rows must distinguish the publication links from recurring navigation, with 20 homepage links and 20 result rows as inspection ceilings. The sampled publication needs a heading matching the listing text. Fields need named or structural evidence for their types. Single-row listings, companion form parameters, script-only and POST searches may require examples or manual entry. Layout changes or uncertain meanings require operator review. The suggested search uses a three-request, one-detail Profile budget for sample checks. A later collection needing more details requires an explicitly reviewed configuration with suitable limits. Public publisher traffic and the reserved trial tasks were outside this verification.

## Controlled evidence

The Edge Dashboard used the real FastAPI, PostgreSQL, Redis and Scrapling fixture services. An approved Source opened in a blank editor. Four explicit suggestion actions had these fixture-confirmed request sequences.

| Action | Outbound GETs | Result |
| --- | ---: | --- |
| Catalog POST-only entry | 2 | Robots and homepage, then the examples action appeared |
| Catalog examples | 3 | Robots, canonical results and Alpha detail |
| Catalog homepage | 5 | Robots, homepage, search navigation, results and Alpha detail |
| Cards homepage | 4 | Robots, homepage, results and Alpha detail |

Suggestion actions left the version list empty and the Job list unchanged. The Cards suggestion proposed `./p` for count with typed sample `10` and title `Alpha outlook`. The operator changed the selector to `./p[@class='count']`, explicitly created the draft, and validated it. Editing the record type then removed the approval path until the updated draft was saved and revalidated. Preview of revision 2 returned title `Alpha outlook` and raw count `"10"`. Validate reported one valid record. Explicit approval persisted revision 2 of version `e3ad139d3df04681bdf58a6f3f2deaf7` with configuration hash `7d94b1d9e226025bc71f1d4a0082050eab2e3a6a50c6cac365ff1290ddde4bf1` and report `b96b6f4709b640ad9ba910cbc44c8341`. Both edits persisted. A later homepage attempt on that Source applied the reviewed three-request cap and sent zero requests. A separate manual Dashboard test saved and validated a Catalog Profile with no suggestion call.

### Offline selector quality

Scoring ran the **unedited** generated selectors through Core traversal, extraction and typed ingestion. Each layout's Beta detail was held back from all discovery fetches and scored offline. Both layouts had the expected typed records `Alpha outlook / 10` and `Beta outlook / 20`. The operator's selector edit above was assessed only in the Dashboard run.

| Reference layout | Expected links | Decoy excluded | Expected typed fields | Incorrect | Missing | Unresolved |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Cards | 2/2 | Yes | 4/4 | 0 | 0 | 0 |
| Catalog | 2/2 | Yes | 4/4 | 0 | 0 | 0 |

The replay suite also checked distinct misleading links, a semantically wrong heading, initial and subsequent destination denials, revoked access after reservation, robots denial and pacing, a three-request cap, a one-hop stop under a four-request cap, timeout, redirect, unrelated example details, and a separate development markup variation.

## Reproduce

Windows PowerShell from the worktree root. The verification used the existing `collection-backend:m21c-f0ba4a3` image for dependencies and mounted the M22B backend read-only. Docker's automatic address pool was exhausted on this host, so the override uses explicit subnets. If needed, choose unused subnets through `M22B_API_SUBNET` and `M22B_FIXTURE_SUBNET`.

```powershell
$env:M22B_BACKEND_IMAGE = 'collection-backend:m21c-f0ba4a3'
$env:POSTGRES_USER = 'm22b'
$env:POSTGRES_PASSWORD = 'm22b-integration'
$env:POSTGRES_DB = 'm22b'
$env:API_PORT = '58194'
$env:POSTGRES_PORT = '55594'
$stack = @('-p','m22b-verification','-f','compose.yaml','-f','compose.fixture.yaml',
  '-f','backend/experiments/m22b.compose.yaml')
docker compose @stack up -d --no-build --wait postgres redis collection-fixture
docker compose @stack run --rm --no-deps api alembic upgrade head
docker compose @stack up -d --no-build --wait api

docker run --rm --mount "type=bind,source=$($PWD.Path),target=/mnt/m22b,readonly" -w /mnt/m22b `
  -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/mnt/m22b --entrypoint python $env:M22B_BACKEND_IMAGE `
  -m pytest -q -p no:cacheprovider backend/tests/test_m0_http.py backend/tests/test_m0_extraction.py `
  backend/tests/m1 backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py
docker compose @stack run --rm --no-deps `
  -e M2_TEST_DATABASE_URL=postgresql+psycopg://m22b:m22b-integration@postgres:5432/m22b `
  -e M3_TEST_BROKER_URL=redis://redis:6379/2 api python -m pytest -q -p no:cacheprovider `
  backend/tests/m2/test_profiles_api.py backend/tests/m2/test_profiles_storage.py backend/tests/m2/test_m7_results.py

Push-Location frontend
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:M4_FRONTEND_PORT = '5190'
npm run build
npx playwright test profile-suggestion.spec.ts profiles.spec.ts --workers=2 --reporter=line
$env:M4_REAL_API = '1'
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58194'
$env:M4_FRONTEND_PORT = '5189'
npx playwright test profile-suggestion.integration.ts --workers=1 --reporter=line
Pop-Location
docker compose @stack logs --no-log-prefix collection-fixture
docker compose @stack down
```

- Core and fixture replay passed **235 tests**, including the offline quality checks. The existing PostgreSQL Profile and Redis/Worker regression selection passed **9 tests**.
- Mock Dashboard passed **23 tests** including keyboard controls, dark mobile axe, preserving unsaved work, stale-response handling and the existing editor. TypeScript and Vite production build passed. The lockfile matched the local M21C dependency install used after the offline npm cache missed Vite. Ruff passed with `EXE002` excluded because the Windows Docker bind mount reports all files as executable.
- Real Dashboard passed **2 tests**, run separately with the assisted selection and `--grep 'real manual'`. Browser automation verified functionality. Human timing and a comparative time-saving estimate remain unmeasured.

## Request attribution addendum to M22A

For a trial, record the non-overlapping action windows for browser mirror navigation, backend discovery, explicit Preview and Validate. Use a fresh or isolated fixture log and retain the route and keyword query as permitted by the fixture. The mirror and internal host identify the same controlled fixture only when the configured origin pair names that fixture and the exact route and query match the approved task. Treat all other origins independently. The matching rule is for evaluation, outside the application's access policy.

Reconcile the discovery ledger's transport attempts with fixture logs in action order. The reference fixture logs caller identity, target and status. The Compose probe identifies itself with `M22B-Compose-Health/1.0` from the fixture container's loopback. Core identifies itself separately. Count Core robots requests in their action window. Browser traffic is identified separately, including browser-only requests when they occur. Distinguish Core discovery from Preview and Validate by the explicit API action, expected route sequence and exclusive window, since all three share the Core caller identity. Keep reserved but unsent entries in the ledger and count only confirmed server receipts as fixture requests. A transport failure can be recorded with no fixture receipt. Record ambiguous traffic or missing logs as **unmeasured**.

The controlled run reconciled 14 discovery GETs, 9 separate assisted sample-check GETs and 3 manual Validate GETs. Compose robots probes were independently attributed by caller. Browser mirror navigation was unmeasured in this Dashboard run.

## Review closure · 2026-11-21

The fetched `feature/M22B-source-discovery` tip, starting checkout and reviewed revision all matched `ddeca9e4004ed38a2b79147c41547b930a78c199`.

| Finding | Reviewed behavior | Closure behavior |
| --- | --- | --- |
| Count inference | The Catalog title-adjacency heuristic returned `usable` with count `2026` when `itemprop`, `aria-label` or both identified a copyright year. | All three variants return `partial` with the title resolved, no count mapping or sample, and a reason to choose a count selector manually. An explicitly labelled count of `2026` still maps. |
| Example URL meaning | Both `&section=` and the empty duplicate `&term=` were discarded. Each replay fetched robots, canonical results and detail and returned `usable`. | Both return `unsupported_examples` with the single-parameter guidance and zero transport attempts, including robots. The reference `C++ & tea` works with spaces encoded as `+` or `%20`. |

The backend closure rerun used the `collection-backend:m21c-f0ba4a3` image with the worktree mounted read-only at `/mnt/m22b`, `PYTHONPATH=/mnt/m22b`, `PYTHONDONTWRITEBYTECODE=1` and Docker `--network none`. These are the container commands, followed by the whitespace check from the worktree.

```text
python -m pytest -q -p no:cacheprovider backend/experiments/test_m22b_suggestions.py -k "title_adjacent_metadata or labelled_count or empty_extra_parameter or examples_on_restricted_source"
python -m pytest -q -rs -p no:cacheprovider backend/tests/test_m0_http.py backend/tests/test_m0_extraction.py backend/tests/m1 backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py
ruff check --no-cache --extend-ignore EXE002 backend/core/suggestion_markup.py backend/experiments/test_m22b_suggestions.py
git diff --check
```

- The focused selection produced **5 failed, 4 passed, 19 deselected** before the fixes and **9 passed, 19 deselected** afterward. The full M0/M1 and M22A/M22B selection passed **243 tests** with **0 skips**. Ruff and `git diff --check` passed. Ruff excluded `EXE002` for the Windows bind mount.
- Unedited generated selectors recovered **2/2 detail links** and **4/4 typed field values** and excluded the decoy on each reference layout. The Cards direct path used **4** actual requests, the Catalog one-hop path used **5**, and Catalog examples used **3** for either equivalent encoding.
- The closure changed only Core suggestion inference and example-query validation. The Windows Dashboard and PostgreSQL/Redis integration results above are earlier evidence. Those integrations were not rerun for this revision.

**Ready for the controlled M22C pilot.** Both review findings and the offline reference quality checks passed. The four reserved tasks, scoring keys and trial CSV were left untouched. Independent review is pending. Human timing and percentage savings remain unmeasured.

## Count eligibility correction · 2026-11-21

The fetched branch tip and starting checkout matched the reviewed revision `a1371acbadc5c386c374c3730e2f57a1a670b392`. With only the representative Catalog detail overridden, the reviewed code returned `usable` and mapped `./dl/dd` to `2026` because `class="count"` nominated the copyright year. The corrected code returns `partial` with `Alpha outlook` resolved, no count mapping or sample, and guidance to choose a count selector in the editor.

- Core checks `itemprop` and `aria-label` on the element selected by each integer count candidate. Any explicit label for a different field rules out that candidate. An independently selectable count remains eligible under the same uniqueness and type checks. The generated selectors recovered the genuine count `2026` through typed Core ingestion, including with a conflicting element present.
- The focused replay selection covering count metadata, labelled counts, both reference layouts and example URLs produced **7 failed, 11 passed, 17 deselected** on the reviewed code and **18 passed, 17 deselected** after correction. The M0/M1 and M22A/M22B command above with `-rs` passed **250 tests with 0 skips** in the same offline backend image. Ruff on both changed Python files and `git diff --check` passed.
- Cards and Catalog each recovered **2/2 expected links** and **4/4 typed field values** and excluded the decoy. The direct, one-hop and examples replays made **4, 5 and 3** transport attempts respectively. Both equivalent space encodings passed. The blank companion and empty duplicate query parameters each caused **0** transport attempts.

These checks were rerun for this correction. The Windows Dashboard and PostgreSQL/Redis results above are earlier integration evidence. Independent review is pending, and human timing remains unmeasured.
