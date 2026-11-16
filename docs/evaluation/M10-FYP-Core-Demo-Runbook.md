# M10 FYP Core Demo Runbook

## Start an isolated demonstration

Use Windows 11 AMD64, WSL2, Docker Desktop Linux Engine, Node.js 22.13+ in the 22.x series, and an available local browser. Run the following from a fresh copy of the repository.

```powershell
.\Setup-Platform.bat
# In the new checkout's .local/launcher.env, enable LAUNCHER_FIXTURE=1 and LOCAL_PROFILE_APPROVAL=1.
.\Start-Platform.bat
```

Open the printed Dashboard URL. The default is `http://127.0.0.1:5197/`. If running alongside another checkout, follow the [Windows setup guide](../setup/Windows-One-Click-Setup.md) to select unused ports. The bundled fixture listens at `http://collection-fixture:8001` inside the isolated Compose network.

## Set up Sources and approved Profiles

1. Open **Sources → Create source** and select the Web adapter. Register **Demo Cards** and **Demo Catalog** separately. Use permission reference `Bundled FYP fixture` and allowed origin `http://collection-fixture:8001` for each. Enter `http://collection-fixture:8001/m7/cards` and `http://collection-fixture:8001/m7/catalog` as the respective allowed path prefixes. On each Source page, select **Authorize Source access**.
2. Under each Source, create a draft with collection mode **Keyword search and detail pages**. Enter the following selectors and output schema. Keep maximum search pages at 1 for this demonstration and the default detail limits.

| Profile setting | Demo Cards | Demo Catalog |
| --- | --- | --- |
| Record type | `article_fixture` | `catalog_fixture` |
| Selector type | CSS | XPath |
| Search path | `/m7/cards/search` | `/m7/catalog/search` |
| Keyword query parameter | `q` | `term` |
| Search result item selector | `li.result` | `//tbody/tr` |
| Detail link selector | `a.item` | `./td/a` |
| Detail item selector | `article` | `//main/dl` |
| Text field | `headline` via `h2` | `headline` via `./dt` |
| Integer field | — | `count` via `./dd` |
| Store article history | Yes, article title `headline` | Yes, article title `headline` |

3. Use sample keyword `quick`, select **Preview**, then **Validate sample**. Confirm `Alpha` and integer `10` in the applicable profile. Enter the approver label, confirm approval and select **Approve version**. Show the immutable Version 1 configuration and hash.
4. Open **Sources → Categories and topics**. Create category **FYP Demonstration** and topic **Fixture Listings**. Open **Manage approved bindings** for the topic, enter the operator name and approve one binding for each authorized Source and approved Profile.

## Demonstrate a complete collection

1. From **Overview**, open **Collect by topic**. Select the category, topic and both Sources. Enter `quick` and select **Start topic collection**. Show the parent Request, its two child Jobs, each Profile pin and the execution events. The work shares one origin and may take several seconds.
2. After both Jobs show **Succeeded**, open **View request records**. Expected payloads are `{"headline":"Alpha"}` and `{"count":10,"headline":"Alpha"}`. Open a Record and show Source, Job, Profile Version and Evidence references. Open **Evidence Metadata** to show the detail capture and content hash. Job capture evidence also lists the search response.
3. Follow **Article history** to the Article and show version 1 and its Observation. Return to the Request and select **Refresh collection**. Review the new run and the original Profile pins. When it succeeds, each Source's Article retains version 1 and gains a distinct Observation and Evidence reference. Show the previous-run link and the older Observation's extracted payload.
4. On either successful Request, download **CSV** and **JSON**. Expect two records. The JSON attachment carries typed payloads and provenance. CSV carries nested fields as JSON cells. A single child Job contains one record and has its own downloads.
5. Submit `detail404` against both Sources. Each child retains its accepted `Alpha` record, reports HTTP 404 for the failed detail and goes **Partial**. The parent shows **Partial**. Both download formats still contain two accepted records. To show validated rejection separately, use the bundled [CSV example](../demo/M5.5-dashboard-demo-runbook.md) and open its Job's **Quarantine** and Evidence.
6. Stop with `Stop-Platform.bat`, start again and reopen the original Request. Show that the Records, Article history, exports and Evidence metadata survived. The verification script independently compares the downloaded attachments to PostgreSQL and hashes actual files in the Evidence volume. [Deployment verification](M10-Deployment-Verification.md)

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

The demonstration uses the committed controlled fixtures. **External live collection is NOT VERIFIED.** No authorized public website was supplied for this evaluation. Physical 8 GB Windows and manual screen-reader acceptance remain separate checks. The trusted local mode applies to this release candidate.
