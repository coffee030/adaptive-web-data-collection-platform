# PR26 Stage D handoff

28 November 2026 (Hong Kong). Stage D is complete within the available local verification scope and awaits independent review. The acceptance matrix has attributed evidence for T01–T18. All selected local test suites passed on the final test sources. Full Compose is blocked at the Docker Linux engine preflight. Hosted GitHub Actions and live publisher collection were outside this run. [Acceptance record](../verification/PR26-Acceptance.md)

## Source identity

| Item | Value |
| --- | --- |
| Repository | `coffee030/adaptive-web-data-collection-platform` |
| Checkout | `C:/Users/noob/Downloads/ITE4116M_Final_Year_Project/Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch | `codex/pr26-research-clarity` |
| Working HEAD and patch base | `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Accepted corrected C tree | `a227a56466d98f32add434430916d34f1c1f21bc` |
| Historical accepted B tree | `d2e3a01ba8c4a80b0a685dd1cc6f556ed95db352` |
| Accepted C-R1 source ZIP SHA-256 | `83a664a561861f49e5d6212cef45a3eafa72253a08d616d9c9b5bd1e496d58cf` |
| Standalone C-R1 handoff SHA-256 | `abc5b7336d29965e92b99868c3fec9c75474e3d1570e351206a70c5cf8fa7756` |
| Migration | `0034` is the sole head and was current in the disposable browser database. Alembic found no schema drift. |

The initial checkout matched accepted C-R1 after Git normalization. It already contained the uncommitted and untracked Stage A through C-R1 changes. `verification/baseline-status.txt` records every starting path. `verification/baseline-tree.txt` records both the reconstructed and current starting tree IDs. Stage D work is also uncommitted. `MANIFEST.json` in the review ZIP declares the final complete Git tree.

The corrected source ZIP and standalone R1 handoff matched their declared hashes. The independent review Markdown was available and reviewed. Its corresponding independent-review ZIP was unavailable in the supplied locations. The Stage D prompt, Playwright config and release script attachments were used as references. The two code attachments matched their accepted worktree counterparts after newline normalization. Their raw SHA-256 values are in `verification/reference-hashes.txt`.

## Stage D changes

| Path | Change |
| --- | --- |
| `scripts/release-compose.sh` | Added `research-preparation.integration.ts` to the existing four-file company pilot selection, retaining the other three files, pilot environment and service setup. The gate emits a line report plus a temporary JSON report. It requires zero skips and at least one passing preparation test, and cleans up the report with the existing scratch output. Required pytest skip enforcement stays in place. |
| `frontend/tests/research-preparation.integration.ts` | Added a 30-day-text/90-day-field browser case. It shows a blocker, checks both provenance candidates, explicitly chooses 30, checks for no pre-confirmation writes, and verifies the initial audit and the stored effective 30-day cap alongside the original 90-day field. |
| `frontend/tests/campaign-research.integration.ts` | Expanded the controlled findings case for infeasible quotes and a quoted allocation without direct examples. The matching-USD saved-draft case now checks a zero monetary value alongside exact nonzero minor units and the legacy total-cost fallback. |
| `docs/verification/PR26-Acceptance.md` | Built the original T01–T18 matrix, with evidence layers, exact command references and supplementary C/C-R1 checks. |
| `docs/handoffs/PR26D-Handoff.md` | Consolidated behavior, current verification and reconstruction for independent review. |

The current failures that required retries came from the Windows sandbox or launch environment. No product defect was established and no runtime product source changed in Stage D. No paths were deleted. The existing workflow still runs seven jobs and the existing Playwright config continues to separate ordinary and real-API test selection.

## Accepted behavior

- The finite English/Chinese criteria resolver tracks explicit, text, application-default and legacy provenance. Supported date windows, deliverables, exclusions and required versus preferred language retain their meaning. An unranked comparison requires a deliberate primary selection.
- Preview is side-effect free and returns a company-bound fingerprint over the proposal. Confirmation approves the whole proposal for the selected destination. Material changes invalidate approval. Once a submission is uncertain, retry reuses the full frozen envelope, the original request key and the pre-bound campaign UUID. A changed envelope with the same key conflicts.
- The effective brief drives execution and guides history, adjustment, alternative adoption and campaign saving. Actual legacy records and frozen confirmed-v1 records keep their stored interpretation and report identity through read, retry and resume. The historical fixture remains byte-for-byte preserved. Migration 0034 retains the paired snapshot constraint and downgrade guard.
- The result separates requested channels, recorded source availability, bounded public evidence and company-authorized strategy evidence. Public examples cannot establish private quotes or eligibility. Report, rights and integrity revalidation still apply. Quote and evidence requests are copyable drafts.
- The two valid generic saved-campaign currency shapes retain their original money and block an unresolved preview. Acknowledgement explicitly reuses numbers with no conversion. Omission produces a null scenario. Restore and currency changes preserve the accepted safeguards, including invalidation and budget re-entry.

## Verification by CI job

These are current local results. Browser entries report pass/fail/skip. Each pytest run used the existing no-skip plugin.

| Job | Exact command or local equivalent | Result and ZIP evidence |
| --- | --- | --- |
| frontend | From `frontend`, `npm ci` using the local npm cache with `npm_config_offline=true`, then `npm run build`. Ordinary `npm test -- --output=../.local/pr26d/ordinary-playwright-results` with the integration flags unset. | All exit 0. 107 packages installed from the lockfile, build and typecheck passed, and ordinary Chrome suite 170/0/0. `verification/frontend-npm-ci.txt`, `frontend-build.txt`, `frontend-tests-retry.txt`. |
| backend | `python -m pip check`, `python -m ruff check --config ruff.toml backend mcp_access scripts`, `python -m ruff format --config ruff.toml --check backend mcp_access scripts`, `python -m pytest -p scripts.require_pytest_pass -q -ra backend/tests --ignore=backend/tests/m2 backend/experiments/test_m22a_onboarding.py backend/experiments/test_m22b_suggestions.py`. | All exit 0. 209 files already formatted and 484 tests passed, zero failures or skips. `verification/backend-pip.txt`, `backend-lint.txt`, `backend-format.txt`, `backend-unit-retry.txt`, `backend-unit-collected.txt`. |
| data | `python -m pytest -p scripts.require_pytest_pass -q -ra backend/tests/m2 --ignore=backend/tests/m2/test_m3_compose.py`. | Exit 0. 128 passed, zero failures or skips, including DB-backed marketing MCP, confirmed research, legacy, concurrency, downgrade guard and current rights. `verification/data-tests.txt`, `data-collected.txt`. |
| mcp | From the repository root using the separate MCP interpreter, `python -m pip check` and `python -m pytest -p scripts.require_pytest_pass -v -ra -o faulthandler_timeout=30 mcp_access/tests`. | Both exit 0. 20 passed, zero failures or skips. The suite uses actual stdio with controlled HTTP. `verification/mcp-pip.txt`, `mcp-tests-retry.txt`. |
| compose | `bash -n scripts/release-compose.sh` and `bash scripts/release-compose.sh` from the repository root using Git Bash. The company line/JSON check was also run locally with the exact four-file selection against the Vite pilot. | Syntax exit 0. Full Compose exit 1 before service startup because `dockerDesktopLinuxEngine` was unavailable. Full container, demo, recovery and worker checks remain blocked. Local company selection 16/0/0, including nine preparation cases. `verification/compose-syntax.txt`, `compose-full.txt`, `docker-version.txt`, `browser-company-selection.txt`, `browser-company-selection-summary.json`, `company-report-guard.txt`. |
| windows | `powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File ./scripts/windows/Test-Launcher.ps1`. | Exit 0, 32/32 launcher cases. The original process default rejected script loading. The retry used a process-scoped policy. `verification/windows-launcher-remote-signed.txt`. |
| pilot | `node --test backend/experiments/m22c_completion.test.mjs`, `python -m pytest -p scripts.require_pytest_pass -q backend/experiments/m22c_score_test.py`, `python -m backend.experiments.m22c_validate_trials docs/evaluation/m22c-onboarding-results.csv`. | All exit 0. Node 14 passed and Python 8 passed, zero skips. CSV validated with four planned entries and zero completed, failed or incomplete trials. `verification/pilot-node.txt`, `pilot-score.txt`, `pilot-validation.txt`. |

The final focused research command ran from `frontend` as `npm run test -- campaign-research.integration.ts research-preparation.integration.ts --workers=1 --reporter=line,json`. It passed 14/0/0. The four-file company run added `first-party-window.integration.ts` and `market-sources.integration.ts`. Its nine preparation cases executed with zero skips. The recorded results include both C-R1 currency cases, the new age conflict and the controlled four-outcome presentation check. `verification/browser-research.txt` and `verification/browser-research-summary.json` give the exact run.

The first sandboxed backend run had 404 passes, 77 failures and three errors while its socket fixtures reported permission errors and OpenSSL failed before use. The ordinary browser and MCP attempts stalled at their local harnesses and were stopped after their environment-enabled reruns finished. The final local results above use the same required test populations with available fixture networking and tools. The Windows MCP launcher used process-scoped `RemoteSigned`. Machine execution policy was unchanged.

## Environment and boundaries

Windows 10.0.26200, Windows PowerShell 5.1 for launcher checks, Node 22.18.0, npm 10.9.3, Chrome 158.0.8127.88, Playwright 1.65.0, Vite 8.3.8 and TypeScript 7.0.2. Both Python environments used CPython 3.12.16. The backend used Ruff 0.17.5, pytest 9.2.0, FastAPI 0.162.7, Pydantic 2.14.3, SQLAlchemy 2.0.57, Alembic 1.20.1 and psycopg 3.3.9. The separate MCP environment used MCP 2.3.0, httpx2 2.16.2 and Pydantic 2.14.4. `verification/runtimes.txt` records versions. The verification environments reused installed packages matching repository pins, with pip bootstrapped locally for checks.

Data and browser runs provisioned separate PostgreSQL 17.7 clusters and Redis 7.4.8 instances on fresh loopback ports. Data fixtures create and drop only their own schemas in the disposable database. The browser used a separate test database with generated credentials and evidence storage. `verification/data-ports.json` and `verification/browser-ports.json` record bound ports. `alembic heads`, `alembic upgrade head`, `alembic current --check-heads` and `alembic check` exited 0. Outputs are `verification/migration-{heads,upgrade,current,drift}.txt`. The historical compatibility fixtures exercised downgrade in their scoped schemas.

The browser used authenticated API and PostgreSQL for campaign reads and writes, preview and approval, retries and receipt read-back. Controlled delays and lost responses resolve timing deterministically. For the decision usefulness and invalid-report checks, Playwright supplied completed report and availability fixtures. The data suite exercised stored report recomputation and content rights against controlled evidence. The MCP company path used real local authenticated HTTP. Neither source query activity nor exhaustive coverage can be inferred from a receipt. Missing market audience facts, current quotes and a causal refresh outcome remain gaps when the source records lack them.

## Reproduction and review package

Use repository-pinned dependencies and fresh loopback-only services. From the repository root, run the table commands with `M2_TEST_DATABASE_URL` and `M3_TEST_BROKER_URL` set to the disposable services and `HARBOURLINE_MCP_TEST_PYTHON` pointing to the separate interpreter. For the browser, set `DATABASE_URL` to a new browser database, upgrade and check the migration, and launch `python -m uvicorn backend.api.app:create_app --factory --host 127.0.0.1 --port <api_port>`. Set `API_PROXY_TARGET=http://127.0.0.1:<api_port>`, `M4_FRONTEND_PORT` to an available port, `M4_REAL_API=1`, `HARBOURLINE_RESEARCH_TEST_PILOT=1`, `HARBOURLINE_INSTALLATION=pilot`, `HARBOURLINE_SELF_REGISTRATION=1`, and `PLAYWRIGHT_CHANNEL=chrome`. Use generated local pilot and partner credentials with an isolated evidence directory. The ZIP includes the verification launcher under `verification/run-local-gates.py` for reference. For full Compose, use a functioning Linux/Bash Docker setup with the frontend and separate MCP dependencies expected by the release script.

The review ZIP includes the changed source and documentation bytes, selected unchanged CI inputs, verified evidence logs, the D-only inventory and deletion list, and a raw size/SHA-256 manifest. Follow `RECONSTRUCT.md` to apply either the complete D patch or the accepted C-R1 full patch followed by the D-only delta. Both routes were checked in clean disposable repositories using strict Git patch whitespace validation. Raw checkout CRLF bytes and normalized Git LF identities are recorded separately. The standalone handoff and its archive entry are identical.

The disposition is partial verification because full Compose remains blocked. Independent review is the next step. No subsequent stage, remote publication or deployment has begun.
