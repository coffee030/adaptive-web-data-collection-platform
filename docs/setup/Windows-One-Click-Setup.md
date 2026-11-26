# One-click installation and startup on Windows 11

## Get started

1. Clone or extract the repository to a local NTFS folder where you have write access.
2. Double-click `Start-Harbourline-Demo.bat` for password-free public directory research and fictional campaign practice, or `Start-Harbourline-Pilot.bat` for the private workspace. If installation is requested, review the version, source, and required permissions, then enter `YES` and confirm the system prompt.
3. The first launch downloads dependencies and builds the backend and frontend images inside Docker. After `[SUCCESS]`, the launcher opens the product in the default browser. You can also copy the URL shown.
4. Double-click the same file for later launches. The launcher reuses healthy services, dependencies, and the database. Use the printed URL to reopen the Dashboard.

| Entry point | Purpose |
| --- | --- |
| `Start-Harbourline-Demo.bat` | Opens password-free public directory research and fictional campaign practice. |
| `Start-Harbourline-Pilot.bat` | Opens the private company workspace. |
| `Start-Platform.bat` | Checks the environment, starts services, verifies health, and opens the browser. |
| `Setup-Platform.bat` | Checks and repairs prerequisites and verifies local settings. |
| `Stop-Platform.bat` | Stops owned Compose services for this checkout and retains their volumes. |
| `Diagnose-Platform.bat -Pilot` or `-Demo` | Reports the selected installation’s service state and its workspace link when healthy. Omit the switch for Core. |

For automation, use `-NonInteractive` to disable the launcher's installation consent prompt, `-NoBrowser` to prevent Start from opening a tab, and `PLATFORM_NO_PAUSE=1` to return the error exit code. In interactive runs, the batch file pauses on errors so you can read them.

## Isolated Synthetic Demo

1. Double-click `Start-FYP-Demo.bat` in File Explorer. Follow any prerequisite prompts.
2. The launcher opens the Dashboard in your default browser when all three baselines are ready. It reuses the saved Demo when you start again from the same checkout.
3. If startup fails, the launcher displays the cause, recovery steps and diagnostic log path. Wait for an ongoing startup to finish before clicking again.

The first one-click Start prepares the isolated settings and seeds the existing Demo. It prefers Dashboard port `5198` and selects an available nearby port if needed. It checks existing Docker subnets and Windows routes before choosing private subnets for the new Demo. Later launches use the saved settings and reuse the existing data. Windows prerequisite installer prompts require your approval.

Use these commands when you want to diagnose, stop, or operate the same Demo from PowerShell. Normal defaults to Dashboard port `5197`.

```powershell
.\Setup-Platform.bat -Demo
.\Start-Platform.bat -Demo
.\Diagnose-Platform.bat -Demo
.\Stop-Platform.bat -Demo
```

Demo Setup validates Windows prerequisites, project ownership and bundled fixture files. Start checks the saved ports and builds missing images. Allow first-run access to Docker Hub and the build package registries. The presets collect exclusively from the bundled fixture service.

Demo uses `.local-demo/launcher.env` with its own protected credentials and identity. Its loopback API and PostgreSQL ports default to `58098` and `55498`. If a port is occupied, Stop the Demo and change the relevant port in the Demo file. If Docker's default pools are exhausted and the Demo networks have yet to be created, inspect Docker and Windows/VPN routes and add two unused RFC 1918 `/24` values as `LAUNCHER_SUBNET` and `LAUNCHER_FIXTURE_SUBNET`. Keep the project name, owner and credentials.

Find Demo diagnostics at `logs/launcher/demo/latest.log`. `DEMO-001` identifies missing bundled files. `DEMO-002` identifies incomplete or conflicting presets. Fix the reported cause and Start again. Use `Start-Platform.bat -Demo -DemoRetry` to create a replacement for a terminal failed or partial baseline. Earlier Requests and Evidence remain available.

Keep the Demo settings and its PostgreSQL, Redis, Evidence and `demo_state` volumes together for backup and restore. Use the Normal commands to operate the Normal project. [Demo architecture and expected results](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/M10-Demo-Presets-and-Launcher.md)

## Prerequisites and permissions

- Use supported Windows 11 x64, built-in Windows PowerShell 5.1, Docker Desktop in Linux container mode, Docker Compose 2.20 or later, and WSL 2.1.5 or later. Startup checks the Windows build, CPU architecture, WSL, virtualisation, and available RAM and disk space where measurable. See Docker's documentation for supported builds and minimum memory and WSL requirements. [Docker Desktop installation for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
- Normal and Demo use a Docker-built React bundle. PostgreSQL, Redis, Python and Node.js run inside the images required for ordinary startup. Allow first-run internet and budget at least 10 GB on the Docker data drive and 5 GB on the checkout drive.
- If Docker Desktop is missing, the approved installation downloads it from Docker, verifies a valid Authenticode signature and the Docker publisher, and starts the installer with the WSL 2 per-user option. Review and handle licensing, initialisation, and permission prompts in Docker Desktop.
- When the WSL 2 check fails, review and run `wsl --install --no-distribution` or `wsl --update`. Windows may require administrator approval and a manual restart. Double-click the same launcher when Windows is ready. If firmware virtualisation is disabled, follow the device manufacturer's instructions for enabling Intel Virtualization Technology or AMD SVM Mode in BIOS/UEFI. [Microsoft WSL installation guide](https://learn.microsoft.com/windows/wsl/install)
- The computer's PowerShell and organisational policies apply. If a download triggers a trust block, obtain the repository again from a trusted source or follow the school's approved script trust process.

## Settings, data, and the controlled demo

After the prerequisites pass, the first Setup or Start generates `.local/launcher.env`. A restricted Windows ACL protects the file, which stores a random local PostgreSQL password and a Compose project identity specific to the checkout. Retain the file and original volumes to reuse Sources, Profiles, Jobs, Records, Redis, and Evidence. Keep the file private and out of Git and chat.

| Setting | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_PORT` | `5197` | Dashboard HTTP port. |
| `API_PORT` | `58097` | Direct FastAPI host port for integrations. The Dashboard uses the internal API service. |
| `POSTGRES_PORT` | `55497` | PostgreSQL host port. The container uses 5432. |
| `LAUNCHER_FIXTURE` | `0` | Set to `1` to start the existing controlled HTML fixture on an internal Docker network. |
| `LOCAL_PROFILE_APPROVAL` | `0` | Explicitly set to `1` if you trust the current Windows account and the local development environment. |
| `LAUNCHER_SUBNET`, `LAUNCHER_FIXTURE_SUBNET` | Selected by Docker | If Docker address pools are exhausted, supply two available RFC 1918 IPv4 `/24` subnets. |

Stop first, edit the supported settings in a text editor, save, and start again. Keep the other settings at their original values. The Dashboard, API and PostgreSQL are bound to `127.0.0.1`. Redis stays on the Docker network. Nginx uses the Dashboard authority and requires a matching loopback Origin for browser Profile approval and binding actions. FastAPI retains its own Host and Origin checks. Source authorisation and Profile Version approval still require separate actions. The operator supplies the operator label.

For a fresh controlled HTML or CSV demo, run `Setup-Platform.bat` to create the settings. Before the first Start, set `LAUNCHER_FIXTURE=1`, `LOCAL_PROFILE_APPROVAL=1`, and available ports. The demo guide also includes manual Compose startup. [M5.5 controlled demo](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/demo/M5.5-dashboard-demo-runbook.md)

Existing manual environments retain their own `.env` and Compose projects. Start them using the M5 runbook. To move a launcher, stop the old checkout, privately save the entire `launcher.env`, verify that the destination Docker Engine has the original volumes for that identity, and restore the file to the ACL-restricted `.local` directory. For a manual database without an ownership label, use the original environment to read and back up the data. Ask the team to check the schema and arrange import. [M5 Demo Runbook](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/demo/M5-core-demo-runbook.md)

## Stop, restart, update, and remove

- Run `Stop-Platform.bat -Pilot` for the company pilot or `Stop-Platform.bat -Demo` for the demo. Use `Stop-Platform.bat` for Core. Docker Compose checks ownership before stopping services. Reopen the original launcher to resume that workspace.
- Before updating, stop the launcher and back up the settings, PostgreSQL, and Evidence. Update the repository and run Setup and Start. The launcher rebuilds images when their source or build settings change and checks the Alembic migration head. If migration fails, keep the volumes and check diagnostics.
- Before backing up, write down the project name from the private settings. Take a logical backup of PostgreSQL on the same Docker Desktop Engine and back up `<project>_evidence_data` separately. Save the Redis volume as well if you need to restore queue state. Use a restricted folder and verify the restore in an isolated test environment.
- To remove the launcher, stop it, check your backups, and delete the checkout. You can retain the Docker named volumes and reconnect them later with the original settings. Ask the computer administrator to consider the effect on other projects and backups before clearing Docker CLI or Docker Desktop data.

## Troubleshooting

Run `Diagnose-Platform.bat -Pilot` or `Diagnose-Platform.bat -Demo` and open the report shown. Each workspace keeps its latest report under `logs/launcher/pilot` or `logs/launcher/demo`. For Core, run `Diagnose-Platform.bat` and open `logs/launcher/latest.log`. The reports include service states, health checks and recovery steps.

| Error | Recovery |
| --- | --- |
| `ENV-003` / `ENV-004` | Check BIOS/UEFI virtualisation, the WSL version, Windows Virtual Machine Platform, and any pending restart. |
| `ENV-005`–`ENV-008` | Open Docker Desktop and complete its prompts, then check Linux containers, WSL 2, and Compose. Contact IT if school policy blocks access. |
| `NET-001`–`NET-003` | Check the reported port and PID if available. After Stop, change the corresponding port to an unused value between 1024 and 65535. |
| `NET-004` | Use `docker network ls` and `docker network inspect` to review Docker subnets, and `Get-NetRoute -AddressFamily IPv4` to check Windows and VPN routes. Set private, non-overlapping `/24` values in the subnet settings above. Review any change to an existing network's subnet manually. |
| `DB-004`–`DB-006` | Check PostgreSQL and Redis health, volume permissions, existing credentials, and migration status. Retain the original settings and volumes. |
| `SVC-001`–`SVC-005` | Check network access for builds and container states. The launcher makes up to one restart attempt each for a failed Redis service or Celery worker. |
| `WEB-003`–`WEB-005` | Check the frontend container, the same-origin proxy, the browser or the configured port. If a verified previous host frontend is still stopping, close its tabs and retry. |

When Windows CIM is available, the report can include physical RAM and virtualisation data. Disk checks cover the checkout drive and the default Docker Desktop installation drive. Check capacity for custom Docker data locations in Docker Desktop. Follow the release procedures for fresh Windows installation and physical 8 GB acceptance. [Acceptance evidence](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/Final-Core-Readiness.md)

## Optional frontend development

Use Node.js 22 with npm for React development. Run the backend through the launcher or a dedicated Compose project, then set the proxy target to its direct API port. Use another loopback port for Vite. Ordinary Start and Stop continue to manage the container frontend.

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:58097'
npm.cmd ci --prefix frontend
npm.cmd run dev --prefix frontend -- --host 127.0.0.1 --port 5174 --strictPort
```

Set `LOCAL_PROFILE_APPROVAL=1` in that PowerShell session only for trusted local operator workflows. Vite's development boundary requires the matching same-origin loopback request.
