# M22C controlled onboarding pilot

Use the same reviewed product commit for both arms. The [original pilot checkpoint](M22C-Operator-Pilot.md) records the frozen study and prior technical rehearsal. For this release candidate, record the reviewed commit in `M22C_PRODUCT_SHA` before provisioning, and repeat the technical rehearsal on the actual pilot environment. Store results and raw artifacts under the private `.local/m22c` directory. Provisioning creates `onboarding-results.csv` from the [blank trial sheet](m22c-onboarding-results.csv).

## Prepare a fresh pilot environment

Use a disposable release checkout and choose a unique Compose project name and free loopback ports. Use the fixed fixture and mirror in `backend/experiments/m22c.compose.yaml`. Create `.local/m22c/pilot.env` with a generated disposable PostgreSQL password and the values below, adjusting ports and unused private subnets if needed. Keep the project name, image tag and settings together to resume the same trials.

- `POSTGRES_USER=m22c`, `POSTGRES_DB=m22c`, `POSTGRES_PASSWORD=<generated password>`, `POSTGRES_PORT=55596`.
- `API_PORT=58196`, `FRONTEND_PORT=5224`, `M22C_MIRROR_PORT=58197`, `LOCAL_PROFILE_APPROVAL=1`.
- `M22C_BACKEND_IMAGE=<your unique project name>-backend:local`.

```powershell
$project = 'm22c-operator-pilot-session1'
$stack = @('-p',$project,'--env-file','.local/m22c/pilot.env',
  '-f','compose.yaml','-f','compose.fixture.yaml','-f','backend/experiments/m22c.compose.yaml')
docker compose @stack build api frontend
docker compose @stack up -d --wait postgres redis collection-fixture browser-mirror
docker compose @stack run --rm --no-deps api python -m alembic upgrade head
docker compose @stack up -d --no-build --wait frontend worker dispatcher
$env:M22C_PRODUCT_SHA = git rev-parse HEAD
npm.cmd ci --prefix frontend
node backend/experiments/m22c_session.mjs provision
```

The coordinator's recorder uses Node.js and Edge. If you changed ports, set `M22C_API`, `M22C_DASHBOARD` and `M22C_MIRROR` to the actual loopback URLs. Run the reference rehearsal and scoring from the coordinator runbook on the reviewed SHA. Pass your actual `-Project` to the archive script and use your built image tag for offline scoring. Repeat the rehearsal if the product or observation environment changes.

## Operator cards

- **Manual.** Open the assigned Dashboard Source and permitted homepage. Use the browser and DOM inspector to choose the two detail links and map required Title (text) and Count (integer). In the Dashboard, choose keyword search and detail pages. Use the assigned keyword, one detail page, the card's request cap, two seconds per request and an empty next-link selector. Create the draft, preview, validate and explicitly approve the matching version. Signal the coordinator when approval is shown.
- **Assisted.** Use the same target, fields, limits and approval steps. Open **Get a profile suggestion**, enter the assigned homepage and keyword, and inspect the request outcome. You may request the permitted examples from the coordinator. Apply and edit the draft, or undo the suggestion. Preview and validate after corrections before explicitly approving and signaling the coordinator.

The runner opens only the current assignment. Use the [frozen assignment sheet](m22a-onboarding-trials.csv) for ordering and the [coordinator runbook](M22C-Coordinator-Runbook.md) for controlled fixture setup, automatic request and action capture, terminal approval adjudication and replay. Change only the result copy under `.local/m22c`. The 15-minute cap includes wait time, retries and fallback.

## Scoring and report template

Use the offline scorer to replay the final configuration. A complete score covers two expected detail links and four typed field values. Record wrong and missing links, unresolved fields, real configured-search results, unauthorized attempts, elapsed and waiting seconds, correction and retry counts, fallback reason and time, and failure reason. Keep a stable reference to the journal and approved version, revision, hash and validation report. Unobserved values stay blank. Record observed absence as zero.

Use the following report outline. Include the paired comparison only when both arms in a pair have auditable human results. With no human runs, report that timing and savings are unmeasured.

| Report field | Value to fill |
| --- | --- |
| Environment | Product and evaluator SHAs, host, fixture version, run date |
| Trial results | Assignment, arm, outcome, elapsed and waiting seconds, corrections, retries |
| Profile and policy checks | Link and typed-field scores, unauthorized requests, approved version and report, evidence reference |
| Fallbacks and incomplete trials | Assignment, reason, time and observation gap |
| Pair comparison | Matched assignments, observed differences and limitations |
| Review | Automated verification, human evidence and reviewer disposition |

Validate the CSV separately from the scorer and receipt audit.

```powershell
python -m backend.experiments.m22c_validate_trials .local/m22c/onboarding-results.csv
```

The [earlier pre-maintenance Compose job](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44793217466/job/136486001135) passed both manual and assisted reference flows against the deployed fixture stack. The manual Catalog flow used no suggestion request and previewed Title and Count before passing validation. The assisted Cards flow checked the static GET form and examples fallback, applied and corrected a suggestion, then passed Preview, Validate and explicit approval. The automated measurements cover functional correctness. Human timing and comparative savings remain unmeasured.
