# PR26 Stage A handoff

## A. Scope and disposition

> Stage A foundation is complete. The existing application still uses its legacy interpretation path; production behaviour changes are deferred until Stage B provides versioned persistence and backward-compatible integration.

Stage A adds an internal, deterministic resolver for research criteria and tests its input validation, provenance, interpretation and review states. Section J records the first correction. Section K records the second correction and current review disposition. Production API and research execution, database storage, UI confirmation, source reporting and MCP integration are outside Stage A. Stage B has not started.

## B. Implementation snapshot

| Item | Value |
| --- | --- |
| Repository | [coffee030/adaptive-web-data-collection-platform](https://github.com/coffee030/adaptive-web-data-collection-platform) |
| Checkout | `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch | `codex/pr26-research-clarity` |
| Starting HEAD for Stage A and both correction passes | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Final HEAD | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Commit status | Local branch with four untracked, uncommitted Stage A files. The original Stage A checkout began clean. Both corrections began with all four Stage A files in place. |

The original workspace contained an older M10 checkout without the Harbourline research modules. The upstream Harbourline branch and PR #19 head both resolved to the reviewed SHA. The upstream search found no existing PR26 branch. The dedicated checkout preserved the older checkout and excluded the unrelated Core drafts.

The diff adds two source modules and one test module (2,271 lines) plus this handoff. The tracked diff against HEAD is empty. At the second correction's start, all four working files matched the bytes in the first corrected ZIP. Its source and test hashes matched the reviewed first-correction manifest. The contracts file remains byte-for-byte identical across both corrections. The hashes below identify the untracked implementation.

| Source or test file | Added lines from HEAD | Original reviewed SHA-256 | First-correction SHA-256 and second-correction start | Current SHA-256 |
| --- | ---: | --- | --- | --- |
| `backend/intelligence/research_criteria.py` | 999 | `30ec94ff9868a6834ab365d4499d58c6a90e36807aaa9520dfd2d98175c60674` | `8365c12edbafeb767b4af8d8861779953ec77e62e16528f554f518d24a5a3425` | `f265220df11cf34028626de2c8f0b1027c8e3bdb70315002e4020fca059a1335` |
| `backend/intelligence/research_criteria_contracts.py` | 146 | `9376035c3165e17b53978661de6a56411d33bf7903d688b086733d524de9df80` | `9376035c3165e17b53978661de6a56411d33bf7903d688b086733d524de9df80` | `9376035c3165e17b53978661de6a56411d33bf7903d688b086733d524de9df80` |
| `backend/tests/test_research_criteria.py` | 1,126 | `bb07001fde1406862b2fda5a428bee1ffe2e385c3cfd2f4256c027f7a681fcdc` | `991750040719f13d64eff5c7748db5d0535fe1c7f93a347e3fdeb2a2a2b3c121` | `f49bea570ea3caed5c4983316497df11be5f60ba3d112011d2cb784ebe80906b` |

The current source and test diff fingerprint is `828310ffb39445dbb1851d9850517e89058df2679e6ecaf4b0b0185f43c72504`. The first correction's diff fingerprint was `cbf3f345d17939cd466de1d4ba60f054d5d54c3d2bc982f18e607ad2532a17c2`. Compute SHA-256 on the concatenated raw standard output from the following command run for each path in table order. Git returns 1 for each of these new-file diffs. The manifest excludes the handoff file.

```powershell
git -c core.autocrlf=false diff --no-index --binary --no-color --no-ext-diff -- /dev/null <path>
```

## C. Legacy reproduction and isolated comparison

The probe placed each exact expression in `campaign.description`, omitted the structured age field, and called `evidence_intent(brief, "")`. The product was `Neighbourhood café lunch`, the audience was `Hong Kong weekday diners`, and the campaign specified `awareness`, `120000` minor units of `HKD`, `instagram` and `social_post`. The new path received the expression as `ResearchCriteriaInput.research_text`.

| Input | Legacy before and after | New resolver | Observation |
| --- | --- | --- | --- |
| `past 30 days` | 30 days | `ready`, 30 days | English control behaved as expected |
| `最近30日` | 90 days | `ready`, 30 days | Legacy generic fallback reproduced |
| `過去30日` | `None` | `ready`, 30 days | Legacy missing age reproduced |
| `past 2 months` | 60 days | `needs_review`, unresolved, `unsupported_age` | Legacy month conversion reproduced |

The new results are from an isolated resolver call. Production continues to produce the legacy results for these inputs.

## D. Resolver interface

Import `resolve_research_criteria(source: ResearchCriteriaInput) -> ResearchCriteriaResolution` from `backend.intelligence.research_criteria`. Import the models from `backend.intelligence.research_criteria_contracts`. Construct a validated `ResearchCriteriaInput` directly or with `model_validate`.

The input supports `research_text` and optional `product`, `discovery_focus` and `audience`. The first three are scanned independently. The audience text is retained for context. The structured fields cover platform and alternatives, deliverable, age, language and its mandatory flag, market and minimum audience share, budget and currency, creator counts and required and preferred fact references. An optional `provenance` mapping tags each supplied structured field as `explicit`, `application_default` or `legacy`. An untagged non-null value is legacy. A null age is absent unless the caller supplied it with explicit provenance to select unrestricted publication age. An explicit tag records how a value entered the resolver.

The output contains version `research-criteria-v1`, a retained copy of the original typed input, `criteria`, field states and provenance in `fields`, ordered `issues`, `defaults` and `assumptions`. References identify a structured field or give the original input field and matched substring. The result serializes with `model_dump(mode="json")` or `model_dump_json()`. Audience share is a Decimal in the typed criteria and a decimal string in JSON and audit candidates.

| Status | Meaning |
| --- | --- |
| `ready` | Unambiguous within the supported scope. It gives no approval, campaign eligibility or evidence sufficiency decision. |
| `needs_review` | The caller should resolve a conflict, unsupported or vague wording, or missing context. Unresolved fields have no effective value and competing candidates are kept in issues. |
| `invalid` | A semantic rule failed, such as the normalized age range, a missing currency for a supplied budget, or incompatible creator counts. Pydantic also rejects malformed input types, unsupported enum values and impossible provenance before resolution. |

Each field has a state of `resolved`, `absent`, `unresolved` or `invalid`. Resolved field origins are explicit, default, legacy or text-derived as applicable. A resolved age of `null` represents deliberate unrestricted scope. An absent age is also `null`, with state and origin `absent`. Use the field state to distinguish these and unresolved cases. Issue records provide code, field, severity, explanation, action, references and candidates. A notice records displacement of a known default without requiring review by itself.

### Supported text grammar

| Criterion | Accepted signals and review cases |
| --- | --- |
| Publication age | Case-insensitive `past`, `last` or `previous` followed by an ASCII integer and `day(s)` or `week(s)`. Chinese `最近`, `過去` or `近` may touch the integer and unit, or use whitespace. Day units are `日` and `天`. Week units are `星期`, `禮拜`, `週` and `周`, optionally with `個`. An ASCII sign or Unicode minus is recognized for validation. Weeks multiply by seven and the normalized range is 1–3650 days. Simple unrestricted wording includes `no date restriction`, `no publication-age restriction` and `不限發布日期`. |
| Publication window review | Bare `recent`, `current`, `latest`, `newly`, `近期`, `最近` and `最新` are vague. An explicit numeric structured window can settle them. Detectable unsupported windows, including `上個月`, named relative weekdays, months, calendar dates and ranges, spelled-out numbers, Chinese numerals and fractions, require review. Local exclusions such as `not published in`, `outside`, `以外` and negated unrestricted wording also require review. The scanner gives a specific numeric match priority over its own recency prefix. |
| Platforms | Recognizes YouTube, Instagram or IG, Facebook or FB, TikTok and `抖音`. Latin aliases are case-insensitive, use Latin word boundaries and can adjoin Chinese text. The existing `other` value is available as structured input. One affirmative platform forms a single-platform request. Supported comparisons use `compare`, `comparison`, `vs`, `versus`, `比較` or `對比` with clear joins. `or`, `或者`, and patterns such as `YouTube as the main platform, with Instagram as an alternative` express alternatives. Standalone `only` next to an alias and Chinese forms such as `只限` make a single-platform request exclusive. |
| Platform exclusions | Finite direct negation prefixes include `not`, `not on`, `no`, `exclude`, `avoid`, `except`, `without`, `不要`, `排除`, `不用`, `不選`, `不是`, `不包括`, `不做`, `避免` and `除外`. The resolver keeps clear exclusions separate from targets. It checks exception suffixes such as `以外的平台` before accepting a direct exclusion. Compound, postposed or ambiguous negation requires review. The effective main and alternative fields stay unresolved when their joint scope conflicts. |
| Deliverable | Recognizes short video, short-form video, YouTube Shorts, Instagram Reels, dedicated or dedicated sponsorship video, video integration, social or social media post, and Chinese phrases such as `短片`, `短視頻`, `短影音`, `專題贊助影片`, `影片置入` and `社交媒體貼文`. Scoped negative wording such as `不用短片` requires review. Generic video wording alone requires review unless an explicit structured video deliverable supplies the specificity. |
| Language | Recognizes Cantonese, `廣東話`, `粵語`, English, `英文`, `英語`, Traditional Chinese and `繁體中文`. Adjacent wording such as `must speak`, `required`, `mandatory`, standalone `only` and `必須` can make it mandatory. `prefer`, `preferred`, `ideally`, `優先` and `偏好` express preference. Bare language names need an explicit strength or review. Conditional or qualified wording such as `only if available` and `不一定要講` leaves the strength open. A negated strength trigger such as `do not require` or `do not prefer` keeps the named language with its strength unresolved. Unsupported language labels such as Mandarin require review. All existing language enums remain available as structured input. |

For platforms, deliverables and language, recognized negative cues retain their effect through unfamiliar intervening words within the local instruction. A supported direct platform exclusion can still be resolved. Unclear platform or deliverable negation requires review. Punctuation and recognized instruction transitions limit how far a cue applies. A coordinated transition can start a separate instruction when a different criterion intervenes. Affirmative unrestricted-age wording such as `no date restriction` can coexist with an affirmative platform.

Clear text can displace a known default. A materially different explicit or legacy value requires review together with the text-derived value. A structured value that agrees remains explicit when explicitly tagged, with both references recorded. A legacy value alone retains legacy provenance. An explicit alternative can accompany a single affirmative text mention unless the text excludes it or makes the platform exclusive. The resolver reconciles declared roles and scopes across all three scanned fields. An explicitly declared primary keeps its role in a compatible comparison. With no declared primary, a compatible recorded main can occupy that slot in an unranked list. Otherwise the first platform named occupies that slot and the result records the ordering assumption.

The resolver normalizes durations without reading a clock or computing a cutoff. Calendar arithmetic, free-form language analysis, extraction of business assumptions and evaluation of creators or evidence are deferred. Budget, market share, creator counts and facts remain structured inputs. Finite detection covers the documented patterns. Other phrasing outside those patterns can require a structured criterion or reviewer attention.

## E. Change inventory

| File | Purpose within Stage A |
| --- | --- |
| `backend/intelligence/research_criteria.py` | Resolves supported text and structured input in process, with explicit outcomes, conflicts, exclusions and review actions. |
| `backend/intelligence/research_criteria_contracts.py` | Defines typed, versioned input and output contracts using the existing campaign domain values and validation types. |
| `backend/tests/test_research_criteria.py` | Exercises observable resolution, serialization, side-effect isolation and operational brief compatibility. |
| `docs/handoffs/PR26A-Handoff.md` | Records the snapshot, verification and Stage B review boundary. |

## F. Original Stage A verification

These commands verified the original Stage A snapshot. The correction verification in section J uses Python 3.12. The original commands ran from the Stage A checkout in section B on Windows Python 3.13.7 from the sibling checkout's virtual environment, with pytest 9.2.0, Pydantic 2.14.3, Ruff 0.17.5, SQLAlchemy 2.0.57 and psycopg 3.3.9. `pip check` reported `No broken requirements found.`

```powershell
$py = '..\Adaptive-Web-Data-Collection-Platform\.venv\Scripts\python.exe'
& $py -m pip check
& $py -m pytest -p scripts.require_pytest_pass -q -ra backend/tests/test_research_matching.py backend/tests/m2/test_company_research.py::test_focus_selects_eligible_refreshes_and_explicit_scenario
& $py -m ruff format --config ruff.toml backend/intelligence/research_criteria.py backend/intelligence/research_criteria_contracts.py backend/tests/test_research_criteria.py
& $py -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/test_research_criteria.py backend/tests/test_research_matching.py
& $py -m ruff check --config ruff.toml backend mcp_access scripts
& $py -m ruff format --config ruff.toml --check backend mcp_access scripts
```

| Check | Observed result |
| --- | --- |
| Existing matching tests and database-free research focus/scenario check before editing | `3 passed in 0.54s` |
| Final focused resolver and unchanged matching tests | `116 passed in 1.66s` |
| Ruff lint and formatting on repository Python paths | `All checks passed!` and `203 files already formatted` |
| Scope and whitespace | `git status --porcelain=v1 --untracked-files=all` listed just the new deliverables. The tracked diff was empty. Per-file `git -c core.autocrlf=false diff --no-index --check -- /dev/null <path>` produced no whitespace errors. |

The first focused run failed the mixed-case and whitespace case `Find creators in the LAST<TAB>30  DAYS.` because the unsupported-window scanner captured its leading context. The resolver now lets the supported phrase match inside that context. The original test and a new `Within the last 30 days` regression passed in the final run.

The baseline and final probes used the following fixture and invocation. The initial probe imported only `BusinessBrief` and `evidence_intent` and printed the same legacy readings and first serialization.

```powershell
$env:PYTHONIOENCODING = 'utf-8'
@'
import json
from backend.intelligence.research_contracts import BusinessBrief
from backend.intelligence.research_criteria import resolve_research_criteria
from backend.intelligence.research_criteria_contracts import ResearchCriteriaInput
from backend.intelligence.research_match import evidence_intent

for description in ["past 30 days", "最近30日", "過去30日", "past 2 months"]:
    brief = BusinessBrief.model_validate({
        "campaign": {"description": description, "objective": "awareness", "budget_minor": 120000,
                     "currency": "HKD", "platform": "instagram", "deliverable": "social_post"},
        "product": "Neighbourhood café lunch", "audience": "Hong Kong weekday diners",
    })
    resolved = resolve_research_criteria(ResearchCriteriaInput(research_text=description))
    print(description, evidence_intent(brief, "")["days"], resolved.status,
          resolved.criteria.max_evidence_age_days, [issue.code for issue in resolved.issues])
    if description == "past 30 days":
        print(json.dumps(brief.model_dump(mode="json"), ensure_ascii=False, sort_keys=True))
'@ | & $py -X utf8 -
```

### PostgreSQL replay and report checks

PostgreSQL 17.7 came from the local `..\Adaptive-Web-Data-Collection-Platform-PreFreshM10-Backup\var\m2-postgres\pgsql\bin` tool directory. Each attempt initialized a new disposable cluster beneath the Stage A checkout's ignored `.local` directory. The database was bound to loopback with an ephemeral fixture password. The existing fixtures applied the migrations in disposable schemas. In the commands below, `$pgData`, `$pgLog` and `$pwFile` refer to the per-run fixture paths, and `$fixturePassword` is the per-run value.

```powershell
& (Join-Path $pgTools 'initdb.exe') -D $pgData -U collection --auth=scram-sha-256 --pwfile=$pwFile --encoding=UTF8 --locale=C
& (Join-Path $pgTools 'pg_ctl.exe') -D $pgData -l $pgLog -o "-h 127.0.0.1 -p 55426" -w start
$env:M2_TEST_DATABASE_URL = "postgresql+psycopg://collection:$fixturePassword@127.0.0.1:55426/postgres"
& $py -m pytest -p scripts.require_pytest_pass -q -ra --tb=line backend/tests/m2/test_company_research.py::test_durable_research_and_company_scope backend/tests/m2/test_company_research.py::test_only_company_campaigns_can_be_linked backend/tests/m2/test_company_research.py::test_focus_selects_eligible_refreshes_and_explicit_scenario
& (Join-Path $pgTools 'pg_ctl.exe') -D $pgData -m fast -w stop
```

The initial sandboxed test process received Windows socket error 10013 on loopback. That attempt observed one pass and two setup errors. The approved localhost run and the final rerun each reported `3 passed in 1.60s` and stopped the fixture server. The database-backed cases exercised same-key replay, changed-brief rejection, company ownership, campaign links, report recomputation and deliberate revision mismatch rejection. The scope was the three selected tests. No deployed browser or live source was exercised.

### Acceptance matrix

| Cases | Final observation |
| --- | --- |
| 1–3. Equivalent durations, case and whitespace, week normalization | Required English and Chinese inputs yielded 30 or 14 days, including tabs, doubled spaces and ideographic spaces. |
| 4–6. Absent, vague and unsupported windows | Absence and deliberate unrestricted scope were distinguishable. Vague terms, calendar expressions, months and unsupported numeral forms produced review issues. |
| 7. Invalid durations | Text and structured zero, negative and out-of-range values were invalid. The week boundary was checked after conversion. |
| 8–10. Conflicts, vague wording with explicit age and explicit unrestricted scope | Different specific values and explicit unrestricted versus numeric text left the field unresolved. An explicit numeric limit settled vague wording. |
| 11–14. Platform conflicts, comparison, provenance and negation | Instagram versus YouTube preserved both candidates. Compatible comparisons passed. Defaults were recorded, unknown values stayed legacy, and English and Chinese exclusions stayed outside the affirmative scope. |
| 15–16. Deliverable and language precision | Clear formats resolved, generic video and ambiguous language remained reviewable, and mandatory and preferred wording stayed distinct. |
| 17–19. Repeatability, immutability, side effects and serialization | Repeated JSON was identical. Input mappings and models were intact. The test guarded socket, database and task dispatch calls. Unresolved results and structured default amounts survived serialization round trips. |
| 20. Legacy compatibility | Exact serialized brief fixtures and legacy parser results matched the baseline. The existing matching tests and selected replay, report and ownership tests passed unchanged. |

## G. Compatibility checks

```powershell
git status --porcelain=v1 --untracked-files=all
git diff HEAD --exit-code -- backend/intelligence/research_contracts.py backend/intelligence/contracts.py backend/intelligence/research_match.py backend/intelligence/research_analysis.py backend/intelligence/research_runs.py backend/intelligence/research_models.py backend/intelligence/research_api.py backend/tests/test_research_matching.py backend/tests/m2/test_company_research.py frontend mcp_access
git grep -n 'evidence_intent' HEAD -- backend/intelligence
rg -n 'research_criteria|resolve_research_criteria' backend/intelligence backend/tests frontend mcp_access
```

- The before and after probe printed the same JSON for the legacy brief. The fixture asserts every top-level and campaign field. Notable defaults include `test_share: 60`, empty `alternative_platforms`, `discovery_scope: "campaign_channels"`, `max_evidence_age_days: null`, `require_language: false`, empty reviewed-fact lists, creator bounds of 1 and 4, and nullable optional fields. The test also verifies that inserting a top-level `provenance` field still fails validation.
- `git diff HEAD --exit-code` over the existing contracts, matcher, analysis, run storage, submission route, legacy test files, frontend and MCP tree exited zero. The scoped reference search found the new resolver in its own modules and the new test module. Existing `evidence_intent` call sites in `research_analysis.py` cover public examples and the reviewed catalog. The submission route still calls `start()`, which compares stored and submitted legacy briefs. `results()` still calls `analyze()` and compares the recomputed revision.
- The form at the baseline can submit Instagram and `social_post` through initial defaults. Its selection values alone cannot establish user provenance. The MCP submission contract still serializes `BusinessBrief`.
- The tracked tree is identical to the baseline. Existing source, company and evidence guards are intact. The unchanged matcher cases exercised source and publication evidence classification. The PostgreSQL checks exercised company ownership and revision enforcement. Stage A added no migrations, stored metadata, routes, UI, source connectors, runtime flags or MCP behavior.

## H. Stage B handoff

Persist explicitly confirmed criteria and their interpretation version, with a fallback that preserves the semantics of historical runs. Keep missing provenance distinguishable from a deliberate user selection. Integrate a side-effect-free preview and submission validation using the shared backend resolver for UI, API and MCP consumers.

Preserve same-request-key replay across retries, including legacy requests. Keep historical reports on their original interpretation path and preserve digest semantics when adding presentation fields. Plan integration coverage for confirmation, replay, historical digest compatibility and unchanged authorization before connecting callers.

## I. Remaining issues and review status

Calendar calculations, generalized negation and multilingual parsing beyond the documented patterns remain outside the foundation. Stage A validates criteria and records provenance. Evidence sufficiency and eligibility still belong to existing research and campaign logic.

The next reviewer should inspect the finite phrase boundaries, the unranked platform slot assumption and the treatment of conflicting legacy values. The reviewer should also decide how each future caller captures reliable attribution before setting `explicit` or `application_default`. There is no outstanding blocker for the isolated foundation. The production publication-window defect remains until the versioned Stage B integration is reviewed and authorized.

## J. First Stage A correction review

The correction started with the reviewed files and reproduced all 12 failures before editing. The twelve exact cases were also probed against both snapshots on Windows CPython 3.12.16. Each reviewed case had previously returned `ready` with no issue. The revised outputs below all returned `needs_review`.

| Finding | Exact input | Observed before | Observed after |
| --- | --- | --- | --- |
| A1. Contradictory primary roles | `research_text` = `YouTube as the main platform, with Instagram as an alternative`<br>`discovery_focus` = `Instagram as the main platform, with YouTube as an alternative` | YouTube main, Instagram alternative, `alternatives` | `conflicting_criteria`. Both role declarations remain candidates. Main, alternatives and intent are unresolved. |
| A2. Exclusive versus comparison | `research_text` = `Only YouTube`<br>`discovery_focus` = `Compare YouTube and Instagram` | YouTube main, Instagram alternative, `comparison` | `conflicting_criteria`. Both scopes remain candidates. Main, alternatives and intent are unresolved. |
| B. Chinese platform exception | `不要 IG 以外的平台` | Instagram excluded | `ambiguous_platforms`. The full exception phrase is retained. No platform or exclusion is asserted. |
| C1. Negated deliverable | `不用短片` | `short_video` | `ambiguous_deliverable`. Deliverable unresolved, with the negative phrase attached. |
| C2. Negated deliverable | `不做短片` | `short_video` | `ambiguous_deliverable`. Deliverable unresolved, with the negative phrase attached. |
| D1. Qualified language | `不一定要講粵語` | `yue`, mandatory | `ambiguous_language` on `require_language`. Cantonese remains identified and strength is unresolved. |
| D2. Conditional language | `Cantonese only if available` | `yue`, mandatory | `ambiguous_language` on `require_language`. Cantonese remains identified and strength is unresolved. |
| E1. Negated window | `Find posts not published in the last 30 days` | 30 days | `unsupported_age`, age unresolved, with `not published in the last 30 days` as evidence. |
| E2. Outside a window | `Find posts outside the last 30 days` | 30 days | `unsupported_age`, age unresolved, with `outside the last 30 days` as evidence. |
| E3. Chinese exclusion suffix | `找最近30日以外的貼文` | 30 days | `unsupported_age`, age unresolved, with `最近30日以外` as evidence. |
| E4. Negated requirement to limit | `不需要限制在最近30日` | 30 days | `unsupported_age`, age unresolved, with `不需要限制在最近30日` as evidence. |
| E5. Negated unrestricted wording | `不要不限發布日期` | Resolved text-derived unrestricted age | `unsupported_age`, age unresolved, with `不要不限發布日期` as evidence. |

For finding A, the resolver collects supported relationship and exclusive phrases before settling a platform result. It compares the named sets and primary roles across the scanned fields. Tests swap the contradictory contents, exercise `product`, and verify that a compatible comparison retains its metadata and honors a declared primary. For B, compound exception context takes precedence over the direct negative prefix. Direct English and Chinese exclusions remain covered.

For C–E, local checks evaluate the preceding and following phrase before accepting a positive phrase, a language strength, or an unrestricted age. Review issues preserve the relevant context. Explicit structured deliverables, strengths and ages remain visible as candidates when they are supplied in these cases. Positive controls verify affirmative deliverables, age windows, unrestricted age and language strength. Mixed-criteria tests check that a negated window leaves the platform and deliverable intact and an excluded platform leaves the age and deliverable intact.

The correction changed `backend/intelligence/research_criteria.py` for the reconciliation and context checks, and added 38 cases to `backend/tests/test_research_criteria.py` without modifying existing assertions. This handoff records the correction. The archive includes the unchanged contracts file.

### Correction verification

Run from the checkout in section B. The isolated Windows environment used CPython 3.12.16, Pydantic 2.14.3, pytest 9.2.0 and Ruff 0.17.5. The test environment installed `backend/requirements.txt`, including its runtime requirements and declared transitive dependencies, without changing repository pins. The initial `uv pip sync` installed the listed pins only, so its dependency check reported missing transitives. Installing with `uv pip install --python $py -r backend/requirements.txt` resolved that setup issue, and `uv pip check --python $py` confirmed all 61 installed packages were compatible.

```powershell
$py = '.\.local\pr26a-correction\venv\Scripts\python.exe'
& $py --version
& $py -m ruff format --config ruff.toml backend/intelligence/research_criteria.py backend/tests/test_research_criteria.py
& $py -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/test_research_criteria.py backend/tests/test_research_matching.py
& $py -m ruff check --config ruff.toml backend mcp_access scripts
& $py -m ruff format --config ruff.toml --check backend mcp_access scripts
git diff --exit-code HEAD
```

| Check | Observed result |
| --- | --- |
| Reviewed snapshot loaded from the preserved copies, with unchanged legacy matching tests | `116 passed in 8.04s` on Python 3.12.16 |
| Exact counterexample probe on the reviewed and corrected resolvers | 12 reproduced before. All 12 produced the field-specific review outcomes above after correction. |
| Corrected resolver and unchanged legacy matching tests | `154 passed in 3.13s` on Python 3.12.16 |
| Repository Ruff lint and format check | `All checks passed!` and `203 files already formatted` |
| Production boundary | Tracked diff against HEAD stayed empty. The scoped source search still found no operational resolver reference. Matching and complete serialized brief fixtures passed unchanged. |

The correction introduced no persistence, storage or submission changes. The earlier database replay and report verification remains recorded in section F. The correction reran the required focused and legacy matching tests. There are no remaining failures in those checks.

The first corrected snapshot was exported as `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\PR26A_Review\PR26A_Corrected_Review_Package.zip`. Its four repository-relative entries are the then-current resolver, contracts, maintained tests and handoff. The second correction preserved this archive intact.

The grammar remains finite. The Chinese exception is reviewable. Conditional language, negative deliverables and outside-window requests have no settled criterion until clarified. Reviewers should inspect phrase boundaries and compatible multi-field platform declarations before approving Stage A. Production still uses legacy interpretation. Stage B has not started.

Independent review of that snapshot reported 154 maintained tests, 16 external review cases and both Ruff checks passing. It also identified the negation regressions reproduced below.

## K. Second Stage A correction review

The starting checkout, branch and HEAD are recorded in section B. Before editing, a direct resolver probe on Windows CPython 3.12.16 reproduced five incorrect affirmative results and three incorrect agreements with explicit structured values. Each starting result was `ready` with no issue.

| Exact text | Observed before | Observed after |
| --- | --- | --- |
| `Do not include Instagram` | `instagram`, `single` | `needs_review` with `ambiguous_platforms`. Platform, alternatives, relationship and exclusion are unresolved. |
| `Don't include Instagram` | `instagram`, `single` | `needs_review` with `ambiguous_platforms`. The contraction and full reference are preserved. No platform or exclusion is asserted. |
| `Do not create short videos` | `short_video` | `needs_review` with `ambiguous_deliverable`. Deliverable is unresolved. |
| `Do not require Cantonese` | `yue`, `require_language=True` | `needs_review` with `ambiguous_language` on `require_language`. Text-derived `yue` remains, with strength unresolved. |
| `Not mandatory Cantonese` | `yue`, `require_language=True` | `needs_review` with `ambiguous_language` on `require_language`. Text-derived `yue` remains, with strength unresolved. |

| Text with explicit structured values | Observed before | Observed after |
| --- | --- | --- |
| `Do not include Instagram` with `platform="instagram"` | Accepted Instagram as the main platform | Platform is unresolved. The issue keeps `instagram` with explicit provenance and the negative text reference. |
| `Do not create short videos` with `deliverable="short_video"` | Accepted `short_video` | Deliverable is unresolved. The issue keeps `short_video` with explicit provenance and the negative text reference. |
| `Do not require Cantonese` with `language="yue"` and `require_language=True` | Accepted mandatory Cantonese | Cantonese retains explicit provenance. Strength is unresolved, and the issue keeps the explicit `True` candidate and negative text reference. |

The platform and deliverable guards now share a local negation rule with language. A recognized cue stays in effect through unfamiliar intervening words. The guard stops at punctuation and recognized instruction transitions, with a completed different criterion required for an ambiguous conjunction. This preserves the earlier date-window and platform-exclusion controls and also allows an affirmative Instagram target to coexist with a review issue for negated Instagram Reels. The language resolver checks the cue against a recognized requirement or preference phrase before it writes any strength. Application defaults remain visible as candidates when the negative text is too uncertain to displace them confidently.

This pass changed `backend/intelligence/research_criteria.py`, added 28 test cases to `backend/tests/test_research_criteria.py` across 11 new test definitions, and updated this handoff. An AST comparison with the first corrected ZIP verified all 41 existing test definitions and their assertions remained intact. The contracts are unchanged and included for review.

### Second-correction verification

The following ran from the checkout in section B using its existing Python 3.12 environment and repository-declared dependencies. The installed versions were CPython 3.12.16, Pydantic 2.14.3, pytest 9.2.0 and Ruff 0.17.5. This pass made no dependency or configuration changes.

```powershell
$py = '.\.local\pr26a-correction\venv\Scripts\python.exe'
& $py --version
& $py -m ruff format --config ruff.toml backend/intelligence/research_criteria.py backend/tests/test_research_criteria.py
& $py -m pytest -p scripts.require_pytest_pass -q -ra --tb=short backend/tests/test_research_criteria.py backend/tests/test_research_matching.py
& $py -m ruff check --config ruff.toml backend mcp_access scripts
& $py -m ruff format --config ruff.toml --check backend mcp_access scripts
git diff --exit-code HEAD
git grep -n 'evidence_intent' HEAD -- backend/intelligence
rg -n 'research_criteria|resolve_research_criteria' backend/intelligence backend/tests frontend mcp_access
```

| Check | Observed result |
| --- | --- |
| Starting maintained suite and unchanged legacy matcher | `154 passed in 2.42s` |
| Direct probe of the exact text and structured inputs | Eight incorrect `ready` results before editing. Eight field-specific `needs_review` results after editing, with the full source phrases preserved. |
| Final maintained suite and unchanged legacy matcher | `182 passed in 1.90s` |
| Ruff lint and format check | `All checks passed!` and `203 files already formatted` |
| Earlier external suite | The separate 16-case external test file was unavailable and was not executed in this pass. The corresponding maintained first-correction coverage passed. |
| Production boundary | The tracked diff was empty. The only resolver references are in its own modules and maintained tests. The unchanged legacy matcher and complete serialized brief fixtures passed. |

Production execution and submission still use the legacy interpretation path. Operational brief defaults and serialization, persistence, migrations, API, UI, MCP and report digest and request-key replay behavior stayed outside the correction. The historical database checks in section F were not rerun for this isolated change.

The new archive is `C:\Users\noob\Downloads\ITE4116M_Final_Year_Project\PR26A_Review\PR26A_Corrected_Review_Package_R2.zip`. It contains the resolver, unchanged contracts, maintained tests and current handoff at repository-relative paths. Its entries were checked against the working files and the current source and test hashes in section B.

The grammar still uses finite cues and boundaries. Compound wording beyond those boundaries may require an explicit criterion or reviewer interpretation. Reviewers should check how unfamiliar words, coordinated clauses and competing structured values interact before approving Stage A. Stage B has not started.

**Final status** — Ready for independent Stage A review.
