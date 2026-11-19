# M17B 交接 — 透過 MCP 提交受控採集

驗收日期為 2026-11-20（香港時間）。已審閱的 M17A 基線為 `92fb62ebb7ebef27573b17d1ddab039d0c1bd1cc`，由 `feature/M17-mcp-access` 接續。實作、測試、Demo 驗收程式及 Windows 使用步驟在 `991c220ed00ffe692243095a438f8265429e5114`。 [Windows MCP 指南](docs/setup/Windows-MCP-Access.md)

`prepare_collection` 在本機驗證並回傳新的 `request_key` 和提交參數。唯一的寫入工具 `start_collection` 對固定的 loopback REST 路徑發出一次 POST，交由後端判斷資格、建立或重播 Request。回覆遺失時，MCP 以工具錯誤回傳 `outcome: unknown`、原 key 和同一意圖的重播指引。原有七個讀取工具仍可用，`get_collection_status` 增加每個 Job 的紀錄計數、重試時間及簡短錯誤。

## 實際 Demo Request 與 Job

SDK 經 stdio 發現 **Core Demonstration → Fixture Listings**，選取 Demo Catalog 和 Demo Cards。以既有隔離 Windows Synthetic Demo 的 API port `58098` 及 React Dashboard port `5198` 驗收。下表 UUID 為後端發出的 Request ID 和 Job ID。

| 案例 | Request ID | Demo Catalog Job ID | Demo Cards Job ID | 結果 |
| --- | --- | --- | --- | --- |
| `quick` | `c47c14ce-a400-4abc-9d96-89c1eb9f36e6` | `34f7845e-9be0-4cea-abf1-a04b91fbcbfe` | `ed8d2d11-1a86-4934-8918-c226ebee0326` | HTTP 201，Request 與兩個 Job 由 pending 到 succeeded。反轉 binding 順序重播回 HTTP 200。 |
| `quick` 相同意圖以新 key 另開一輪，並模擬 commit 後遺失回覆 | `1544b28b-d894-46db-b6bd-39cdd84203ec` | `4c839450-11ff-4408-9105-36ca4d713cc2` | `4a6a69f2-4853-49a8-9d09-f0577ca497df` | 測試代理先收到後端 HTTP 201，再關閉回程連線。新的 MCP 子程序以原 key 和原參數取回 HTTP 200，三個 ID 一致，最終 succeeded。 |
| `detail404` | `75a11597-380f-4a9e-a652-214579e07e7c` | `7876feae-3211-4b86-a469-06cb31cceb73` | `9d107b54-0667-48f8-86d8-f62d5e59a7d5` | HTTP 201。Request 及兩個 Job 均為 partial，每個 Job 有 1 筆有效、0 筆無效、0 筆重複紀錄，錯誤代碼 `http_error`、HTTP 404，各保留一筆 Alpha。 |

回覆遺失案例的準備 key 為 `8e117028-52f9-41ff-bfc5-f1fcd20628fd`。一般 `quick` 的準備 key 為 `2a229c67-3f39-40e3-a3ae-a981051d460c`，重用此 key 並改用 `detail404` 時，收到 HTTP 409 `collection_request_conflict`。

| Demo 檢查點 | Requests | Jobs | ID 集合差異 |
| --- | ---: | ---: | --- |
| 開始與 prepare 後 | 4 | 8 | 0 / 0 |
| 一般 `quick` 提交後 | 5 | 10 | 新增上表 1 / 2，反轉 binding 順序重播與不同 keyword 的衝突各為 0 / 0 |
| 遺失回覆案例後端 commit 後 | 6 | 12 | 新增上表 1 / 2，經新 MCP 程序重播為 0 / 0 |
| `detail404` 完成後 | 7 | 14 | 新增上表 1 / 2 |
| 臨時 Topic 的 `quick` 完成後 | 8 | 16 | 新增下列 1 / 2，禁用其中一個 binding 後的拒絕及歷史重播各為 0 / 0 |

臨時 Topic 的 Request 為 `2113ef51-f86b-40ed-ace6-9905e8a9e9b0`，兩個 Job 為 `d59ec2ba-8635-49bc-b46d-10b14278f936`、`e910b04c-ef5f-4ba0-8af9-04cf7beeac92`。以獨立的操作員 REST 步驟禁用一個 binding，混合選擇用新 key 提交回 HTTP 409 `binding_ineligible`，舊 key 原意圖回 HTTP 200 及原有 ID。驗收後停用臨時 Topic。原有兩個 Fixture Listings bindings 繼續可用。

首輪驗收程式已建立成功的 `quick` Request `14246a05-3456-454b-8062-74014fb99174`，兩個 Job 為 `eb9e2b5e-a895-4d98-b457-14003d27c307`、`670d8e89-603f-4683-b1ce-1f5fc6279e83`。程式讀取 Alpha 時誤找 `title`，修正為 fixture 實際欄位 `headline` 後完整重跑。該輪成功資料保留於 Demo，已納入重跑前的 4 / 8 基線。

## Dashboard 與證據

Headless Chrome 開啟上表三個 Fixture Listings 的 Request Detail，比對兩個來源的 Job 連結、狀態、計數、Source 及 Profile Version，再由 **View request records** 打開每筆 **Inspect Alpha**。**Provenance and identifiers** 及 **View capture evidence** 的 ID 和 SHA-256 與 SDK 及獨立 REST GET 一致。Dashboard 發出 0 個非 GET API 請求。

| 案例及來源 | Record ID | Evidence ID | 已存 SHA-256 |
| --- | --- | --- | --- |
| `quick` · Demo Catalog | `d08cc6a8-423f-5924-b28d-c317e4b38bff` | `f22f7c59-3326-4220-9501-0dbbe7277901` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |
| `detail404` · Demo Catalog | `cd675e25-86f9-53e9-a8b7-252652edc368` | `1a26bb03-769d-4c61-bfe7-fc76d39d2446` | `4ce7ceca659b894e809bc5e95a8c39a41a647bf7059336a8f96115b36c23710b` |
| `detail404` · Demo Cards | `7b7aabf4-bc8d-5c22-b2f2-3a5c86083094` | `dba36f97-469d-4726-bedf-0e69561d7dc8` | `bbf25a9c35ea154e2e3b856679194ca5f37849345dbfafe2906e46edeac9b898` |

每個來源的 `invalid_count` 為紀錄驗證計數。擷取頁面的 HTTP 404 另見 Job 錯誤。Live 比對使用已保存的 digest。原始 capture bytes 的 SHA-256 重算由下列既有 PostgreSQL 整合測試覆蓋。

## 指令與結果

| 實際指令或操作 | 環境及結果 |
| --- | --- |
| `.venv-m17/Scripts/python.exe -m pytest -q mcp_access/tests` | 14 通過。使用真正 SDK stdio 和假的 loopback REST，涵蓋零寫入的 prepare、無效參數、固定 POST 路徑、原 key 轉送、201/200、409、408、5xx、redirect、無法讀取的收據、部分完成欄位和既有讀取 trace。 |
| `.venv-m17/Scripts/python.exe -m pip check` | 無相依衝突。 |
| `python -m pytest -q -rs -p no:cacheprovider backend/tests/m2/test_m7_results.py backend/tests/m2/test_m8_collections.py backend/tests/m2/test_m9_record_export.py` | 11 通過。在既有 Demo backend image 啟動一次性測試 container，設定 `M2_TEST_DATABASE_URL`、`M3_TEST_BROKER_URL`，掛載 checkout 的 `backend` 為唯讀，使用獨立 PostgreSQL 17、Redis 7.4。一般 Docker 位址池已滿，改以獨立可用的 `10.249.230.0/28` 後通過。M8 並發測試確認同 key 並發為一個父 Request、每個 binding 一個 Job，HTTP 回覆為 201 和 200。 |
| `$env:FYP_MCP_API_BASE='http://127.0.0.1:58098/api/v1'`，接著 `.venv-m17/Scripts/python.exe -m mcp_access.verify_start_demo` | 完整 Synthetic Demo、真實 PostgreSQL 及 Dispatcher／Worker。通過上列提交、丟失回覆、衝突、資格與部分完成情境。 |
| `.venv-m17/Scripts/python.exe -m mcp_access.verify_demo 9b98e289-9424-4592-a46c-03391b3e68d0` | M17A 的既有 SDK 讀取仍通過，Request／Job ID 集合前後皆為 8 / 16。 |
| `node .local-demo/m17b-dashboard.cjs` | 本機暫存的 Playwright／Chrome 檢查通過三個 Request。首兩次調整了 Job 連結的回程 query 比對和 partial 錯誤清單的 selector。可依上節步驟直接在 Dashboard 重現。 |

驗收範圍限於受控 fixtures、SDK 和現有 Dashboard。自然語言 AI host 展示留待 M17C。

## 發佈與審閱

Repo-local author 與 committer 為 `coffee030 <59193099+coffee030@users.noreply.github.com>`。由實際 HTTPS 發佈憑證向 GitHub 核對登入 `coffee030`、帳戶 ID `59193099`，以及目的地 `coffee030/adaptive-web-data-collection-platform` 的 push 權限。

以同一憑證執行 `git push --no-follow-tags origin HEAD:refs/heads/feature/M17-mcp-access`，再以 `git ls-remote --exit-code --refs origin refs/heads/feature/M17-mcp-access` 確認實作 commit `991c220ed00ffe692243095a438f8265429e5114`。本交接是同一分支後續 commit，分支供審閱。 [GitHub feature branch](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/feature/M17-mcp-access)
