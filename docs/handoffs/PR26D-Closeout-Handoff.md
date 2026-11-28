# PR26 Stage D verification closeout handoff

28 November 2026 (Hong Kong). **Full Compose release gate: BLOCKED.** Starting Docker Desktop restored the local Linux engine and container execution. The host still lacks a suitable Linux/Bash runner that can reach the Compose-published loopback ports. The complete maintained release script remains outstanding. This package is ready for independent closeout review of the diagnostics and source identity. [Acceptance record](../verification/PR26-Acceptance.md)

## Source and scope

| Item | Verified state |
| --- | --- |
| Repository | `coffee030/adaptive-web-data-collection-platform` |
| Author checkout | `C:/Users/noob/Downloads/ITE4116M_Final_Year_Project/Adaptive-Web-Data-Collection-Platform-PR26A` |
| Branch and HEAD | `codex/pr26-research-clarity` at `7cdeea8fe2cd749b8a3e79aaeb87707b66659223` |
| Starting and diagnosed Git tree | `ba94d64b581f5df7ae17f00f9f2bf05ea46f0855` |
| Accepted D ZIP SHA-256 | `06cf3ad77554e66a229a4f9c26ee039b879883eb6328bb209333e557971111c4` |
| Accepted `PR26D_FULL.patch` SHA-256 | `3e4f954511e7996350dae3b2e79471d2eba53abdb72de359684b2145b06c54c2` |
| Historical D handoff SHA-256 | `db7479dd374f23c6af79aff758a869e87e2a4eebcbd59beb527e2f377f24dcde` |
| Migration | Accepted source head `0034`. No closeout database migration ran. |

The starting author checkout contained accepted tracked and untracked A–D changes. The complete inventory is in `verification/baseline-status.txt`. A clean disposable checkout reconstructed from the base plus the accepted full patch matched the author worktree, including its untracked files. The accepted ZIP passed CRC checks and all 97 manifest-listed raw sizes and hashes matched. The historical D handoff matched its standalone and archived copies. The independent review Markdown was available. The separate review ZIP was unavailable in the supplied locations. `verification/reference-files.txt` records the available attachment identities.

The only closeout delta is this handoff and a dated section in `docs/verification/PR26-Acceptance.md`. Existing handoffs retain their accepted bytes. No test, application, migration, release selection or evidence-export code changed. The handoff and matrix additions were made after diagnostics. The external package manifest declares the final complete tree.

## Engine and runner diagnosis

The diagnostics ran on the Windows 11 host, build `10.0.26200.9974`, with WSL 3.0.5.0 and kernel 6.18.58.1. The Docker client and Linux server reported 29.9.3, Compose reported v5.7.0, and the installed Desktop reported 4.99.0 (245822). The active local context was `desktop-linux`, targeting `npipe:////./pipe/dockerDesktopLinuxEngine`. The accepted Linux CI job uses Ubuntu 24.04, Python 3.12, Node 22, Google Chrome and a separate Linux MCP virtual environment.

| Check | Actual outcome | Closeout ZIP evidence |
| --- | --- | --- |
| Initial `docker --context desktop-linux version` | Exit 1, missing Linux engine named pipe. Docker client and Compose binaries were present. | `verification/host-preflight.json` |
| `docker desktop start --timeout 45` | Exit 0. A subsequent status check showed `running` and the version and info commands confirmed a Linux/amd64 server. | `verification/docker-start.txt`, `verification/docker-after-start.txt` |
| `docker --context desktop-linux run --rm --pull=never --network none redis:7.4.8-alpine --version` | Exit 0 using the cached project image. The engine executed a Linux container. | `verification/linux-container-preflight.txt` |
| First test-listener probe | The fixture exited before port inspection. An isolated repro showed the cached Redis image’s BusyBox lacks the `httpd` applet (127). The corrected probe used Redis itself, with loopback publication and temporary storage. | `verification/linux-container-preflight.txt`, `verification/linux-runtime-checks.json` |
| Corrected loopback probe | Docker published the disposable Redis container to `127.0.0.1:58312`. Windows got `+PONG`. A second Linux container using `--network host` got connection refused at that same loopback endpoint (exit 1). | `verification/linux-loopback-probe.txt` |
| `wsl.exe --list --all --verbose` and read-only tool check | Only `docker-desktop` was registered. Its internal environment had no Bash, Python, Node, Chrome, curl or OpenSSL. The npm entry pointed to the Windows installation. | `verification/linux-runtime-checks.json` |
| `bash -n scripts/release-compose.sh` | Exit 0 on the normalized accepted checkout using Windows Git Bash 5.2.37. This was syntax validation. | `verification/linux-runtime-checks.json` |

The loopback failure belongs to the tested Linux runner route. The original missing-daemon problem is resolved. The host does not provide a supported source runner with the required Linux toolchain and verified loopback access. The diagnostics stayed within the installed environments. No machine-wide settings were changed.

## Maintained gate and cleanup

The pending command is `bash scripts/release-compose.sh`, from the root of a verified Linux checkout. The closeout did not invoke it because the runner preflight failed. It has no closeout exit code, section counts or Playwright JSON report. The older exit 1 caused by the missing daemon is retained as historical evidence under `verification/prior-d/`.

| Maintained section | Closeout status |
| --- | --- |
| Compose configuration, build-context checks and application images | Not run |
| Migration upgrade and head check, service startup | Not run |
| Container-served frontend, API forwarding, access boundaries, static and license checks | Not run |
| Controlled demo provisioning and verification, MCP release smoke | Not run |
| Stop/restart, repeat startup, continuity and recovery, demo browser contracts | Not run |
| Worker attempt attribution through restart | Not run |
| Manual and assisted onboarding, empty Normal workspace | Not run |
| Company pilot browser selection and report guard | Not run |
| Release gate cleanup trap | No Compose projects were created in closeout |

Both probe fixtures used generated labels and automatic removal. The corrected Redis probe used temporary storage. The final Docker query for the closeout label found zero remaining containers, and the probes did not create persistent volumes or project networks. Docker Desktop remains running. The accepted setup still uses the script’s generated project identities, collision checks, separate demo/reference/normal stacks, and owned-resource cleanup.

The prior D Vite/API run’s 16 company tests, including nine preparation cases, and the independent review’s 17 harness checks remain historical. No unrelated suites were rerun. This closeout did not add evidence for T01–T18, mutate migration 0034 or change the evidence boundaries on T11 refresh causality and T14 controlled allocation presentation.

## Resume the required gate

Provide a supported Linux development runner with a local Docker engine that can execute containers and serve Compose-published ports on `127.0.0.1` from that runner. A general-purpose WSL2 distribution with working Docker integration or an existing Ubuntu 24.04 runner satisfies the platform choice once the toolchain and loopback checks pass. Prepare native Python 3.12, Node 22 and Chrome, install `backend/requirements.txt`, run `npm ci --prefix frontend`, and install `mcp_access/requirements.txt` into `.venv/mcp`. Confirm `.venv/mcp/bin/python` and set `PLAYWRIGHT_CHANNEL=chrome`.

Reconstruct and verify the source using `RECONSTRUCT.md` in the ZIP. Keep evidence logs outside the Docker build contexts and disposable projects. Run the maintained script with complete readable stdout/stderr and record its exit including cleanup. Capture a redacted summary directly from its temporary company Playwright report before cleanup, including failed runs if a report exists. Preserve the four-file selection, existing skip enforcement and the npm and Node guard failure statuses. Confirm cleanup of only the run’s owned resources.

The archive includes the complete binary-capable patch, the closeout-only delta, the byte-verified accepted D patch, relevant source bytes, evidence, inventories and a raw size/SHA-256 manifest. Reconstruction was checked through both clean routes with strict whitespace verification. The standalone and archived closeout handoff are identical. Further work awaits independent review and a suitable runner.

## Additional closeout evidence from the managed Windows session

The host-side logs above were found in a concurrent documentation-only closeout while preparing this package. Its original archive (SHA-256 `67871757f4a7e72f3f700c5f4d1e3a97ea50869c604868a20faf775babdcfc10`) and standalone handoff were preserved at their original location. The intermediate documentation tree was `fbdb458d4fbd31349512738af588ccb14170b7de`. The combined package carries both sets of diagnostics. Its final tree is in `MANIFEST.json`, outside the source tree.

A second, private-index snapshot of the original author checkout included 21 tracked modifications and 25 untracked files at the base HEAD. Both that snapshot and a clean replay of the verified 546187-byte D patch produced `ba94d64b581f5df7ae17f00f9f2bf05ea46f0855`. All runtime probes and configuration checks targeted the accepted implementation. The two final documentation paths contain the full closeout delta.

| Additional check | Observed in the managed session |
| --- | --- |
| Local engine access | Windows Docker client 29.9.3 and Compose v5.7.0 identified `desktop-linux`. Client/server inspection and a no-pull, uniquely named, self-removing probe received permission denied on its named pipe. The probe created no container. The host-side records above independently establish that Docker Desktop was running. |
| Local startup from the restricted caller | `docker desktop start --timeout 20` failed during registry lookup. Launching the installed executable directly returned child exit 1. This session could not use the engine through either route. |
| Launch of the maintained script | `wsl --cd <verified source> --exec bash scripts/release-compose.sh` returned `Wsl/E_ACCESSDENIED`. Windows reported 4294967295 (signed −1) for the WSL launcher. Bash never started, so the script has no exit code or cleanup status. |
| Additional configuration checks | The actual Windows Compose client validated the three stack definitions with `config --quiet`, an empty env file and disposable settings. Each command exited 0. Docker build-context and image checks remain outstanding. |
| Runtimes and test population | Windows Python 3.12.16 and Node 22.18.0 were present. No native Linux project dependencies were prepared in this session. Zero container-served cases executed. Pass/fail/skip counts are unavailable. |

`verification/host-transcript.txt` and the individual JSON transcripts preserve the managed-session command lines, working directories, timestamps and separate output streams. The closeout outcome is under `verification/gate-outcome.json`. The host runner’s first listener-probe capture omitted part of its stderr; `verification/evidence-capture.md` records the missing lines and the corrected probe. No gate report existed in either session. `verification/company-cases.tsv` pairs the earlier Vite/API report’s individual names and statuses with their current unexecuted status. The earlier selection comprised five campaign, nine preparation, one first-party-window and one market-sources case. No product or test-harness correction was indicated.

The project handoff, standalone copy and ZIP handoff are byte-identical. Both final patch routes were replayed from the original base. The package also includes the dated independent review Markdown. Retrieval of the optional independent review ZIP failed at DNS resolution. The pending action is to run the complete gate in a general-purpose local Linux environment with Docker access and working loopback publication. The verification disposition remains **BLOCKED** pending that run and its independent review.
