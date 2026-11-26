# Harbourline

Harbourline helps Hong Kong businesses and agencies research creators, compare the evidence behind a recommendation and plan a campaign within confirmed quotes. It runs locally on the **Adaptive Scalable and Observable Web Data Collection Platform**, the reusable FYP Core for approved collection, validation and evidence. [System overview](docs/architecture/System-Overview.md)

## Start on Windows

Double-click **Start-Harbourline.bat** in the extracted release or checkout. The launcher opens the local Marketing Intelligence application. On a fresh workstation choose **Create a new company workspace**. You become its first administrator and can add colleagues from the company menu. Returning users sign in to the same company on the printed loopback URL. [Windows requirements and setup](docs/setup/Beginner-Windows-Setup.md)

Search published work from **Creator discovery** or enter a business brief in **Campaign Advisor**. Inspect the creator’s source record before saving a lead. Firm rates, audience evidence and company outcomes belong to separately authorized records. **Campaigns** keeps the brief and shortlist together. **Performance reports** accepts company-authorized channel reports and compares them with saved scenario assumptions.

**Scraping Operations** opens the operator workspace. The workstation owner unlocks it with the private local operator credential in `.local-pilot/harbourline-operator.token`. Operators manage source approvals, jobs, evidence, publication and eligible company datasets. Existing pilot installations keep their company accounts and volumes. Only an authorized operator may assign a previously unclaimed pilot dataset. [Partner data and company contracts](docs/contracts/Marketing-M2-intelligence.md)

Double-click **Stop-Harbourline.bat** to stop services and retain data. Double-click the start launcher in the same folder to reopen your work. The launcher checks Docker and the pinned local retrieval model. When model preparation fails, it reports the fallback. The frontend build identity is available at `/harbourline-installation.json`; the API serves its identity at `/api/v1/version`.

The isolated teaching environments remain available through `Start-Harbourline-Demo.bat` and `Start-FYP-Demo.bat`. Their fictional records and historical exercises have separate settings and volumes.

## Run the collection Core on Windows

Extract the release ZIP into a writable local NTFS folder, or clone the release checkout. Double-click `Start-Platform.bat` for Normal mode or `Start-FYP-Demo.bat` for the bundled Demo. Start handles the same prerequisite checks as Setup. If Windows requires a restart, run the same launcher afterward.

Use Windows 11 x64 supported by Docker Desktop, hardware virtualization, WSL 2.1.5 or newer, Docker Desktop with Linux containers and Compose 2.20 or later, and a modern browser. The target minimum is 8 GB of installed RAM. Physical 8 GB acceptance remains pending. Allow at least 10 GB free on the Docker data drive and 5 GB on the checkout drive as a starting budget, and allow internet access and installation permission for first use. Docker builds the frontend with Node.js and serves the static result. Host Node.js, npm, Python, PostgreSQL and Redis are optional developer or integration tools. [Beginner setup](docs/setup/Beginner-Windows-Setup.md)

```powershell
.\Setup-Platform.bat
.\Start-Platform.bat
.\Diagnose-Platform.bat
.\Stop-Platform.bat
```

A fresh Normal installation opens an empty Dashboard, usually at `http://127.0.0.1:5197/`. To collect from real sources, a trusted operator must explicitly enable local approval and configure and approve the sources, profile versions and topic bindings. Stop keeps your settings and data. [Windows settings and approval](docs/setup/Windows-One-Click-Setup.md#settings-data-and-the-controlled-demo)

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

The Synthetic Demo uses bundled fixtures. In a separate Normal environment, M18B verified successful Jobs and detail evidence for Welsh Government, Scottish Fiscal Commission and Economics Observatory. The FTC and New York Fed candidates were unsupported under the conditions evaluated in M10. [Shared Request evidence trace](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/M18B-Live-Multi-Source-Acceptance.md#record-to-detail-evidence-verification) · [M10 real website feasibility](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/M10-Real-Website-Feasibility.md)

## Collect by topic

1. **Set up approved sources.** In **Sources**, register and authorize each website. Choose **Keyword search and detail pages** in the profile's **Collection mode**, preview and validate a sample keyword, and approve the profile version. To keep article history, enable **Store article history** in the profile before approval.
2. **Create a category and topic.** Open **Operations → Topics & bindings**. Create a category and add a topic under it. Select the topic, open **Manage approved bindings**, and approve a binding for each source and profile version you want to use.
3. **Start a collection request.** From **Overview** or the main navigation, open **New Collection**. Select your category and topic, choose one to four approved sources, and enter a keyword. Select **Review collection**, then **Start topic collection**. Each selected source and profile pair runs as a separate job.
4. **Review results.** In the collection request, check the child job statuses and select **View request records**. Inspect an accepted record, then select **View capture evidence** to see its capture details and SHA-256. If the profile stores article history, open **Article history** to inspect versions and observations. Use a child job's **Quarantine** link to see rejected records.
5. **Export records.** After the child jobs finish, select **Download CSV** or **Download JSON** on the request page. To export a single source job, open its **Job details** and use the download buttons there.

For a direct HTML page or a CSV dataset, open **Collection Jobs → Single-source collection and CSV import**. The [example data guide](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/demo/M5.5-dashboard-demo-runbook.md) provides the settings and inputs for the bundled HTML and CSV samples.

## Record exports

- A **job export** contains the validated records persisted by one job. A **collection request export** combines the validated records from all its child jobs. Both downloads use the full scope regardless of the Data Explorer page or filters. Partial runs can export the records they accepted.
- CSV and JSON are UTF-8. CSV uses a fixed set of columns with the record payload in a JSON cell, so a single file can hold records from different profiles. JSON preserves structured fields and their types. An empty scope produces a CSV header or an empty JSON array.
- Each file can contain up to **5,000 records** and **8 MiB**. An over-limit export is rejected in full. If a request is too large, open its child jobs and download their records separately. If a job is too large, submit a new collection with a narrower search or smaller input. For CSV imports, split the source CSV into smaller imports before running the jobs.

## Documentation

- [Historical FYP evaluations, figures and acceptance evidence](docs/evaluation/Academic-Evidence.md)

- [Marketing M1 backend and research API](docs/contracts/Marketing-M1-youtube-research.md)
- [Marketing M2 intelligence, onboarding, and frontend contracts](docs/contracts/Marketing-M2-intelligence.md)
- [Topic collection and article history](docs/contracts/M8-data-identity-collection-management.md)
- [Windows setup and troubleshooting](docs/setup/Windows-One-Click-Setup.md)
- [FYP presentation runbook](docs/evaluation/M16-FYP-Presentation-Runbook.md)
- [Harbourline campaign research through MCP](docs/setup/Windows-MCP-Access.md#harbourline-campaign-research)
- [Local Codex MCP setup and presenter walkthrough](docs/setup/Windows-MCP-Access.md#four-minute-presenter-walkthrough)
