# M22C coordinator runbook

Keep this runbook, raw evidence, source code and grading material in the coordinator workspace. Show the operator only the card opened for the active assignment. The checkpoint state is **AWAITING HUMAN TRIALS** and the next assignment is **M22A-01, manual**.

## Resume the existing project

1. From the evaluation checkout, confirm `git status --short --branch` and `git rev-parse HEAD`. Use the same project and evidence tree. Check the local CSV, `.local/m22c/sources.json`, `.local/m22c/technical-readiness.json`, services and existing database. Before resuming a started assignment, validate its Source, timestamps, both SHAs, browser/API journal and saved versions. Preserve an interrupted trial with its observed stop state or evidence gap. Audit any directory without a start record before proceeding.
2. Check the Dashboard at `http://127.0.0.1:5224`, API at `http://127.0.0.1:58196/api/v1/health` and mirror at `http://127.0.0.1:58197`. Check mirror connectivity using only `/robots.txt` outside trial windows. Verify the assigned Source policy and empty version list via the API. Use the retained rehearsal when the environment and observation channels match. Repair any failed channel before opening a card.
3. With the operator present, run `node backend/experiments/m22c_session.mjs trial M22A-01` at the checkout root in an interactive terminal. Register the operator alias, Dashboard familiarity, layout familiarity and relevant exposure. Use the same operator across assignments. Make sure the console and isolated Edge window are ready. The operator presses Enter to open the one card and start the monotonic clock. The human performs all timed browser and Dashboard actions. The coordinator presses Enter immediately on the operator's signal that the Dashboard confirms approval for the matching version, revision, hash and report. The timer stops at 900 seconds or on earlier abandonment. Include waits, errors, edits and retries. The frozen order keeps suggestions and prior solutions away from the manual tasks. Use A then Enter to capture abandonment before entering its reason. On an explicit fallback request, use F then Enter, record the reason while the clock runs, and supply the printed permitted pair.
4. Save the terminal evidence immediately. Run `pwsh -NoProfile -File backend/experiments/m22c_archive.ps1 -Session <trial_id>` and retain the journal, stop record, screenshot, version snapshots and receipts. For a claimed completion, verify the screenshot and the approval and validation references against the persisted snapshot. For failures, preserve the last saved draft if available and the stop reason. Save the results CSV row before opening the next card. Retain all incomplete and failed attempts. Keep the raw artifacts local and use stable, sanitized review references.

## Scoring and traffic review

- Run the offline command below with `trial .local/m22c/<trial_id> <assigned-prefix-with-trailing-slash> "<assigned keyword>"` in place of `reference`. It runs the frozen listing and both expected details through Core link selection, extraction and typed ingestion. It reads the final saved configuration and captured proposal responses and scores them separately. An unavailable artifact stays unscored.
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

The actual run used the cached `collection-backend:m21c-f0ba4a3` dependency image and the frontend dependencies from the identical M22B lockfile. Edge is the default browser. In a separate terminal at the checkout root of a fresh reference setup, run the following.

```powershell
node backend/experiments/m22c_session.mjs provision
node backend/experiments/m22c_session.mjs rehearse
pwsh -NoProfile -File backend/experiments/m22c_archive.ps1 -Session reference
docker run --pull never --rm --network none `
  --mount "type=bind,source=$($PWD.Path)/backend,target=/app/backend,readonly" `
  --mount "type=bind,source=$($PWD.Path)/.local/m22c,target=/app/.local/m22c" `
  collection-backend:m21c-f0ba4a3 python -m backend.experiments.m22c_score reference
```
