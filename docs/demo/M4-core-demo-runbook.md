# M4 Core MVP Demo Runbook

Use the local React Console with controlled HTML and CSV. You need Docker Desktop in Linux container mode, Docker Compose, Node.js (the project verified 22.18.0), npm, and Chrome or Playwright Chromium. Open two PowerShell windows at the repository root.

## 1. Start isolated services

Use free ports. Keep the password in this PowerShell session. To reopen the same data later, use the original project and database password.

```powershell
$env:POSTGRES_USER = 'collection_test'
$env:POSTGRES_DB = 'collection_m3_test'
$env:POSTGRES_PASSWORD = [Guid]::NewGuid().ToString('N')
$env:POSTGRES_PORT = '55450'
$env:API_PORT = '58018'
$demoProject = 'collection-m3-test-demo-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$composeArgs = @('-p', $demoProject, '-f', 'compose.yaml', '-f', 'compose.fixture.yaml')
docker compose @composeArgs up -d --wait postgres redis
docker compose @composeArgs build api
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --wait
Invoke-RestMethod http://127.0.0.1:58018/api/v1/health
```

If containers have started but the host port is not ready, wait for the API to return `{"status":"ok"}`. The schema head at this milestone was `0006`. Keep database settings in the same shell for the later restart.

Start the console in a second PowerShell window.

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:58018'
$env:LOCAL_PROFILE_APPROVAL = '1'
npm.cmd run dev -- --port 5194 --strictPort
```

Open Collection Jobs. The Compose fixture is internal, and React reaches it through FastAPI. Work on loopback as a trusted operator for the following steps. [Collection Jobs](http://127.0.0.1:5194/collection-jobs)

## 2. Register and authorise Sources

1. Select **Sources → Create source**. Create separate HTML and CSV Sources with distinct names. You can use `FYP controlled fixture` as the **Permission reference** for both.
2. For HTML, select **Controlled web** and enter `http://collection-fixture:8001` under **Allowed origins**. For CSV, select **CSV** and enter `listings` under **Allowed dataset IDs**.
3. After submission, confirm **Access authorization** is **Pending**. Run the following terminal step as a trusted operator. Find the Source ID under **Access policy**.
4. Run this once per Source. Reload Source detail and confirm **Approved**.

```powershell
$sourceId = '<Source ID from the console>'
$sourceApi = "http://127.0.0.1:58018/api/v1/sources/$sourceId"
Invoke-RestMethod -Method Patch -Uri "$sourceApi/authorization" -ContentType 'application/json' -Body '{"approval_status":"approved"}'
```

## 3. Configure, preview, validate, and approve

Select **Create draft** from each Source. Use `listing` for Record type and `key` for Identity field. Keep all output fields below required.

| Source | Profile configuration | Validation input |
| --- | --- | --- |
| HTML | Selector type CSS, Item selector `#entries tr`. For output `title`, select `a` and Text. For `key`, select `a` and Attribute `data-code`. | Select the allowed origin and use Document path `/table.html`. |
| CSV | Map `key`, `title`, and `count` to `Key`, `Name`, and `Count` respectively. Set `count` to integer. | Dataset ID `listings`. Paste the clean sample below. |

```csv
Key,Name,Count
a0,Sample,1
```

Select **Create draft**. To show an edit, change Record type to `listing_item` and select **Save draft**. Enter the sample, then select **Preview** and **Validate sample**. Preview displays extracted data. Wait for **Validation passed** before approval. Under **Approval review**, enter the approver label, review the report, check the confirmation box, and select **Approve version**. The page becomes read-only.

To demonstrate why approval can be unavailable, validate the original CSV fixture from the next section. It shows **Validation failed**. Restore the clean sample, revalidate, and approve.

## 4. Submit Jobs and trace results

1. From the approved Profile, select **New Collection Job**. Check the Source and selected Profile Version.
2. For HTML, select the allowed origin and enter `/table.html`. For CSV, select `listings` and paste the fixture from the command below into **CSV content**. This fixture demonstrates partial success.
3. Select **Submit job**. A successful reply opens **Job Details**. Stay on the page to observe persisted status and execution events. For quick Jobs, Running may only be visible in the `CLAIMED` event. You can also select **Refresh job**.
4. HTML should show **Succeeded**, Valid 2, Invalid 0, and Duplicates 0. Select **View job records** and open a Record.
5. CSV should show **Partial**, Valid 2, Invalid 3, and Duplicates 1. Under **View quarantine**, check physical start lines 5, 6, and 7 and `required_field`, `wrong_type`, and `invalid_row`.
6. Open **Evidence Metadata** from Record or Quarantine. Check the capture, backend SHA-256, Source, and Profile. Follow links back to Job, Source, and approved version. Backend storage handles raw Evidence checksum verification.
7. **Job Details → Capture evidence** also opens saved metadata. Use it for failed Jobs that captured data without producing candidates. If the Job saved no capture, the section displays an empty state.

From the repository root, copy the committed fixture to the clipboard.

```powershell
Get-Content -Raw -Encoding utf8 -LiteralPath 'backend/tests/fixtures/m1/listings.csv' | Set-Clipboard
```

## 5. Troubleshooting and safe shutdown

| Observation | Action |
| --- | --- |
| Backend unavailable | Check `/api/v1/health`, Compose status, and Vite's `API_PROXY_TARGET`. Select Retry after service recovers. |
| Submit Job unconfirmed | Stay on the form. After the API recovers, select **Retry submission**. The service uses the same key to check for an existing Job. |
| Create Source unconfirmed | Keep the form and resend the same values after service recovery. Replay with the same request key finds the original Source. |
| Draft save conflict | Keep unsaved field content. Review or copy edits to retain and then confirm **Reload server version**. Reapply the needed edits after the new version loads. |
| Pending Source or no selectable version | Check **Access policy**, or reload and open a validated and approved version. |
| Approval unavailable | Use the Vite development server on `127.0.0.1` and verify `LOCAL_PROFILE_APPROVAL=1`. |
| Job remains Pending or Running | Check **Execution events**. For diagnosis, read the isolated service logs from the terminal. |
| Port occupied | Choose free ports and update the Compose environment, Vite proxy, and browser URL. |

```powershell
docker compose @composeArgs ps
docker compose @composeArgs logs --tail 50 api dispatcher worker
# Stop Vite with Ctrl+C in its terminal.
docker compose @composeArgs stop
```

`stop` retains PostgreSQL, Redis, and Evidence volumes. To rehearse recovery, save the result URLs and run `docker compose @composeArgs stop postgres` from the original terminal. The still-running API temporarily returns `503 database_unavailable`. Run `docker compose @composeArgs stop api` and `docker compose @composeArgs start --wait postgres api`. Wait for `/health`, then refresh Source, Profile, Job, Records, Quarantine, and Evidence. The approver label is supplied by the operator for audit. Use the same loopback origin with Vite and the direct loopback API from the terminal. End the full demo with `stop`.
