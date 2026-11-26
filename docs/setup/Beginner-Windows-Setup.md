# Start the platform on Windows

Docker packages each service with the software it needs. Docker Desktop runs those services using WSL 2, the Windows subsystem that provides a Linux environment. The build uses Node.js inside a container and publishes static Dashboard files. Your browser uses those files over loopback.

## What you need

- A supported Windows 11 x64 computer with hardware virtualization enabled, about 8 GB of RAM or more, and a modern browser.
- A writable local NTFS folder. Budget at least 10 GB free on the Docker data drive and 5 GB on the checkout drive to start. Evidence and retained images use additional space.
- Internet access for the first install and image build. Windows permission to enable WSL 2 and install or run Docker Desktop. Use Docker Desktop in Linux container mode with WSL 2.1.5 or newer and Compose 2.20 or later. [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [Microsoft WSL installation](https://learn.microsoft.com/windows/wsl/install)

## Start and stop

1. Extract the full release ZIP or clone the release checkout. If Windows blocks an unsigned script from a downloaded ZIP, verify that you obtained it from the project repository. When your device policy allows it, open the verified ZIP's **Properties**, select **Unblock**, and extract it again. Double-click `Start-Harbourline-Demo.bat` to explore fictional creator data, or `Start-Harbourline-Pilot.bat` for the private company workspace. Use `Start-FYP-Demo.bat` for the original Core teaching demonstration.
2. Review the WSL and signed Docker Desktop installation prompts if they appear. Approve Windows prompts if you have permission. Accept Docker Desktop's terms in its window. If Windows requires a restart, double-click the same launcher afterward.
3. Wait for the first build and health checks. Copy the printed `http://127.0.0.1:…` URL if your browser does not open. Start again from the same folder to reopen the same workspace.
4. Open PowerShell in the checkout. Use `.\Stop-Platform.bat -Pilot` for the private workspace or `.\Stop-Platform.bat -Demo` for the fictional workspace. You can also leave the services running and close the browser.
5. For help, run `Diagnose-Platform.bat` with the same `-Pilot` or `-Demo` switch. Use the error code and log location to find the next step. [Troubleshooting](Windows-One-Click-Setup.md#troubleshooting)

The Core teaching demonstration uses fixed local HTML fixtures for three topics. It prepares accepted Records, Evidence, Article History and CSV and JSON exports. Normal starts empty. Real Source access requires its own review and authorization. After authorizing a Source, create an extraction Profile, preview and validate it, and explicitly approve it. Publisher availability, structure and access rules can change. [Controlled Source suggestions](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/M22B-Bounded-Source-Discovery.md)

Docker stores database, queue and Evidence data in named volumes. The private settings in `.local-pilot`, `.local-demo` or `.local` connect the checkout to its volumes. Stop, keep the settings private, and back up both settings and volumes before moving or updating. To remove the checkout, stop it, verify any backups, and delete that checkout. Its named volumes can be retained independently. [Preserving and removing data](Windows-One-Click-Setup.md#stop-restart-update-and-remove)
