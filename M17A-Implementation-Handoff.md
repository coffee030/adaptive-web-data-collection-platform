# M17A 交接 — 以 MCP 唯讀查閱已保存的 Demo 資料

驗收日期為 2026-11-20（香港時間）。基線為 `origin/main` 的 `d01b1e84d591fd724b6ec4b836a440cb06fdfcbd`，包含已合併的 M16。Feature branch 為 `feature/M17-mcp-access`。實作、測試與 Windows 指南在 `04631418a9acfdd252c1ff41049690345d788f1b`，交接文件另有一個 commit。 [Windows 啟動與重現步驟](docs/setup/Windows-MCP-Access.md)

## 工具與 REST 對應

| MCP 工具 | 路徑（相對於 `/api/v1`） | 結果 |
| --- | --- | --- |
| `list_categories` | `GET /categories`，`active_only=true` | 啟用分類與 ID |
| `list_topics` | `GET /topics`，`active_only=true`、可選 `category_id` | 啟用主題及所屬分類 |
| `list_topic_sources` | `GET /topics/{topic_id}/bindings`，`eligible_only=true` | 後端判定合資格的 binding、來源及 Profile 版本 |
| `get_collection_status` | `GET /collection-requests/{request_id}` | 主 Request 與子 Job 狀態，包括 partial 和 failed |
| `get_collection_records` | `GET /records`，必須帶 `request_id`，另帶 `limit`、`offset` | 僅取指定 Request 的已接受紀錄及擷取資料預覽 |
| `get_record_lineage` | `GET /records/{record_id}`，`include_lineage=true` | Record、Request、Job、Source、Profile Version 及 Evidence 關係 |
| `get_evidence_metadata` | `GET /evidence/{evidence_id}` | 公開的擷取中繼資料及已存的 `content_hash` |

分頁工具多讀一筆來判斷 `has_more`，以 `next_offset` 繼續。基線的 Request 範圍 Records API 已區別未知 Request（404）與空頁（200）。MCP 以本機 stdio 運作，依賴獨立安裝。擷取資料有長度上限及截短標記。Evidence 比對涵蓋後端儲存的 digest。獨立重算 capture bytes 只屬既有 Launcher 的 baseline 檢查。

## Live Synthetic Demo 比對

`Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` 在本 checkout 建立並驗證三組 presets。`Diagnose-Platform.bat -Demo` 顯示 Dashboard port `5198`、API port `58098`。透過 Chrome 開啟 **Collection requests**，先選 **Fixture Listings · quick** 並從網址取得 Request UUID，再執行 live SDK trace。

| 欄位 | 一致的值 | Dashboard UI | MCP 與獨立 REST GET |
| --- | --- | --- | --- |
| Request | `9b98e289-9424-4592-a46c-03391b3e68d0`（Succeeded） | Request Detail 網址及狀態 | Request detail、Record lineage |
| 子 Job | `5eeaa67c-fc4c-43f5-9b60-5dedb4584f15`（Succeeded） | Child Jobs 的 Job details 連結及狀態、Record Inspector | Request detail、Record lineage、Evidence |
| Record | `e86eadff-abfd-50bc-ad73-8d2ca73461e6`（Alpha） | Data Explorer → Provenance and identifiers | Request Records 第 1 頁、Record detail |
| Source | `6ab64570-4cb0-486b-88c8-9b9572ad27e5`（Demo Catalog） | Child Jobs 顯示名稱，Record Inspector 顯示 ID | Request detail、Record lineage、Evidence |
| Profile Version | `4f6fe521-52fc-447d-b783-916d25c88536`（Version 1） | Pinned profile version 連結、Record Inspector | Request detail、Record lineage、Evidence |
| Evidence | `747eab7d-1197-496d-bb24-206e9cd98b34` | Record Inspector 及 Evidence Metadata | Record lineage、Evidence detail |
| 已存 SHA-256 | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` | Evidence Metadata → Content SHA-256 | Evidence detail 的 `content_hash` |

SDK 先找到 Core Demonstration（`68923b18-af5c-4d79-b658-9c07c4e7db53`）、Fixture Listings（`3091c411-5194-4274-b2f2-fb631a829994`）及兩個 eligible bindings（Demo Cards 和 Demo Catalog）。Records 以每頁一筆讀完兩頁，第 2 頁是 `249a91f3-e443-5d6f-a688-09004f3ce62b`。前後 REST 查出的 Request／Job ID 集合一致，共 3 個 Requests、6 個 Jobs。Chrome 的比對過程記錄到 0 個非 GET API 請求。

## 驗證結果

| 實際指令或操作 | 結果 |
| --- | --- |
| `python -m pip check`（MCP 獨立環境，Python 3.13.7） | 通過，官方 SDK 固定為 [mcp 2.3.0](https://pypi.org/project/mcp/2.3.0/)。 |
| `python -m pytest -q mcp_access/tests` | 12 通過。包含真實 stdio 子程序、全部工具與 GET/filters、分頁、Request A/B 隔離、partial／failed、空頁／未知 ID、無效輸入、拒絕 redirect、離線及回應上限。REST fixtures 為受控測試資料。 |
| `python -m mcp_access.verify_demo 9b98e289-9424-4592-a46c-03391b3e68d0` | 通過。實際 Demo REST API 與 SDK stdio 比對，另以 Chrome 操作同一個 Request、Record 及 Evidence。 |
| 新啟動的 `codex exec --ignore-user-config --ephemeral --sandbox read-only --json`，以 `-c` 注入本次 MCP 設定 | Codex CLI 0.169.1 找到 `fyp`，完成 `list_categories`、`limit=1` 呼叫，回傳 Core Demonstration 和 UUID。JSON 事件記錄為 `mcp_tool_call` completed。 |
| 隔離的 PostgreSQL 及 Redis 內執行 `python -m pytest -q -rs -p no:cacheprovider backend/tests/m2/test_m7_results.py backend/tests/m2/test_m8_collections.py backend/tests/m2/test_m9_record_export.py` | 11 通過。第一次只起 PostgreSQL，M8/M9 為 6 通過、2 因缺 Redis 跳過。完整重跑涵蓋兩者。 |
| `npm.cmd run build` | TypeScript 和正式 build 通過。 |
| `npm.cmd test -- topic-collections.spec.ts results.spec.ts m13-continuity.spec.ts jobs.spec.ts --workers=2` | 82 通過。使用 headless Chrome 及測試的 mock fixtures。 |
| `npm.cmd test -- operator.integration.ts topic-collections.integration.ts --grep 'three existing Synthetic Demo presets expose\|launcher dashboard displays' --workers=1` | 2 通過。設定 `M4_REAL_API=1`、`M10_SYNTHETIC_URL=http://127.0.0.1:5198`、`PLAYWRIGHT_CHANNEL=chrome`，使用實際 launcher Demo。 |
| `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1` | 28/28 launcher 測試通過。 |
| 關閉 MCP clients 後執行 `Stop-Platform.bat -Demo` 及 `Start-Platform.bat -Demo -OneClickDemo -NonInteractive -NoBrowser` | 第一次 Stop 回傳 `CFG-003`，已用 Diagnose 確認 API 與原有 presets，並恢復 Dashboard。重試完整停止及啟動時兩者均回傳 0，後續 Chrome 與 SDK 比對仍取得同一組 Request、Record 及 Evidence ID。 |

瀏覽器驗收採用獨立的 headless Chrome。AI host 驗收限於上述 Codex CLI 單次讀取。M17A 的驗收範圍為保存資料的唯讀追溯。其餘 M17 工作留給後續里程碑。

## 發佈與審閱

Repo-local Git author 和 committer 均為 `coffee030 <59193099+coffee030@users.noreply.github.com>`。GitHub 的已驗證 HTTPS 發佈帳戶為 `coffee030`（ID `59193099`），目的地為 `coffee030/adaptive-web-data-collection-platform`。由同一 credential 向 GitHub 查核帳戶和 repository push 權限。

`git push --no-follow-tags --set-upstream origin HEAD:refs/heads/feature/M17-mcp-access` 成功建立遠端 feature branch。`git ls-remote --exit-code --refs origin refs/heads/feature/M17-mcp-access` 確認實作 SHA `04631418a9acfdd252c1ff41049690345d788f1b`。此交接文件在同一分支的後續 commit，最新 SHA 可由遠端分支查核。獨立審閱待辦。 [GitHub feature branch](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M17-mcp-access)
