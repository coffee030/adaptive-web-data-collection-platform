# Core release candidate verification

The candidate integrates M22A, M22B and the existing M22C evaluator history. It keeps the Core domain-neutral and the existing Dashboard layout. Windows verification used build 26200 on x64 with approximately 16 GiB RAM. WSL reported status exit 50 and Docker Desktop was absent. The [deployment decision](../decisions/Core-local-frontend-deployment.md) records the scope, design and review status.

| Requirement | Implementation | Automated test | Observed result | Evidence | Status | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| Approved Source handling | Source approval and vetted destination, robots and pacing policies | M0, M1, M22A and M22B | Approval and policy decisions passed | [Local verification](#local-verification) | PASS | Bundled fixtures |
| Bounded Source suggestion | Transient suggestions with request and deadline caps | M22A and M22B pytest and Playwright | 45 focused Python tests, 3 focused mock cases and 2 deployed manual and assisted browser cases passed | [Hosted verification](#hosted-verification) | PASS | Controlled fixture reference routes |
| Profile versioning | Immutable approvals and Alembic-managed history | PostgreSQL integration and deployed Profile browser tests | Draft, preview, validation, revision and explicit approval checks passed | [Hosted verification](#hosted-verification) | PASS | Controlled fixture reference routes |
| Multi-source collection | Request bindings and one Job per selected Source | Synthetic Demo and MCP submission | Three Demo Requests each completed two Jobs | [Resource observations](#hosted-resource-observations) | PASS | Bundled fixtures |
| PostgreSQL persistence | Named data volume and Alembic head check | M2 SQL tests and Demo restart | Migration and persisted readback passed | [Hosted verification](#hosted-verification) | PASS | Hosted Docker engine |
| Redis queueing | Internal broker with a memory limit | Real Redis transport tests | Broker transitions and replay checks passed | [Hosted verification](#hosted-verification) | PASS | Hosted service |
| Worker execution | One default prefork Worker with concurrency and prefetch one | Demo and live broker tests | Work completed through Celery | [Resource observations](#hosted-resource-observations) | PASS | Bundled fixtures |
| Retry and recovery | Dispatcher leases and Worker attempt attribution | Redis and Compose recovery suites | Real broker recovery, six Compose recovery cases and live Worker attribution passed | [Hosted verification](#hosted-verification) | PASS | Hosted Linux Docker |
| Deduplication | Persisted record identity and duplicate counts | Core and M2 ingestion cases | Duplicate accounting passed | [Hosted verification](#hosted-verification) | PASS | Bundled fixtures |
| Quarantine | Validation outcomes and rejected-row lineage | Partial CSV and Compose recovery cases | Quarantine and Evidence references verified | [Hosted verification](#hosted-verification) | PASS | Bundled fixtures |
| Evidence lineage and SHA-256 | Named Evidence volume and capture metadata | Demo verification and Compose recovery | Stored bytes and lineage read back after restart | [Resource observations](#hosted-resource-observations) | PASS | Bundled fixtures |
| Article History | Versions and request-scoped observations | M13 deployed browser suite | Both Article History cases passed | [Hosted verification](#hosted-verification) | PASS | Bundled fixtures |
| CSV export | Full request export | Demo CSV-to-record comparison | All three exports matched before and after restart | [Resource observations](#hosted-resource-observations) | PASS | Bundled fixtures |
| JSON export | Full request export | Demo JSON-to-record comparison | All three exports matched before and after restart | [Resource observations](#hosted-resource-observations) | PASS | Bundled fixtures |
| MCP | Stdio adapter to direct loopback API | Protocol suite and real Demo smoke | Discovery, replay-safe submission, Records and Evidence passed | [MCP setup and test](../setup/Windows-MCP-Access.md) | PASS | Optional client needs a separate Python environment |
| One-click setup | Windows Setup, Start, Diagnose and Stop launchers | Launcher suite and clean ZIP attempt | 28 launcher tests passed. Actual Setup stopped at the WSL check. | [Clean checkout](Clean-Checkout-Acceptance.md) | PARTIAL | Windows first install and service startup pending |
| Containerized frontend | Multi-stage image and same-origin Nginx proxy | No-cache Compose build and boundary probes | Image, health and local boundary passed | [Deployment decision](../decisions/Core-local-frontend-deployment.md) | PASS | Loopback deployment |
| No host Node.js required | Docker build and container-only launcher | Windows no-Node regression | Start gated on container health and skipped host Node | [Local verification](#local-verification) | PASS | Physical Node-free cold install pending |
| Stop and restart persistence | Owned project and retained volumes | Compose Stop, Start and Demo readback | Hosted restart preserved identities, Records, Evidence and exports | [Resource observations](#hosted-resource-observations) | PASS | Windows requires a working engine |
| Clean checkout | Fresh hosted clone and disposable Windows ZIP | Compose gate and Windows prerequisite check | Hosted no-cache build, Normal, Demo and onboarding passed. The local fresh ZIP reached Setup. | [Clean checkout](Clean-Checkout-Acceptance.md) | PARTIAL | Windows Setup blocked at `ENV-004` |
| CI | Three triggers and seven named jobs | [Release workflow](../../.github/workflows/pull-request.yml) | All seven jobs passed on the product commit | [Successful run](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44793217466) | PASS | Hosted Windows runs launcher tests |
| Low-memory resource evidence | Default Worker, Redis and log bounds | Container samples during Demo and restart | Hosted samples and disk figures recorded | [Resource observations](#hosted-resource-observations) | PARTIAL | Windows host paging and responsiveness pending |
| Physical 8 GB acceptance | Script and acceptance checklist | `Test-ReleaseAcceptance.ps1 -Physical8GB -NoCache` | No physical 8 GB run | [Physical procedure](Physical-8GB-Acceptance-Procedure.md) | BLOCKED | Requires qualifying hardware |
| M22C preparation | Task cards, fixture receipts, cutoff, scorer and CSV validator | M22C Node and pytest suites | 14 cutoff tests and 8 scorer tests passed. Four planned rows validated. | [M22C protocol](M22C-Pilot-Protocol.md) | PASS | Pilot recording requires coordinator setup |
| M22C human timing | Frozen paired manual and assisted trials | CSV validator and evidence adjudication | Human timing unmeasured | [M22C protocol](M22C-Pilot-Protocol.md) | NOT RUN | Requires participants |

## Local verification

- With OpenSSL from Git for Windows on `PATH`, `.venv\Scripts\python.exe -m pytest -q -ra backend/tests backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py backend/experiments/m22c_score_test.py` produced 286 passes and 68 skips. The skips require PostgreSQL, Redis or Docker Compose.
- `npm.cmd run build` and `npm.cmd test` from `frontend` passed TypeScript and Vite build and all 159 Chromium tests after correcting the native zoom runner. The three browser cases that later failed on Linux passed nine targeted Windows executions with explicit destination and pagination checks. The complete run with `PLAYWRIGHT_CHANNEL=chrome` passed 159 tests as well.
- `.venv\mcp\Scripts\python.exe -m pytest -p scripts.require_pytest_pass -q mcp_access/tests` produced 14 passes. Backend and MCP use separate environments because the pinned versions differ.
- `node --test backend/experiments/m22c_completion.test.mjs` produced 14 passes.
- `powershell.exe -NoProfile -File scripts/windows/Test-Launcher.ps1` produced 28 passes.
- `Setup-Platform.bat -NonInteractive -NoBrowser` exited 1 with `ENV-004`. Diagnose returned WSL status 50 and found neither Docker Desktop nor the Docker CLI. On that host, run `Start-Platform.bat`, approve the official WSL installer and any required restart, then rerun the same launcher.
- The extracted Windows source was tested in a fresh NTFS path containing spaces and Unicode. Demo Setup stopped at `ENV-004` and Demo Diagnose completed. An earlier extraction into the Codex sandbox's app-package temp directory hit Windows PowerShell's unsigned-script policy. The repository-local NTFS extraction reached the launcher without any execution-policy change. Setup stopped before volume creation or a container build.

## Hosted resource observations

Simulated or current-host resource evidence, not physical 8 GB acceptance. The [successful hosted Compose job](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44793217466/job/136486001135) built the application images without cache in 20 s. Migration and first service startup took 26 s, Demo provisioning and verification took 55 s, Stop and restart took 18 s, and repeated startup took 1 s. Docker reported 449,837,645 bytes for the backend image and 62,940,156 bytes for the frontend. After seed, the data directories occupied 48,780 KiB for PostgreSQL, 340 KiB for Evidence and 8 KiB for Demo state. The three Demo Requests produced six Jobs, 18 accepted Records and 28 verified Evidence captures. Both exports matched the persisted Records before and after restart. The real MCP check passed discovery, submission, replay, Records and Evidence lookup.

Across 105 idle, Demo and restart samples, per-service memory maxima were Worker 116.20 MiB, API 109.40 MiB, Dispatcher 74.41 MiB, PostgreSQL 39.77 MiB, fixture 20.34 MiB, frontend 5.54 MiB and Redis 4.61 MiB. Sampled CPU peaked at 23.93% for the API and 22.82% for the fixture. The remaining services were below 3%. These maxima may occur at different times. Seed observations include CSV, JSON and Evidence verification within one stage. The hosted gate completed within its configured timeout. Windows paging, short-lived peaks and interactive responsiveness require the physical procedure.

## Hosted verification

Product commit `c1bb220b123426026e9f7a26de4fc9b15a6b46c2` passed all seven checks. The fresh Compose job passed seven recovery and attribution cases, 28 browser cases across Article History, Demo, manual and assisted onboarding, and empty Normal, plus browser checks within the attribution case. Three Normal-only cases skipped in the Demo run and passed in the separate Normal run. The hosted backend job passed 259 tests and the PostgreSQL and Redis job passed 80. The frontend job passed 159 tests, MCP passed 14, and Windows launcher tests passed 28. The M22C tooling passed 14 cutoff and eight scoring tests and verified the blank CSV. [Successful run](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44793217466)

The [initial hosted gate](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44788230498) found that dynamically assigned ports changed on restart, three browser tests interacted before navigation or pagination settled, and a publication-lock test allowed dispatch before taking the lock. The correction keeps test ports stable and synchronizes with the expected state.

The [stable-Chrome run](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44790577056) passed six jobs. It recorded 159 browser tests, 259 Core tests, 80 database and broker tests, 14 MCP tests, 28 launcher tests, 14 cutoff tests and eight scorer tests. Within the Compose job, both Article History and six Worker recovery tests passed. That job's deployed browser stage exposed an outdated Job list and detail equality assertion and a Compose version that rejected `start --wait`, leaving services stopped for subsequent cases. The new release gate uses `up -d --no-build --no-recreate --wait` for those recovery checks and caps proxy DNS and connect waits during outages.


## Repository settings

Branch protection is pending. The authenticated account has repository **WRITE** permission. GitHub reported `main` as unprotected and returned no applicable rules, and the classic protection endpoint returned HTTP 404.

1. With repository administrator access, open **Settings → Rulesets → New branch ruleset**. Name it `main-release-gate`, choose **Active**, and target the default branch `main`.
2. Enable **Require a pull request before merging**, set **Required approvals** to **1**, and enable **Restrict deletions** and **Block force pushes**.
3. Enable **Require status checks to pass** and **Require branches to be up to date before merging**. Select the GitHub Actions checks listed below and save the ruleset. Confirm it applies to `main` and verify the PR merge requirements. [GitHub ruleset setup](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) · [Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

- Frontend build and type check
- Backend unit and Source onboarding tests
- PostgreSQL, migrations, Redis and queue integration
- MCP protocol tests
- Compose, migration, container frontend and controlled Demo
- Windows launcher tests
- Controlled onboarding pilot tooling

Teammate review is pending on [PR #8](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/8).
