# Core release candidate verification

The candidate integrates M22A, M22B and the existing M22C evaluator history. It keeps the Core domain-neutral and the existing Dashboard layout. The local Windows execution evidence is from a Windows 11 x64 host with Node.js available, WSL unavailable and Docker Desktop absent. The physical host RAM and firmware virtualization state could not be read from CIM.

| Requirement | Implementation and automated evidence | Observed result | Status | Limitation |
| --- | --- | --- | --- | --- |
| Approved Source handling and destination policy | M0, M1, M22A and M22B tests | Controlled fixture tests exercise approval and policy decisions | PASS | Public publishers were outside this release gate |
| Bounded Source suggestion | M22A and M22B pytest and Playwright | 45 Python tests and 3 focused browser tests passed | PASS | Production browser fixture check is part of hosted gate |
| Profile versioning | Profile API and deployed browser integration | Mock workflow passed | PARTIAL | Local PostgreSQL unavailable |
| Multi-source, Worker, Redis, retry and recovery | M2 integration and Compose smoke | Local dependency-free cases ran | PARTIAL | Local services unavailable |
| PostgreSQL persistence and migrations | Alembic migrations and named PostgreSQL volume | Local live check unavailable | BLOCKED | Local Docker Desktop and WSL unavailable |
| Deduplication and quarantine | Core ingestion and controlled partial CSV suites | Local Core tests ran | PARTIAL | Deployed fixture verification pending |
| Evidence, SHA-256 and Article History | Record lineage, named Evidence volume and Demo provisioner | Local Core tests ran | PARTIAL | Scope includes deployed records and bytes |
| CSV and JSON export | Demo verify and browser export suites | Live checks pending | NOT RUN | Local Docker Desktop and WSL unavailable |
| MCP | Stdio suite and Compose MCP smoke | 14 protocol tests passed on Windows | PARTIAL | Deployed smoke pending |
| One-click setup and Node-free runtime | Windows launcher suite, container image and production proxy | 28 launcher tests passed. Actual Diagnose reported unavailable WSL and Docker. | PARTIAL | Interactive first install and Windows runtime unverified |
| Stop and restart persistence | Scoped launcher Stop, Compose and Demo readback | Launcher shutdown unit checks passed | PARTIAL | Windows restore requires a working Docker Engine |
| Clean checkout and CI | [Acceptance procedure](Clean-Checkout-Acceptance.md) and [workflow](../../.github/workflows/pull-request.yml) | Hosted run pending | NOT RUN | Clean Windows install is a separate acceptance run |
| Low memory and resource evidence | Worker concurrency/prefetch one, bounded Redis, bounded logs and acceptance sampling | Windows resource capture unavailable | NOT RUN | No local Docker Engine |
| Physical 8 GB acceptance | [Physical procedure](Physical-8GB-Acceptance-Procedure.md) | No physical 8 GB result | BLOCKED | Requires qualifying hardware |
| M22C human timing | [Pilot protocol](M22C-Pilot-Protocol.md), fixed fixtures, scorer, journal and CSV validator | Human timing unmeasured | NOT RUN | Requires human trials |

## Local verification

- `.venv\Scripts\python.exe -m pytest -q -ra backend/tests backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py backend/experiments/m22c_score_test.py` produced 283 passes and 71 skips. Skips require PostgreSQL, Redis, Compose or OpenSSL on PATH.
- `.venv\mcp\Scripts\python.exe -m pytest -p scripts.require_pytest_pass -q mcp_access/tests` produced 14 passes. Backend and MCP use separate environments because the pinned versions differ.
- `node --test backend/experiments/m22c_completion.test.mjs` produced 14 passes.
- `powershell.exe -NoProfile -File scripts/windows/Test-Launcher.ps1` produced 28 passes.
- `Setup-Platform.bat -NonInteractive -NoBrowser` exited 1 with `ENV-004`. Diagnose returned WSL status 50 and found neither Docker Desktop nor the Docker CLI. On that host, run `Start-Platform.bat`, approve the official WSL installer and any required restart, then rerun the same launcher.

## Repository settings

The authenticated account has repository **WRITE** permission. A repository administrator should set a ruleset for `main` after the release check names are confirmed. Require a pull request with one human approval. Require the check names shown in **Core release verification**, require branches to be up to date, and enable the rules restricting deletion and force pushes. Leave admin bypass consistent with repository policy. Teammate review is pending.
