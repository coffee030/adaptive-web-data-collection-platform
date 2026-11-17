# Adaptive Web Data Collection Platform

A local dashboard for collecting structured records from approved websites and CSV inputs. Organize website searches by category and topic, track each source job, and download validated records with their provenance.

This is a higher diploma final-year project. The current version runs on a trusted local machine and supports approved HTTPS keyword search, controlled HTML sources, and allowlisted CSV inputs. The repository includes controlled sample data.

## Quick start on Windows

You’ll need Windows 11 with WSL 2, Docker Desktop running in Linux container mode, and Node.js 22.13 or later in the 22.x series.

```powershell
git clone --branch main https://github.com/coffee030/adaptive-web-data-collection-platform.git
cd adaptive-web-data-collection-platform
.\Setup-Platform.bat
.\Start-Platform.bat
.\Diagnose-Platform.bat
.\Stop-Platform.bat
```

A fresh Normal installation opens an empty Dashboard at [127.0.0.1:5197](http://127.0.0.1:5197/). Stop keeps your settings and data.

### Synthetic Demo

Double-click `Start-FYP-Demo.bat` in File Explorer. The launcher checks prerequisites, starts the isolated Demo, verifies its three presets and opens the Dashboard in your default browser.

The PowerShell commands for operating the same Demo are available as well.

```powershell
.\Setup-Platform.bat -Demo
.\Start-Platform.bat -Demo
.\Diagnose-Platform.bat -Demo
.\Stop-Platform.bat -Demo
```

Open the printed URL, normally [127.0.0.1:5198](http://127.0.0.1:5198/). The first successful Start prepares three fictional topics with 18 validated Records, verifiable Evidence, Article History and CSV/JSON downloads. Demo has its own settings and Docker volumes. [Presentation walkthrough](docs/evaluation/M16-FYP-Presentation-Runbook.md)

FTC and New York Fed collection is unavailable in this release. Public website review and opt-in eligibility are documented separately. [Real website feasibility](docs/evaluation/M10-Real-Website-Feasibility.md)

## Collect by topic

1. **Set up approved sources.** In **Sources**, register and authorize each website. Choose **Keyword search and detail pages** in the profile's **Collection mode**, preview and validate a sample keyword, and approve the profile version. To keep article history, enable **Store article history** in the profile before approval.
2. **Create a category and topic.** Open **Operations → Topics & bindings**. Create a category and add a topic under it. Select the topic, open **Manage approved bindings**, and approve a binding for each source and profile version you want to use.
3. **Start a collection request.** From **Overview** or the main navigation, open **New Collection**. Select your category and topic, choose one to four approved sources, and enter a keyword. Select **Review collection**, then **Start topic collection**. Each selected source and profile pair runs as a separate job.
4. **Review results.** In the collection request, check the child job statuses and select **View request records** to see accepted records from the run. A record links to its lineage and capture evidence. If the profile stores article history, open **Article history** to inspect versions and observations. Use a child job's **Quarantine** link to see rejected records.
5. **Export records.** After the child jobs finish, select **Download CSV** or **Download JSON** on the request page. To export a single source job, open its **Job details** and use the download buttons there.

For a direct HTML page or a CSV dataset, open **Collection Jobs → Single-source collection and CSV import**. The [example data guide](docs/demo/M5.5-dashboard-demo-runbook.md) provides the settings and inputs for the bundled HTML and CSV samples.

## Record exports

- A **job export** contains the validated records persisted by one job. A **collection request export** combines the validated records from all its child jobs. Both downloads use the full scope regardless of the Data Explorer page or filters. Partial runs can export the records they accepted.
- CSV and JSON are UTF-8. CSV uses a fixed set of columns with the record payload in a JSON cell, so a single file can hold records from different profiles. JSON preserves structured fields and their types. An empty scope produces a CSV header or an empty JSON array.
- Each file can contain up to **5,000 records** and **8 MiB**. An over-limit export is rejected in full. If a request is too large, open its child jobs and download their records separately. If a job is too large, submit a new collection with a narrower search or smaller input. For CSV imports, split the source CSV into smaller imports before running the jobs.

## Documentation

- [Topic collection and article history](docs/contracts/M8-data-identity-collection-management.md)
- [Windows setup and troubleshooting](docs/setup/Windows-One-Click-Setup.md)
- [Example data and manual Docker Compose setup](docs/demo/M5.5-dashboard-demo-runbook.md)
- [Development and testing](docs/demo/M5-core-demo-runbook.md)
- [MVP release readiness](docs/evaluation/M16-Release-Readiness.md)
- [FYP presentation runbook](docs/evaluation/M16-FYP-Presentation-Runbook.md)
