# M10 Synthetic Demo Presets and Launcher

## Running the two environments

| Action | Normal | Synthetic Demo |
| --- | --- | --- |
| Setup | `.\Setup-Platform.bat` | `.\Setup-Platform.bat -Demo` |
| Start | `.\Start-Platform.bat` | `.\Start-Platform.bat -Demo` |
| Diagnose | `.\Diagnose-Platform.bat` | `.\Diagnose-Platform.bat -Demo` |
| Stop | `.\Stop-Platform.bat` | `.\Stop-Platform.bat -Demo` |

Use the URL printed by Start. Both modes can run at once. A fresh Normal installation is empty. A fresh Demo Start brings up its own services, provisions presets and waits for real collection results. Allow several minutes for first startup and collection. Add `-NoBrowser -NonInteractive` for unattended checks and set `PLATFORM_NO_PAUSE=1` if you need the BAT to return immediately on error.

| Resource | Normal | Synthetic Demo |
| --- | --- | --- |
| Protected settings, operation lock and frontend process state | `.local/` | `.local-demo/` |
| Compose project | `adaptive-web-core-local-<owner>` | `adaptive-web-core-demo-<owner>` |
| PostgreSQL | Separate credential, database and owned volume | Separate credential, database and owned volume |
| Redis and Evidence | Project-local broker and owned volumes | Project-local broker and owned volumes |
| Manifest | — | Owned `demo_state` volume |
| Dashboard / API / PostgreSQL | `5197` / `58097` / `55497` | `5198` / `58098` / `55498` |

The ports bind to loopback. Compose ownership checks cover labelled resources and physical volume/network names. The Demo fixture runs on a project-local internal network with no published port. The checkout and pinned dependency files are shared. Runtime frontend caches and process stop markers are separate. Stop issues a scoped Compose stop and preserves data. Back up and restore the private settings and matching owned volumes together. [Windows setup and port recovery](../setup/Windows-One-Click-Setup.md#isolated-synthetic-demo)

## Presets and data

| Category and Topic | Approved Sources and selectors | Keyword | Records / Observations | Evidence captures |
| --- | --- | --- | --- | --- |
| Core Demonstration · Fixture Listings | Demo Cards (CSS), Demo Catalog (XPath) | `quick` | 2 | 4 |
| Marketing Intelligence · Influencer Advertising and Sponsorship | Creator Brief (Synthetic, CSS), Disclosure Desk (Synthetic, XPath) | `partnership` | 8 | 12 |
| Financial Markets · Market News and Economic Updates | Market Wire (Simulated, CSS), Economic Ledger (Simulated, XPath) | `market` | 8 | 12 |

Every preset submits one Request and two Jobs. Marketing and Market Jobs each visit two result pages and four detail pages. The Core fixture also supports `detail404`, which produces a separate Partial Request with two accepted Records. It is available on demand. The fictional Marketing payloads contain creator, brand, disclosure, platform, summary, date and source URL. The fictional Market payloads contain instrument, market, numeric price and movement, currency, summary, date and source URL. The Records and downloads carry their dataset labels.

A preset is a saved setup for a category, topic, two authorized Sources and two approved Profile Versions. Provisioning uses standard APIs to create those objects, validate each draft, approve it, pin the topic bindings and submit the Request. The Dispatcher and Workers perform the collection. Startup reads the accepted Records, verifies pinned Job and Evidence lineage, resolves and hashes stored files, checks Article Observations and compares both exports with the persisted Records. Diagnose performs read-only checks and reports each preset.

Client request keys and the volume-backed manifest let an interrupted Start resume. An approved Version 1 and its bindings are reused, and a successful baseline is verified by its saved ID. The Launcher reports revoked Sources, edited configuration, retired Profiles or disabled bindings so the operator can review the changes. If a baseline ends in Failed or Partial, correct the cause and use `.\Start-Platform.bat -Demo -DemoRetry` to submit a new baseline for that preset. Previous results and Evidence remain available. Inspect `logs/launcher/demo/latest.log` for failures.

## Controlled financial refresh

The fixture starts at Revision 1. Finish any market Jobs before switching revisions. This operator command targets only the labelled fixture in the selected Demo project.

```powershell
$project = (Select-String -Path .local-demo/launcher.env -Pattern '^COMPOSE_PROJECT_NAME=(adaptive-web-core-demo-[0-9a-f]{12})$').Matches.Groups[1].Value
$fixture = docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=collection-fixture"
if (!$project -or @($fixture).Count -ne 1 -or !$fixture) { throw 'Expected one running Demo fixture.' }
docker exec $fixture python -c "from urllib.request import Request, urlopen; print(urlopen(Request('http://127.0.0.1:8001/demo-revision/2', method='POST'), timeout=3).status)"
```

Expect HTTP 204. Refresh the Financial Markets baseline from its Request page. The first Article per financial source keeps its identity and adds an Observation and a content version. Aster Grid changes from 42.50 to 43.00 and Harbor 50 changes from 813.40 to 813.90. The other six Articles gain Observations and retain their versions. The previous Record payloads and Evidence stay available. Use the same command with `/demo-revision/1` to return the fixture to Revision 1. Restarting the fixture also returns it to Revision 1.

## Test results

The Windows test host used Windows 11 AMD64 build 26200, PowerShell 5.1, Node 22.18.0, Docker Engine 29.9.3 and Compose 5.7.0. Its Docker default address pools were exhausted. The isolated test projects used verified unused private subnets from the documented overrides and alternate host ports where the defaults were occupied.

| Check | Status | Observed result |
| --- | --- | --- |
| Fresh Normal, Diagnose, Stop, restart | PASS | Empty Categories, Topics, Sources, Records, Articles, Collection Requests and Jobs before and after restart. |
| Fresh Demo Setup and Start | PASS | Migration head verified. Three Requests, six executed Jobs, 18 accepted Records, 18 Article Observations and 28 captures. |
| Repeat Demo Start, Diagnose, Stop and restart | PASS | Identical baseline IDs, Profile Versions, Records and Evidence. Four Demo volumes retained. Two running Normal projects kept the same container identities, private settings and API snapshots. |
| Operator edit | PASS | A renamed preset was preserved and stopped the readiness announcement. Restoring the expected name allowed startup to reuse the same Requests. |
| Market Revision 2 and Core `detail404` | PASS | Refresh kept eight Article IDs, produced eight new Observations and two new content versions, and changed two numeric prices. The Partial run retained two accepted Records and both HTTP 404 captures. |
| Launcher suite | PASS | 26 of 26 tests passed under Windows PowerShell 5.1. |
| Frontend | PASS | TypeScript and production build passed. Microsoft Edge passed 89 mocked and 18 live integration tests, including a browser visit to the running Demo and six actual Demo downloads. |
| Full Backend regression | PASS | 270 passed, 0 failed, 0 skipped and 0 errors in 508.54 seconds. The isolated Compose stack used the newly built Demo code image with the regular regression fixture mode. |
| Independent data check | PASS | Six Demo attachments equalled committed PostgreSQL rows. Recomputed hashes matched all 28 stored capture files. The original M10 Topic verifier also passed on six Core browser downloads and 14 Core capture files. |
| Cold prerequisite installer, interactive default-browser association, 8 GB Windows machine | NOT RUN | The host already had the prerequisites. Start printed the URL and the Edge browser suite visited it. |
| Live public collection | NOT RUN | Both considered websites were classified unsupported for this workflow. |

Run the launcher checks with `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1` and the frontend checks with `npm ci`, `npm run build` and `npm test` in `frontend`. For the live preset browser check, set `M4_REAL_API=1`, `M10_SYNTHETIC_URL` to the running Demo Dashboard and `M9_TEST_PYTHON` to a Python executable. Select the test with `npm test -- tests/topic-collections.integration.ts -g "launcher dashboard" --workers=1`. For the full backend, use the isolated environment in `backend/experiments/m10_environment.ps1` and run `python -m pytest -q -rs -s --tb=short backend/tests`.

- [FYP presentation walkthrough](M10-FYP-Core-Demo-Runbook.md) has the user and operator flows.
- [Real website feasibility](M10-Real-Website-Feasibility.md) has the separate opt-in evaluation and current limits.
