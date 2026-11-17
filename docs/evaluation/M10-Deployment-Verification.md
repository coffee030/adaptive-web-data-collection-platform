# M10 Deployment Verification

## Tested environment

Windows 11 AMD64 build 26200, PowerShell 5.1, WSL 3.0.5.0 with Docker Desktop Linux containers on WSL2, Docker Desktop 4.99.0, Engine 29.9.3 and Compose 5.7.0. Node.js 22.18.0 and npm 10.9.3 were installed. The host reported 31.9 GiB RAM. The Engine reported 16 logical CPUs and 16.71 GB memory. PostgreSQL was 17 Alpine and Redis was 7.4.8 Alpine. The backend image used Python 3.12.14.

| Check | Method and observed result | Status |
| --- | --- | --- |
| Fresh source and locked dependencies | Exported the reviewed M9 commit using `git archive` into an empty directory. `Setup-Platform.bat -NonInteractive` installed and verified frontend dependencies and initialized private settings in 19.3 s. Existing installed host tools and Docker cache were available. | PASS |
| Launcher first start | Enabled the bundled fixture and local approval. Set unused loopback ports and non-overlapping Docker networks. `Start-Platform.bat -NonInteractive -NoBrowser` completed in 44.6 s and printed `http://127.0.0.1:5199/`. | PASS |
| Service readiness | PostgreSQL accepted the generated login, Redis returned PONG, API health checked the database, Dispatcher logged PostgreSQL polling, Celery responded and registered `collection.execute_job`, and the fixture was healthy. The Vite proxy also returned API health. | PASS |
| Current migration | Fresh isolated Compose database completed `alembic upgrade head`. Actual database revision and repository migration head both returned `0009 (head)`. The Launcher separately verified its own new database at the expected head. | PASS |
| Populated upgrades | Existing PostgreSQL tests upgraded disposable schemas from `0004`, `0006` and `0008` directly to `0009`. They checked legacy Source/Profile and pending/running/terminal state, preserved accepted and quarantined outputs, and verified legacy Evidence metadata and bytes. Alembic found no additional operations. | PASS |
| Repeat start | Immediate second Start took 11.7 s and reused the image, frontend process and saved settings. | PASS |
| Stop and restart | Stop reported success. No containers with the test Launcher's project label remained running. Start reused the same PostgreSQL, Redis and Evidence volumes. | PASS |
| Post-restart Topic data | Fresh read of six Jobs across initial, refreshed and partial Requests yielded six observations, two articles and two content versions. Fourteen file hashes matched PostgreSQL. The original six downloaded files still matched the same exports and SQL records. Before and after verification snapshots were byte-identical. | PASS |
| Dashboard after restart | Headless Chrome opened the actual Launcher URL, reopened the initial Request, saw two Succeeded child Jobs and confirmed CSV availability. | PASS |
| Launcher error and process handling | The 23-case Windows script suite passed, including simulated browser-open failure, diagnostic guidance, Vite ownership, graceful stop, relaunch and volume preservation. | PASS |
| Windows URL association | The live run used `-NoBrowser` and independently visited the printed URL with Chrome. Interactive default-browser auto-open was not exercised. | NOT RUN |
| Bare Windows provisioning | Windows, WSL, Docker Desktop and Node were preinstalled. Dependency installation from a clean source directory was tested. | NOT RUN |
| Physical 8 GB Windows host | The tested Windows host had 31.9 GiB. No physical 8 GB host was available. | NOT RUN |

Raw command output and screenshots are under the ignored `.local/m10/` directory. Launcher evidence includes `launcher-{setup,start,repeat,stop,restart,tests}.log`, `launcher-reopened.png` and `topic-sql-{before,after}.json`.

Categories, Topics, Collection Requests, Articles and Observations were introduced at revision `0009`. Their persistence was exercised through Stop and Start with populated current-schema data. The legacy-upgrade fixtures cover the entities present in the earlier schemas.

The one-Worker CSV measurement sampled up to 160.4 MiB for the Worker, 281.7 MiB for PostgreSQL, 85.1 MiB for the API and 10.2 MiB for Redis. These per-service peaks cover Linux containers in the tested Windows host. WSL, Windows, Vite and browser overhead require the separate physical-host procedure below. [Measured infrastructure usage](M10-Scalability-Evaluation.md#resources)

## Reproduction

Follow the [existing Windows setup guide](../setup/Windows-One-Click-Setup.md) in a fresh checkout or a fresh commit export. Run Setup, enable `LAUNCHER_FIXTURE=1` and `LOCAL_PROFILE_APPROVAL=1` in the new checkout's `.local/launcher.env`, then run Start. Preserve the generated identity and password. For parallel verification, choose unused loopback ports and two unused private subnets. The test used 5199 for Vite, 18012 for API, 55442 for PostgreSQL and `10.249.125.0/24` and `10.249.126.0/24` for its networks.

Run the live Topic workflow, then run the SQL and Evidence check before and after Stop followed by Start. Set `$fixtureProject` to `COMPOSE_PROJECT_NAME` in the isolated checkout's `.local/launcher.env`. Set `$refreshId` to the refresh request UUID in the Playwright output. [Live Topic workflow](M10-FYP-Core-Demo-Runbook.md)

```powershell
python -m backend.experiments.m10_verify_topic --project $fixtureProject --downloads .local/m10/topic-chromium --refresh $refreshId
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/Test-Launcher.ps1
```

## Physical 8 GB acceptance

1. Use an AMD64 Windows 11 machine with approximately 8 GB installed. Record Windows, WSL, Docker Desktop and Node versions, available disk space and physical memory. Keep the required Docker Desktop and browser processes in the measurement.
2. With one Worker, record available memory, commit usage and disk paging before Setup, after first Start and through the two-source `quick` and `detail404` scenarios. Record the peak working sets of WSL/Docker, the browser and Node, plus `docker stats` for the project. Check for OOM kills, stalled startup or an unresponsive browser.
3. Reopen a completed Request after Stop and Start and verify its downloads and capture hashes. Confirm Docker reports the same named volumes. Check that a second Start reuses the frontend.
4. Repeat with the machine's ordinary coursework software running and record observed delays and any errors. Treat a container memory limit as a container setting and record physical-host behavior separately.
