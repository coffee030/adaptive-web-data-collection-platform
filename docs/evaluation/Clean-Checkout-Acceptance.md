# Clean-checkout acceptance

Record the commit SHA, runner or machine, Windows/WSL/Docker versions, checked mode, start times, and which installer or build caches were available. Keep logs and raw test data in the disposable evaluation checkout.

## Hosted release gate

The Compose job in [Core release verification](../../.github/workflows/pull-request.yml) starts from a fresh GitHub Actions checkout. It selects three random Compose project identities and reserves distinct loopback ports that remain fixed across restart. It runs a no-cache application build, migrates a fresh volume, exercises the production proxy and records startup, disk and container statistics. It provisions and verifies the three Demo requests, runs MCP discovery and replay-safe submission, stops and restarts the stack, checks persisted presets and runs the Worker and browser suites. Separate projects supply the controlled M22B reference endpoints and the empty Normal Dashboard. Base image cache on the Docker runner may be available. The required tests use bundled fixtures.

To repeat on an isolated Linux Docker test host, install the CI test dependencies into dedicated environments as shown in the workflow and run `bash scripts/release-compose.sh`. The job removes its three disposable projects and their volumes. Inspect the workflow log for results and resource samples.

## Windows procedure

1. Export the release SHA to a new local NTFS folder, preferably a path containing a space and non-ASCII characters. Use a fresh clone or extract a `git archive` ZIP. Leave all previous settings, images scoped to older projects, databases and generated frontend files in their original locations. Base-image cache may remain. For installation acceptance begin with WSL and Docker Desktop absent.
2. On the first launch use the actual batch entry point. Record WSL consent, UAC, restart and Docker Desktop prompts and run the same launcher after any restart. Verify that the printed browser URL opens. For a physical cold build, do the automated run below in a second fresh extraction.
3. In the fresh automation checkout run the Windows acceptance script. It stops and restarts the isolated Demo, verifies the three seeded Requests, reads events and Evidence, checks capture digests and compares exported data. Keep its timing and resource files. Report each phase that does not complete.

```powershell
powershell.exe -NoProfile -File scripts/windows/Test-ReleaseAcceptance.ps1 -NoCache
```

4. Use a separate disposable Normal checkout. Run Setup, Start, Diagnose and Stop. Verify the first Dashboard is empty and that both browser and direct API health succeed. Repeat Start and Stop. Record any stuck containers for that project's identity. Confirm that `node.exe` and `npm.cmd` are unavailable for the Node-free run.
5. With the controlled M22B fixture, select an approved Source, try a keyword form and an example fallback, apply and undo a suggestion, then create a draft explicitly. Preview, validate and approve the exact matching version and report. Record that only the explicit actions persisted. Verify Pending Source rejection and request count reporting. Use the [M22B reference setup](M22B-Bounded-Source-Discovery.md) and the release browser test for deterministic coverage.
6. In Demo, open a seeded topic and submit a new request to both of its Sources. Observe the child Worker Jobs, accepted Records, events and separate Quarantine view. For quarantine creation, use the controlled partial-CSV case in `frontend/tests/results.integration.ts`. Compare CSV and JSON, inspect Evidence and confirm its persisted digest, and follow Article History. Repeat after Stop and Start and compare IDs and hashes. If testing MCP, use the direct loopback API and follow the [controlled submission walkthrough](../setup/Windows-MCP-Access.md).
7. Run Diagnose while stopped. Confirm the created projects have no running containers and unrelated projects are unaffected. Keep the disposable checkout and volumes for evidence review, or remove only those projects after checking their saved names and backups.

The [final matrix](Final-Core-Readiness.md) records the observed release results.

## Observed outcome

The [hosted run](https://github.com/coffee030/adaptive-web-data-collection-platform/actions/runs/44793217466) passed all three Compose projects. It verified both exports and the persisted Demo after Stop and restart, exercised approved Reference onboarding, and checked the empty Normal Dashboard without the fixture service. The same run verified controlled MCP submission and Worker recovery. In the original fresh Windows ZIP check, Diagnose completed and Setup reported `ENV-004` before any Docker services could start.

### Post-merge Windows check

On 21 November 2026, a fresh archive of `2f9ae4e` ran the no-cache Demo acceptance from a writable NTFS path with spaces and Unicode. The x64 Windows 11 Pro 25H2 host (build 26200.9974) had hardware virtualization, 15.82 GiB RAM and 198.7 GiB free on the drive shared by the checkout and Docker. WSL 3.0.5 was already installed with WSL 2 as the default. Docker Desktop 4.99.0 was installed per user and ran Linux Engine 29.9.3 with Compose 5.7.0. Node.js and npm were absent from the launcher's `PATH`.

The original first build could find `docker.exe` but failed to find its credential helper in the same shell. After the launcher added the CLI directory to the Docker subprocess's `PATH`, the no-cache build, migration, health checks, Demo verification, Stop, restart, repeated Start and Diagnose passed. The three baselines yielded six Jobs, 18 accepted Records and 28 verified Evidence captures. CSV and JSON matched the persisted Records, and the Evidence checks passed again after restart.

The Demo and separate Normal batch entry points handed their loopback URLs to the default browser. Chrome rendered the containerized Overview, and both the same-origin API proxy and direct API returned healthy responses in each mode. Normal started with no Sources or collection requests and reused its six containers on repeated Start. The live MCP smoke in Demo passed discovery, a two-Source submission, replay, persisted Records and Evidence lineage. Each mode used its own Compose project and kept its volumes after Stop.

Setup took 3.4 s, the no-cache build 94.4 s and first Start 108.1 s including Demo. The launcher log recorded 5.5 s from the migration step to Alembic head verification, 17.8 s from that step to Demo provisioning, and 52.5 s for Demo provisioning and verification. Stop took 5.6 s, restart 32.7 s and repeated Start 12.7 s. CSV, JSON and Evidence checks took 3.1 s, 3.1 s and 1.3 s respectively.

Sampled memory peaked at 123.0 MiB for the API, 119.2 MiB for the Worker and 15.6 MiB for the frontend. The highest concurrent total was 387.2 MiB across the six services running during seed. With all seven services running, the peak was 375.5 MiB during CSV export. Sampled CPU peaked at 89.85% for the Worker and 31.79% for the API. PostgreSQL, Evidence and Demo state occupied 48,620 KiB, 340 KiB and 8 KiB respectively. These are Docker container samples from this host. The [physical 8 GB procedure](Physical-8GB-Acceptance-Procedure.md) remains pending.
