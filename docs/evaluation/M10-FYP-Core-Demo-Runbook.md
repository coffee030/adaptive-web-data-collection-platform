# M10 FYP Core Demo Runbook

## Start an isolated demonstration

Use Windows 11 AMD64, WSL2, Docker Desktop Linux Engine, Node.js 22.13+ in the 22.x series, and an available local browser. Double-click `Install-FYP-Demo-Shortcut.bat` once, then double-click **FYP Demo** on the Desktop whenever you present. The shortcut opens the configured Dashboard after all three baselines are ready. To start directly from the checkout, double-click `Start-FYP-Demo.bat`.

The existing PowerShell workflow is also available.

```powershell
.\Setup-Platform.bat -Demo
.\Start-Platform.bat -Demo
```

Open the printed Dashboard URL, normally `http://127.0.0.1:5198/`. Wait for **Synthetic Demo is ready**. Start validates and approves the bundled Profiles, submits three real Requests and verifies their results. The default Normal launcher opens on `5197` and starts with an empty catalog on a fresh installation. [Windows setup guide](../setup/Windows-One-Click-Setup.md)

## Show the default results

From **Overview**, follow **View collection requests** in the Synthetic Demo notice. Open each Succeeded Request and check its two child Jobs.

| Category | Topic | Keyword | Accepted Records |
| --- | --- | --- | --- |
| Core Demonstration | Fixture Listings | `quick` | 2 |
| Marketing Intelligence | Influencer Advertising and Sponsorship | `partnership` | 8 |
| Financial Markets | Market News and Economic Updates | `market` | 8 |

Open **Sources** to show authorization, the two different selector types and the Profile Version 1 configuration hashes. Under **Categories and topics**, view the approved topic bindings. The Marketing sources depict explicitly disclosed fictional partnerships. The financial payloads and exports carry **SIMULATED DATA — NOT LIVE MARKET PRICES**.

## Demonstrate a complete collection

1. From **Overview**, open **Collect by topic**. Select the category, topic and both Sources. Enter `quick` and select **Start topic collection**. Show the parent Request, its two child Jobs, each Profile pin and the execution events. The work shares one origin and may take several seconds.
2. After both Jobs show **Succeeded**, open **View request records**. Both carry `headline: Alpha` and `dataset: SYNTHETIC FIXTURE DATA`. Catalog also carries integer `count: 10`. Open a Record and show Source, Job, Profile Version and Evidence references. Open **Evidence Metadata** for the detail URL, capture time and content hash. Job capture evidence also lists the search response.
3. Follow **Article history** to the Article and show version 1 and its Observation. Return to the Request and select **Refresh collection**. Review the new run and the original Profile pins. When it succeeds, each Source's Article retains version 1 and gains a distinct Observation and Evidence reference. Show the previous-run link and the older Observation's extracted payload.
4. On either successful Request, download **CSV** and **JSON**. Expect two records. The JSON attachment carries typed payloads and provenance. CSV carries nested fields as JSON cells. A single child Job contains one record and has its own downloads.
5. Submit `detail404` against both Sources. Each child retains its accepted `Alpha` record, reports HTTP 404 for the failed detail and goes **Partial**. The parent shows **Partial**. Both download formats still contain two accepted records. To show validated rejection separately, use the bundled [CSV example](../demo/M5.5-dashboard-demo-runbook.md) and open its Job's **Quarantine** and Evidence.
6. Stop with `Stop-Platform.bat -Demo`, start again and reopen the original Request. Show that the Records, Article History, exports and Evidence metadata survived. Run `Diagnose-Platform.bat -Demo` to check the migration, fixture and all three baseline Requests. [Demo verification](M10-Demo-Presets-and-Launcher.md)

For the Marketing or Market topic, select both sources and use the keyword in the table to show the two search captures per Job. In Data Explorer, select fields such as `disclosure` or `price` under **Fields to Display**. For the optional financial content-change exercise, switch the internal fixture to Revision 2, then select **Refresh collection** on the Market Request. [Fixture revision commands](M10-Demo-Presets-and-Launcher.md#controlled-financial-refresh)

## Explain the engineering

- PostgreSQL persists authorized Source rules, immutable Profile Versions, Job intent and results. Database constraints tie accepted Records to Job-specific Evidence. PostgreSQL also keeps article identity, content versions and observations.
- The Dispatcher publishes due Jobs to Redis. Celery Workers execute bounded tasks. Database claim and attempt fencing protect the result transaction when delivery repeats or a Worker loses its lease. Share the observed Worker loss timeline from the [reliability evaluation](M10-Reliability-Evaluation.md).
- Source policy, destination validation, robots restrictions and Redis origin limits apply before network requests. Controlled fixtures and application data stay in the local environment.
- Show the 1/2/4 Worker results for short Jobs, substantial CSV ingestion and a shared-origin keyword search. The workload determines which waiting time or shared resource sets the pace. [Scalability evaluation](M10-Scalability-Evaluation.md)

## Automated demonstration

Use `npm ci` in `frontend`. Set `API_PROXY_TARGET` to the running isolated API origin, `LOCAL_PROFILE_APPROVAL=1`, `M4_REAL_API=1` and `M4_FRONTEND_PORT` to an unused loopback port. Set `M9_TEST_PYTHON` to a Python interpreter for CSV checks.

```powershell
cd frontend
npx playwright install chromium firefox webkit
$env:PLAYWRIGHT_BROWSER = 'chromium'
npm.cmd test -- tests/topic-collections.integration.ts --workers=1 --trace=on --output=../.local/m10/topic-chromium
```

Repeat with `firefox` and `webkit` and separate output paths. Chrome has additional axe checks in the workflow. Browser output logs contain Request, Article and Evidence IDs. The Topic suite configures the Cards Profile in the UI and uses the same application API to configure the XPath Catalog Profile. The live Core workflow exercises separate HTML, CSV, quarantine and database-outage recovery cases.

## Common failures and limits

| Symptom | Operator action |
| --- | --- |
| Setup or Start fails | Use the reported code and `Diagnose-Platform.bat`. Check the Docker Linux Engine, WSL2, dependencies and saved ports. |
| Source is missing in Collect by topic | Check authorization, Profile approval, approved binding and active category/topic. |
| Request remains pending | Check Worker readiness, Dispatcher poll logs and broker health, then inspect Job dispatch fields and events. Wait for recovery when an execution lease is still active. |
| Fixture requests return policy errors | Check fixture mode, exact origin, path prefix and `q` or `term`. Keep the Source request limits enabled. |
| Export exceeds row or byte bounds | Export by child Job, narrow the search or partition CSV input according to the existing export contract. |

The presentation uses the committed controlled fixtures. Both considered websites are unsupported for this M10 configuration. Physical 8 GB Windows and manual screen-reader acceptance remain separate checks. The trusted local mode applies to this release candidate. [FTC and New York Fed decisions](M10-Real-Website-Feasibility.md)
