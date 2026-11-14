# M4 Core MVP Demo Runbook

用本機 React Console 操作受控 HTML 和 CSV。需要 Docker Desktop 的 Linux Engine、Docker Compose、Node.js（專案已驗證 22.18.0）、npm，以及可用的 Chrome 或 Playwright Chromium。準備兩個 PowerShell 視窗。工作目錄為 repository root。

## 1. 啟動隔離服務

以下 ports 須空閒。密碼保留在這個 PowerShell session。日後重新開啟同一組資料時，使用同一個 project 和原來的 DB 密碼。

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

如容器剛啟動而 host port 尚未就緒，等候 API 回應 `{"status":"ok"}` 再操作。現行 schema head 為 `0006`。保留同一 shell 的資料庫設定供之後的 restart。

在另一個 PowerShell 啟動 console。

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:58018'
$env:LOCAL_PROFILE_APPROVAL = '1'
npm.cmd run dev -- --port 5194 --strictPort
```

開啟 [Collection Jobs](http://127.0.0.1:5194/collection-jobs)。Compose fixture 由內部服務提供，React 經 FastAPI 存取。進行以下步驟時請以可信操作員身分在 loopback 操作。

## 2. Register Source 與授權

1. 選 **Sources → Create source**。分別建立具有獨立名稱的 HTML、CSV Source。兩者的 **Permission reference** 可填 `FYP controlled fixture`。
2. HTML 選 **Controlled web**，**Allowed origins** 填 `http://collection-fixture:8001`。CSV 選 **CSV**，**Allowed dataset IDs** 填 `listings`。
3. 提交後確認 **Access authorization** 是 **Pending**。只有可信操作員執行下方 terminal step。Source ID 可在 **Access policy** 讀取。
4. 每個 Source 各執行一次。重新載入 Source detail 並確認 **Approved**。

```powershell
$sourceId = '<Source ID from the console>'
$sourceApi = "http://127.0.0.1:58018/api/v1/sources/$sourceId"
Invoke-RestMethod -Method Patch -Uri "$sourceApi/authorization" -ContentType 'application/json' -Body '{"approval_status":"approved"}'
```

## 3. Configure、Preview、Validate 和 Approve

從各 Source 點 **Create draft**。Record type 可填 `listing`。Identity field 選 `key`，下列輸出欄位均維持必填。

| Source | Profile configuration | Validation input |
| --- | --- | --- |
| HTML | Selector type CSS，Item selector `#entries tr`。輸出 `title` 用 selector `a`、Text；`key` 用 selector `a`、Attribute `data-code`。 | 選允許的 origin，Document path `/table.html` |
| CSV | `key`、`title`、`count` 分別映射 `Key`、`Name`、`Count`。將 `count` 設為 integer。 | Dataset ID `listings`，貼上下面的 clean sample |

```csv
Key,Name,Count
a0,Sample,1
```

按 **Create draft**。如要展示 draft 更新，將 Record type 改為 `listing_item`，按 **Save draft**。輸入樣本，依序按 **Preview** 和 **Validate sample**。Preview 顯示已擷取內容，Validation 必須回報 **Validation passed** 才能核准。於 **Approval review** 填 approver label，確認報告、勾選確認並按 **Approve version**。頁面轉為唯讀。

要示範拒絕核准，可先用下節的原始 CSV fixture 做 Validation。它會出現 **Validation failed**。改回 clean sample 後重新 Validate 再核准。

## 4. Submit Job 與追溯結果

1. 在 Approved Profile 選 **New Collection Job**。核對 Source 和已選 Profile Version。
2. HTML 選已允許的 origin 並輸入 `/table.html`。CSV 選 `listings`，把下列命令所得的 fixture 內容貼到 **CSV content**。這個 fixture 供部分成功示範。
3. 按 **Submit job**。成功回應會開啟 **Job Details**。暫停在該頁觀察正式狀態及 execution events。快速 Job 的 Running 可能只在 `CLAIMED` event 可見。也可按 **Refresh job**。
4. HTML 預期 **Succeeded**，Valid 2、Invalid 0、Duplicates 0。選 **View job records**，開啟其中一筆 Record。
5. CSV 預期 **Partial**，Valid 2、Invalid 3、Duplicates 1。在 **View quarantine** 核對起始實體行 5、6、7 和 `required_field`、`wrong_type`、`invalid_row`。
6. 由 Record 或 Quarantine 開啟 **Evidence Metadata**。核對 capture、backend SHA-256、Source 和 Profile。沿連結回到 Job、Source 及已核准版本。Raw evidence 的 checksum 驗證由 backend store 負責。
7. **Job Details → Capture evidence** 亦可開啟已保存的 metadata。若 failed Job 捕捉了資料但沒有 candidates，可直接由此追查。若 Job 沒有保存 capture，該區會顯示空狀態。

在 repository root 把已提交的 fixture 複製到剪貼簿。

```powershell
Get-Content -Raw -Encoding utf8 -LiteralPath 'backend/tests/fixtures/m1/listings.csv' | Set-Clipboard
```

## 5. 排查與安全停止

| 觀察 | 操作 |
| --- | --- |
| Backend unavailable | 檢查 `/api/v1/health`、Compose status 和 Vite 的 `API_PROXY_TARGET`。服務恢復後按 Retry。 |
| Submit job 未獲確認 | 留在表單，恢復 API 後按 **Retry submission**，服務會以同一 key 檢查是否已有 Job。 |
| Create source 未獲確認 | 保留表單，服務恢復後用同一組值重送。相同 request key 的重播定位原 Source。 |
| Draft save conflict | 保留尚未儲存的欄位內容，先查閱或抄錄需要保留的修改，再按 **Reload server version** 並確認。新版本載入後可重新套用所需修改。 |
| Pending Source 或無可選版本 | 核對 **Access policy**，或重新載入並打開通過 Validation 及 Approval 的版本。 |
| Approved 操作不可用 | 確認使用 `127.0.0.1` Vite development server，並有設定 `LOCAL_PROFILE_APPROVAL=1`。 |
| Job 停在 Pending / Running | 查看 **Execution events**。需要排查時，從 terminal 查看隔離服務的 logs。 |
| Port 已佔用 | 選空閒 ports。更新 Compose 環境、Vite proxy 及瀏覽器網址。 |

```powershell
docker compose @composeArgs ps
docker compose @composeArgs logs --tail 50 api dispatcher worker
# Stop Vite with Ctrl+C in its terminal.
docker compose @composeArgs stop
```

`stop` 保留 PostgreSQL、Redis 和 Evidence volumes。可在演練中保留各結果頁 URL，由原 terminal 執行 `docker compose @composeArgs stop postgres`。仍在執行的 API 會暫時回報 `503 database_unavailable`。再執行 `docker compose @composeArgs stop api` 及 `docker compose @composeArgs start --wait postgres api`。等待 `/health`，重新整理 Source、Profile、Job、Records、Quarantine 和 Evidence。核准人標籤是自報 audit 資料。請以同一 loopback origin 存取 Vite，終端操作使用直接 loopback API。用 `stop` 結束整組 demo。
