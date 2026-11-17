# M16 最終 MVP 驗收

## 儲存庫與整合稽核

透過 GitHub REST、`git ls-remote` 及本機 commit graph 核對。開始時工作樹乾淨，`main` 為 `2f880f9ae1e30fa3fff7e11261194873b8ccd2de`，已獨立審閱的 M15 為 `0b609b198146fdc2e0ab494e7a4a3b58083abc5d`。`git rev-list --left-right --count mainSHA...M15SHA` 回傳 `0 33`。M16 直接由該 M15 建立。M6 的 `7eea6cc` 至 M15 的交接位於同一祖先鏈，33 個提交涵蓋 M6～M15。Backend、Dockerfile、Alembic 與 M10 完成版本比較沒有差異。

| 現有 Draft PR | 目標 | 內容 |
| --- | --- | --- |
| [#1](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/1) | `main` | M6 多頁 Evidence |
| [#2](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/2) | `feature/M7-controlled-website-collection` | M8 內容識別、觀測和 Topic |
| [#3](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/3) | `feature/M8-data-identity-collection-management` | M9 Dashboard 和匯出 |
| [#4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4) | `feature/M9-dashboard-integration-export` | M10 核心可靠性和 Demo |

REST 回傳帳戶具 `push`、`maintain`、`admin`，可用 merge commit、squash、rebase。分支有效 rules 查詢為空，classic protection 路徑 HTTP 404。Actions 允許執行，起點無 workflow。分支規則與權限需於 M16-H 再查，獨立審查為本次交付條件。

稽核了 AGENTS、PRODUCT、DESIGN、UI Slop v1.7、M10 可靠性與部署報告、M11～M15 交接。M16 採保守修正。Job Detail 原先會信任 Router state 中的 `requestId`。現在用來源 URL 作查詢提示，只有成功取得相符的 Request ID，且 Request 保存的子 Job 包含目前 Job，才顯示回程。保留原 Request URL 和焦點回復。直接 Job link 可獨立開啟。

## 架構與產品範圍

React／Vite 經 loopback 同源 proxy 呼叫 FastAPI。PostgreSQL 保存授權、不可變設定、Topic Binding、Job、Event、結果與 provenance。Dispatcher 輪詢待派工作，以 Redis／Celery 送到 Worker。Worker 以 lease、claim attempt 與 terminal fencing 保護寫入。受控 HTML／HTTPS 搜尋依政策解析搜尋和詳情頁，CSV 用核准 dataset 與 mapping。有效資料去重後提交，validation 問題保留在 Quarantine。Evidence metadata 指向已保存的 capture bytes 和 SHA-256。Article identity、content versions 和 observations 保留各輪收集時看到的內容。CSV／JSON 匯出依整個終態 Job 或 Request 的已驗證紀錄。

M6～M10 整合 Core、Topic、Evidence、匯出及 Windows Demo。M11～M15 提供 Overview、新 Collection、Data Explorer、operator workspace 與 Job diagnostics。M16 移除 Desktop Shortcut Installer、修正回程資料來源、建立最小 CI 並驗證整體 MVP。

## 驗證結果

下表區分本次實測和先前資料。逐項紀錄留在忽略版本控制的 `.local/m16/`。

| 區域 | 測試與證據 | 結果 |
| --- | --- | --- |
| 完整 Backend | 270 PASS、0 FAIL、0 SKIP、0 ERROR，532.11 s。包括 6 個 Compose fault／recovery cases、7 個 broker cases、8 個 reliability cases 及 21 個 retry cases。Python 3.12.14／pytest 9.2.0，實際 PostgreSQL／Redis／Celery。證據為 `backend-complete.log` 和 JUnit `backend-complete.xml`。 | PASS |
| FastAPI／SQL 與 Evidence | 持久化 API、可重播的 fixture data、migration、實際 PostgreSQL restart、Evidence bytes。Normal 在任何寫入前以 SQL 核對 sources、profiles、topics、requests、jobs、records、evidence 都為 0。 | PASS |
| Frontend build／行為 | `npm.cmd run build` 及 Chrome 全套測試。新增五項 Request membership、直接 URL、過期提示與 Back／Forward 回歸。全套 154 PASS、0 FAIL、0 SKIP（`frontend-final.json`）。另於 Linux image 執行 CI 選取的 187 個純 Backend 測試，全部通過。 | PASS |
| 真實 Frontend 整合 | 26 個不同 Playwright 案例分環境通過，含 Browser QA 專用 Core／operator 17、fresh Normal 3、Launcher Demo 4、專用金融版本／lineage 2。`browser-live.json` 內的 9 個 skipped 都在其指定環境執行。實測受控 Web／CSV、Source／Profile／Binding 檢查及 Host／Origin gate、Redis/DB outage、GET 返還、同 UUID 重播、Request／Job scope、CSV／JSON、Evidence 和 Article History。 | PASS |
| Demo 入門與 baseline | 裸封存版用 Windows `cmd.exe /d /c Start-FYP-Demo.bat`，exit 0，103.78 秒。Node lockfile 安裝、port 衝突避讓、WSL2 Linux Engine、PostgreSQL/Redis、Alembic、API、Worker、Dispatcher、fixture、Vite 全部通過。Browser URL 送交 Windows；API 記錄瀏覽器 Overview 所需的 live GET。Desktop 既有 shortcut 清單比較一致。 | PASS |
| Windows 其他操作 | 28/28 PowerShell 5.1 launcher regression；正常、無效選項 exit 1、Setup／Diagnose／Stop 均從含空格和 Unicode 的封存版資料夾執行。Normal 實體 SQL 7 表皆 0。Demo 28.68 s 重複 Start 重用同 Vite PID，Stop 後直接 BAT Restart 31.71 s。重啟前後相同四個 volume，SQL 7 Requests／14 Jobs／38 Records／38 Observations／62 Evidence，跨 Job Evidence 缺失 0，內容 digest 相同。真實 BAT 用實作提交 `74202d4` 的封存，後續程式變更限於前端顯示並已獨立重驗。 | PASS |
| Synthetic Demo 持久資料與 controlled Partial | Demo manifest 各為 2、8、8 筆 Records／Observations，4、12、12 個經 hash 驗證的 Evidence。真實瀏覽器核對核准 Source／Profile／Binding、匯出、由 Overview 建立各 preset、保留精確 request UUID 的不確定回應及 `detail404` 的兩個 Partial Jobs。獨立版本 fixture 證明首次內容及原 Observation 保留，新 revision 產生新 version。 | PASS |
| 設計與可及性 | 依 UI Slop v1.7 先檢視實際頁面，修正 Overview 欄名衝突及 Binding 短連結的觸控區域。修正後實查 17 個 route／viewport 組合，無整頁水平溢出、無 axe WCAG A／AA 違規。`visual-review-verified/audit.json` 及 17 張畫面，加上 1440／900／768／390／320、native Chrome 200%、Light／Dark／System、keyboard focus、touch、reduced motion 的現有 Playwright 回歸。 | PASS |
| Constrained memory | 主機 Windows 11 build 26200，31.89 GiB，Docker Engine 29.9.3／Linux 15.56 GiB。候選 Demo 一個 Worker、prefork concurrency 1。各容器 memory／swap 上限依序 API 384、Worker 512、Dispatcher 256、PostgreSQL 256、Redis 128、fixture 128 MiB，合計 1,664 MiB。收集與 browser 旅程前後樣本分別總計約 348 及 353 MiB，六個容器 OOMKilled=false、restart count=0。這是容器限制測試。 | PASS |
| 物理 8 GiB、Docker Desktop 冷啟動、實體螢幕閱讀器 | Windows 既有 Docker Engine 有其他使用中的專案。Launcher tests 涵蓋停用 Engine 的模擬和錯誤路徑。可及性驗證採 keyboard、原生 200% zoom、responsive 和 axe。 | NOT RUN |

重新檢查 M10 一／二／四 Worker 的 27 批次歷史證據，以及 shared origin 限速。M16 以本次安全重跑的可靠性案例驗證相同 Core，吞吐量實驗沿用歷史記錄。 [M10 Reliability](M10-Reliability-Evaluation.md) · [M10 Scalability](M10-Scalability-Evaluation.md)

## 重現

Windows 11 AMD64、WSL 3.0.5、Docker Compose 5.7.0、Node 22.18.0、npm 10.9.3、CPython 3.12.14、pytest 9.2.0。以下環境變數指向專用測試 project。重現前挑選空閒 loopback ports 及未重疊 RFC1918 網段。

```powershell
python -m venv .local/m16/venv
. ./.local/m16/venv/Scripts/Activate.ps1
python -m pip install -r backend/requirements.txt
python -m pip check
. ./backend/experiments/m10_environment.ps1 -Project collection-m3-test-m10-m16-core -ApiPort 18176 -PostgresPort 55546 -RedisPort 16446 -FrontendPort 52910 -Subnet '10.250.251.0/24' -FixtureSubnet '10.250.252.0/24'
```

本次建置 `docker build -t collection-backend:m16-release-qa .`，在 `.local/m16/core-image.yaml` 讓 `api`、`worker`、`dispatcher`、`collection-fixture` 均使用該 image。然後執行。

```powershell
$composeArgs += @('-f','.local/m16/core-image.yaml')
$env:M3_TEST_COMPOSE_EXTRA_ARGS += ' -f .local/m16/core-image.yaml'
docker compose @composeArgs up -d --no-build --wait postgres redis collection-fixture
docker compose @composeArgs run --rm --no-deps api python -m alembic upgrade head
docker compose @composeArgs up -d --no-build --wait
python -m pytest -q -rs --tb=short --junitxml=.local/m16/backend-complete.xml backend/tests
```

瀏覽器 destructive-recovery cases 使用不同專案 `collection-m3-test-m10-m16-browser`（API 18177、PostgreSQL 55547、Redis 16447、Vite 52913、網段 10.250.249.0/24 與 10.250.250.0/24）。同方式初始化，將 image overlay 加到 `M4_COMPOSE_OVERLAYS`；`M9_TEST_PYTHON` 指向前述 Python。執行 fresh Normal 測試前設定 `M12_EMPTY_NORMAL=1`、`M14_EMPTY_NORMAL=1`、`M15_EMPTY_NORMAL=1`，以 `--grep "fresh Normal|isolated empty Normal"` 選取。再清除三個旗標執行完整實際 API 測試。

```powershell
cd frontend
$env:PLAYWRIGHT_CHANNEL='chrome'
npm.cmd ci
npm.cmd run build
npm.cmd test -- --workers=1
```

以 `M4_REAL_API=1` 跑 integration。Mocked suite 另開 shell、保持該變數未設定，使用同一個 `npm.cmd test`。已運轉的 Candidate Demo 用 `M10_SYNTHETIC_URL=http://127.0.0.1:5201` 執行 `npm.cmd test -- --grep "existing Synthetic|launcher dashboard" --workers=1`。用 `M15_DEMO_READ=1`、`PLATFORM_SYNTHETIC_DEMO=1`、`API_PROXY_TARGET=http://127.0.0.1:58101` 測 Job 詳情。版本切換測試僅在專用 `collection-m3-test-m10-m13-m16-demo` fixture（API 18178、Vite 52916）執行，使用 `scripts/windows/compose.demo.yaml` 及 `python -m backend.experiments.demo_provision`，再設 `M13_QA_DEMO_URL` 與 `M13_QA_FIXTURE=collection-m3-test-m10-m13-m16-demo-collection-fixture-1` 執行 `npm.cmd test -- m13-continuity.integration.ts --workers=1`。

Launcher regression 使用 `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1`。以 `git archive --format=zip HEAD` 封存候選程式碼並解壓到包含空格和 Unicode 的新資料夾，以 `cmd.exe /d /c Start-FYP-Demo.bat` 啟動並檢查 exit code。詳細操作見 [Windows 安裝](../setup/Windows-One-Click-Setup.md)。
