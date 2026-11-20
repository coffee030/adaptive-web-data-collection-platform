# Clean-checkout acceptance

Record the commit SHA, runner or machine, Windows/WSL/Docker versions, checked mode, start times, and which installer or build caches were available. Keep logs and raw test data in the disposable evaluation checkout.

## Hosted release gate

The Compose job in [Core release verification](../../.github/workflows/pull-request.yml) starts from a fresh GitHub Actions checkout. It selects two random Compose project identities with dynamically allocated loopback ports. It runs a no-cache application build, migrates a fresh volume, exercises the production proxy and records startup, disk and container statistics. It provisions and verifies the three Demo requests, runs MCP discovery and replay-safe submission, stops and restarts the stack, checks persisted presets and runs the Worker and browser suites. The second project supplies the controlled M22B reference endpoints. Base image cache on the Docker runner may be available. No public publisher is a required dependency.

To repeat on an isolated Linux Docker test host, install the CI test dependencies into dedicated environments as shown in the workflow and run `bash scripts/release-compose.sh`. The job removes only its two disposable projects and their volumes. Inspect the workflow log for results and resource samples.

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
