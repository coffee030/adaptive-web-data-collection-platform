# M22C coordinator runbook

M22 closed on [technical acceptance](M22C-Operator-Pilot.md). This optional protocol supports a separately recorded human pilot. Check previous attempts before opening any card. Keep raw evidence and grading material in the coordinator workspace and show the operator only the active card.

## Resume the existing project

1. From the evaluation checkout, confirm `git status --short --branch` and `git rev-parse HEAD`. Use the same pilot project and evidence tree. Check the local CSV, `.local/m22c/sources.json`, `.local/m22c/technical-readiness.json`, the services and the existing database. For an existing assignment directory, preserve the raw records and check the operator, Source and both SHAs. Run `node backend/experiments/m22c_session.mjs resume <trial_id>` against the original API to audit an existing attempt. Audit any directory without a start record before proceeding.
2. Check the Dashboard at `http://127.0.0.1:5224`, API at `http://127.0.0.1:58196/api/v1/health` and mirror at `http://127.0.0.1:58197`. Check mirror connectivity using only `/robots.txt` outside trial windows. Verify the assigned Source policy and empty version list via the API. Use the retained rehearsal when the environment and observation channels match. Repair any failed channel before opening a card.
3. With the operator present, run `node backend/experiments/m22c_session.mjs trial M22A-01` at the checkout root in an interactive terminal. Register the operator alias, Dashboard familiarity, layout familiarity and relevant exposure. Use the same operator across assignments. Make sure the console and isolated Edge window are ready. The operator presses Enter to open the one card and start the monotonic clock. The human performs all timed browser and Dashboard actions. The coordinator presses Enter immediately on the operator's signal that the Dashboard confirms approval for the matching version, revision, hash and report. The timer stops at 900 seconds or on earlier abandonment. Include waits, errors, edits and retries. The frozen order keeps suggestions and prior solutions away from the manual tasks. Use A then Enter to capture abandonment before entering its reason. On an explicit fallback request, use F then Enter, record the reason while the clock runs, and supply the printed permitted pair.
4. Run `pwsh -NoProfile -File backend/experiments/m22c_archive.ps1 -Session <trial_id>` and retain the journal, stop record, screenshot, version snapshot and receipts. Review the terminal screenshot alongside the journal and persisted approval and validation references. Preserve the last saved draft when available. Save the audited status and original elapsed time in the CSV before opening the next card. Retain all incomplete and failed attempts. Keep the raw artifacts local and use stable, sanitized review references.

## Stop and resume

- Enter records the operator's Dashboard confirmation signal. A then Enter records abandonment before the follow-up prompt for its reason. The 900-second cap wins at the deadline. The runner durably journals the signal, reason, monotonic elapsed time and cutoff before saving the standalone stop file, taking the terminal screenshot or reading the API. If the standalone file is absent after an interruption, the durable journal still carries the cutoff.
- Use `completed` when Enter was within the permitted window and the browser observed the successful approval response by that cutoff. The assigned Source, Profile version ID, revision, configuration hash and passing validation report must match the persisted approved snapshot. The response event fixes observation time even when its body parsing finishes later. A later snapshot can corroborate the observed approval. The presence of an approved version in a later snapshot cannot establish when the approval response was observed.
- Use `failed` for a confirmed premature stop, timeout or abandonment. Preserve the elapsed time and reason, and use the separately recorded abandonment reason if provided. Use `incomplete` for missing, conflicting or interrupted evidence that prevents verification. Record the specific gap in the CSV. Leave unavailable measurements blank.
- `resume` recomputes the verdict from the existing journal and snapshot without opening the card, starting a browser or resetting the timer. It can fetch a missing snapshot for a current stop with intact evidence. Existing files and the original cutoff are retained. A legacy Enter-only `completed` stop is `incomplete` under this check. The next assignment requires the previous result in the CSV to agree with fresh adjudication, including any recorded `incomplete` attempt.

## Scoring and traffic review

- Run the offline scorer below with `trial .local/m22c/<trial_id> <assigned-prefix-with-trailing-slash> "<assigned keyword>"` in place of the `reference --session $session` arguments. For the final saved configuration and each captured raw proposal, the frozen replay supplies the assigned listing and expected details to Core link selection, extraction and typed ingestion. Use its two-link and four-typed-value scores for the frozen comparison. An unavailable artifact stays unscored.
- Read `configured_search` alongside the frozen selector scores. Core builds the entry URL from the recorded Source, actual search configuration and assigned keyword. Offline replay uses its encoded path and query under Source and robots policy. It reports the replay URL when available, fixture status and count of assigned results. An available page with zero assigned results is a measured zero. A missing, denied or unavailable target leaves the result count unmeasured. Keep this diagnostic out of the frozen score, live request ledger and unauthorized request count.
- Reconcile separate browser navigation, discovery, Preview and Validate windows using the journal and the fixture receipts. Keep overlapping or ambiguous windows unmeasured. Apply the mirror/internal equivalence only for the approved fixture pair and exact path/query, and treat other origins independently. Match browser request receipts to path, query, method and status. Reconcile the ordered Core receipts with each discovery ledger's transport-attempt stages. Record reserved-unsent entries and pre-send denials separately. For Preview and Validate, use the explicit action, revision, sample input and expected ordered requests. Review unexpected or failed actions individually. A confirmed request outside Source origins, paths or robots policy contributes to the unauthorized count. An outbound failure with no receipt needs separate evidence of its destination. Missing channels, ambiguous sends and unexplained receipts leave the count unmeasured. Report any confirmed violation separately if the total is unavailable.
- The internal loopback probe uses caller `compose_health`. Keep genuine `core` robots GETs in their action windows. Use the post-stop receipt tail only to attribute requests already in flight. Sum non-overlapping observed waits inside elapsed time. Count config-changing post-save edits by comparing successive hashes and count repeats of failed Preview, Validate or approval attempts. Use blank for missing measurements and zero for observed absence. Include fallback and abandonment reasons and times.
- Use the [frozen rules](M22A-Source-Onboarding-Feasibility.md#frozen-score-and-trial-logging) and [pilot report](M22C-Operator-Pilot.md) to report raw times, both pair percentages, median, counts, fallback, quality and gaps. Optional binding or Worker verification happens after timing with the exact approved version.

## Reference reproduction

Use PowerShell 7.5 or later with the pinned checkout and free loopback ports and Docker subnets. For fresh technical setup create the ignored `.local/m22c/pilot.env` with `POSTGRES_USER=m22c`, `POSTGRES_DB=m22c`, a disposable `POSTGRES_PASSWORD`, `API_PORT=58196`, `POSTGRES_PORT=55596` and `M22C_MIRROR_PORT=58197`. Reuse the established project and evidence during a resumed pilot.

```powershell
$stack = @('-p','m22c-operator-pilot','--env-file','.local/m22c/pilot.env',
  '-f','compose.yaml','-f','compose.fixture.yaml','-f','backend/experiments/m22c.compose.yaml')
docker compose @stack up -d --no-build --pull never --wait postgres redis collection-fixture browser-mirror
docker compose @stack run --rm --no-deps api alembic upgrade head
docker compose @stack up -d --no-build --pull never --wait api worker dispatcher
npm.cmd ci --prefix frontend
npm.cmd run build --prefix frontend
$env:LOCAL_PROFILE_APPROVAL = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58196'
npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5224 --strictPort
```

The correction used the cached `collection-backend:m21c-f0ba4a3` dependency image, the existing frontend dependencies and Edge. Use a separate Compose project and database for correction reproduction. Create a fresh ignored `.local/m22c/correction.env` with the disposable PostgreSQL settings above, `API_PORT=58236`, `POSTGRES_PORT=55636`, `M22C_MIRROR_PORT=58237` and free subnets, for example `M22C_API_SUBNET=10.251.124.0/24` and `M22C_FIXTURE_SUBNET=10.251.125.0/24`. Use the setup commands above with project `m22c-reference-correction` and the correction env file. Start the Dashboard on port 5236 with `API_PROXY_TARGET=http://127.0.0.1:58236`. The correction used only the API, database, Redis and the two fixture channels.

From another terminal at the checkout root, choose a fresh suffix for both reference directories. Each rehearsal uses its own reference Source. The early run deliberately records the stop before asking the Dashboard to approve. Later approval and readback exercise the cutoff check.

```powershell
$env:M22C_API = 'http://127.0.0.1:58236'
$env:M22C_MIRROR = 'http://127.0.0.1:58237'
$env:M22C_DASHBOARD = 'http://127.0.0.1:5236'
$suffix = 'repeat1'
foreach ($timing in @('verified', 'early')) {
    $session = "reference-$suffix-$timing"
    node backend/experiments/m22c_session.mjs rehearse $session $timing
    pwsh -NoProfile -File backend/experiments/m22c_archive.ps1 -Session $session `
      -Project m22c-reference-correction -EnvFile .local/m22c/correction.env
    docker run --pull never --rm --network none `
      --mount "type=bind,source=$($PWD.Path)/backend,target=/app/backend,readonly" `
      --mount "type=bind,source=$($PWD.Path)/.local/m22c,target=/app/.local/m22c" `
      collection-backend:m21c-f0ba4a3 python -m backend.experiments.m22c_score reference --session $session
}
```

Run the focused regressions and the existing M22A/M22B reference suites offline.

```powershell
node --test backend/experiments/m22c_completion.test.mjs
docker run --pull never --rm --network none `
  --mount "type=bind,source=$($PWD.Path),target=/workspace,readonly" --workdir /workspace `
  -e PYTHONDONTWRITEBYTECODE=1 collection-backend:m21c-f0ba4a3 `
  python -m pytest -s -q -ra -p no:cacheprovider backend/experiments/m22c_score_test.py `
    backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py
```
