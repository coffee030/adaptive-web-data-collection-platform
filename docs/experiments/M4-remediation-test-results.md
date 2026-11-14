# M4 Remediation Test Results

核對日期 2026-11-14。基線 `081c5f3`。Browser binary recovery 的版本、官方來源與 launch smoke 見 [Environment readiness](M4-environment-readiness.md)。此頁記錄本次實跑；歷史 M4-E 記錄保留原有數字。

## 回歸與驗證證據

| Check | Status | Observation |
| --- | --- | --- |
| 基線 Chromium controlled suite | PASS | 74 passed，55.5 秒。 |
| 基線 Draft concurrency / Source replay / local boundary | FAIL（已重現） | 兩次舊 PUT 皆 200、同內容 Source 產生兩個 ID；foreign Host／Origin 可建立 Source，回 201。 |
| 首輪 full backend | FAIL（已修正） | 174 passed、2 failed；舊測試試圖降級 forward-only schema，OpenAPI 測試仍查舊 component 名稱。改為由 0004 起建 fixture 並升級至 head，核對 DTO revision。 |
| Full backend regression | PASS | 176 passed，213.66 秒，零 skipped。用 real PostgreSQL 和 Redis。涵蓋 M0–M3、Source 並行重播與衝突、Draft 並行 200／409、缺 revision 428、stale report、immutable approval、Evidence only／無 capture、狀態、授權與 retry。 |
| Ruff lint / formatting | PASS | `ruff check`、`ruff format --check`。 |
| Alembic | PASS | 隔離 PostgreSQL 上由已用的 0005 升級至 0006，另跑 0004 歷史資料規格。 `current --check-heads` 指向 0006，`alembic check` 無 schema drift。 |
| TypeScript / Vite | PASS | `npm.cmd run typecheck`、`npm.cmd run build`。Vite 8.3.8 產出 54 modules。 |
| Chromium controlled | PASS | 78 passed，55.5 秒，涵蓋 status / events / terminal polling、離開 Job Detail 後停止 polling、Job 表單 403／409／422／503、分頁與 invalid timestamp。 |
| Chromium live Docker 首輪 | FAIL（已修正） | 13 passed、1 failed；前端額外的 approval GET 攔住原有 server-side stale report 409 測試。保留 backend 交易檢查並移除多餘 GET。 |
| Chromium live Docker | PASS | 14 passed，約 1.3 分鐘。HTML／CSV、失敗與復原、真實提交前後比較、Source retry 回原 ID、雙分頁 Draft 衝突保留輸入、Evidence-only Job。 |
| Firefox representative Docker | PASS | 最後重跑 6 passed，23.7 秒。覆蓋真實 HTML／CSV 主流程及三項資料完整性案例和 Source contract。 |
| WebKit 首輪 representative Docker | FAIL（已重現） | 自動化對 viewport 之外的輸入直接呼叫 fill，未觸發已編輯狀態。改為模擬操作員先點選欄位再輸入（7afe0b1）。同一輪另有 restart suites 共用資料庫造成的暫時 502，最終測試依序執行。 |
| WebKit representative Docker | PASS | 最後重跑 6 passed，29.5 秒。完成 HTML、CSV、授權、精確版本、Records、Quarantine、Evidence／provenance、Source replay 與 Draft conflict。 |
| Firefox／WebKit Job monitoring | PASS | 各 2 項 focused controlled tests，涵蓋 active polling、terminal detection 與離開 route 後停止。Compose 重啟與 volume 檢查由完整 Chromium suite 執行。 |
| Firefox cold-start retry | FAIL（單次） | Evidence case 的 axe analyze 階段報 Page crashed；其餘 5 項通過。前一輪 Firefox 6 項通過；以同一驗收 project 獨立重跑 6 項，全部通過。單次瀏覽器渲染程序崩潰的根因未確定。 |
| Fresh volume preflight | FAIL（已修正） | 嘗試以舊隔離 volume 及不配對 credential 啟動時，API 回 503。另一次全新備援演練 13 passed、1 failed，因 Sources 測試依賴歷史上名為 Controlled fixture 的 Source。現在該測試由 API 建立自己的受控 Source 與合法 Approved fixture（439e1a2），最終使用已完成 migration 的全新 volumes。 |
| Real Job database outage | PASS | PostgreSQL 停止時，仍在運行的 FastAPI 對 Job POST 回 503 database_unavailable；restart 後同 key 建立一次，再回 200 及同一 Job ID。 |
| Impeccable 4.9.0 | PASS | Source scan 回 `[]`；四個 viewport 的 rendered scan 各涵蓋 11 條真實 route，合計 44 個 render，全部回 `[]`。 |
| axe A/AA | PASS | Chromium 真實畫面 56 checks、0 reported violations。另有受控 keyboard、focus、labels、overflow checks。 |
| 實際語音讀屏 | NOT RUN | 可找到 Narrator。未完成有音訊的人工讀屏測試。NVDA 未安裝。 |
| 實體 8 GB Windows／Safari／iPhone | NOT RUN | 本機沒有對應設備。Playwright WebKit 版本 27.2。 |

## 實際 Demo 和資料留存

最終 clean rehearsal 使用 `collection-m3-test-closure-acceptance`、API 58025、PostgreSQL 55455；較早的容量量測使用 `collection-m3-test-closure-ui`，內部 fixture `collection-fixture:8001`。Chromium 把兩條路徑由 Source 建立及 Pending 檢視，跑到可信 Source Authorization、Profile Draft 建立與更新、Preview、Validation、核准確認、pinned job、Linux Celery prefork、Records、Quarantine、Evidence 及回查 Source／Profile。CSV 汙損樣本先測得核准 409，再用乾淨樣本核准。

| Check | Evidence |
| --- | --- |
| HTML | `060d2406-1270-487c-acc9-d357994c0cbb`，Succeeded，Valid／Invalid／Duplicates＝2／0／0。Evidence `9d91545a-0854-4019-9c42-d2841a79caa0`，SHA-256 `5d65fc9aec1cc428b872490e5e1d7049e947c47fcafb0f38eb535316940162e0`。 |
| CSV | `f634cee9-6498-4313-a0cf-67797ab99c53`，Partial，2／3／1。Quarantine 起始實體行 5–7。Evidence `e5ed0aaa-3199-4ade-b126-8f435c854d0a`，SHA-256 `15ad900bbc23656d0049eeb4dc48c51b501cd9d24cce4976876b8f138b02acfa`。 |
| Events | 兩者的實際序列為 JOB_CREATED → DISPATCHED → CLAIMED → SUCCEEDED／PARTIAL。 |
| API + PostgreSQL restart | 先只停止 PostgreSQL，仍運行的 FastAPI 對 Job POST 回 503 `database_unavailable`。接著停止 API，重啟 PostgreSQL 和 API 並等 health。重試維持原 key，產生 `0db473c2-b1d9-4a5b-a471-cc1168e3c0d9` 並完成。重啟前後的 Source、Profile、Job、Events、Records、Quarantine 和 Evidence JSON 相同。兩組 fixture 的 checksum 由實際位元組驗證。 |
| 安全邊界 | Vite 僅 opt-in 時代理 Profile Approval。外部 Host／Origin 403，loopback same-origin 成功。Terminal 透過 loopback 操作 Source 授權，CORS 未啟用。自報 approver label 隨 Approval 保留在 audit。 |
| Failed capture | 已保存 Evidence、零 Records／Quarantine 時，從 Job Detail 開啟 metadata；Job 無 capture 時顯示對應空狀態。HTTP JSON 無內部 storage reference。 |

## Accessibility / Responsive

1440、1280、768、390 px 均在 Chromium 擷取真實畫面。以目視抽查 CSV Job 390、Source Create 768、Approved Profile 1280、Records 1440；自動檢查含 Skip link、鍵盤操作、label、error focus、確認流程、Status／alert role、桌面表格與窄螢幕內容。長識別碼和 JSON 在適當區塊折行／捲動。以 sRGB 色票計算，accent／白底 4.91:1，accent-ink／白底 6.89:1，control border／白底 3.52:1，warning／warning surface 4.91:1。掃描涵蓋 WCAG 2.0／2.1 A/AA axe tags；完整人工 WCAG 驗收未執行。實際輸出位於本機受忽略的 `var/m4-closure-captures`。Impeccable 使用既有 audit/harden/polish guidance 與 source/rendered detector，Hooks 和 Live Mode 維持停用。

## Resource / performance

以下為同一個受限 Compose project 的 `docker stats --no-stream` MiB；每個 service 使用獨立容器限額。Docker VM 約 15.56 GiB，啟動至 Compose ready 連 migration 約 10.60 秒。

| Service | Limit MiB | 啟動後使用 MiB | Demo 後使用 MiB |
| --- | ---: | ---: | ---: |
| API | 256 | 73.31 | 79.86 |
| Fixture | 128 | 13.52 | 13.38 |
| Dispatcher | 256 | 70.71 | 73.59 |
| PostgreSQL | 512 | 35.24 | 37.98 |
| Redis | 128 | 4.289 | 4.465 |
| Celery prefork Worker | 512 | 90.82 | 113.8 |

合計限額 1792 MiB。演練後所有測試容器的 `State.OOMKilled` 均為 false，容量數字是抽樣值。Vite 開發 Node process 約 117.1 MiB working set，當時 peak 141.2 MiB；以約 8 ms 間隔抽樣 Vite build 的 Node working set，量得最高 142.5 MiB，Vite build 161 ms，exit 0。樣本涵蓋 Vite 程序，總流程仍另有 TypeScript 與 npm。未調整 Windows／Docker 全域設定。本次限額實驗無法量度實體 8 GB Windows 的可用量、pagefile 和整機競爭。

## 重跑入口

隔離服務設定見 [Runbook](../demo/M4-core-demo-runbook.md)。本次在獨立 Compose 上跑 full `python -m pytest -q`、`python -m ruff check`、`python -m ruff format --check`、`python -m alembic current --check-heads`、`python -m alembic check`。前端使用以下已鎖定的工具鏈：

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
# Live，先啟動隔離 Compose，設定 M4_REAL_API、LOCAL_PROFILE_APPROVAL、API_PROXY_TARGET
npm.cmd test -- --workers=1
# Representative，設定 PLAYWRIGHT_BROWSER=firefox 或 webkit
npm.cmd test -- tests/core-workflow.integration.ts tests/closure.integration.ts tests/sources.integration.ts --workers=1
```

Live restart 需要把 `M4E_COMPOSE_PROJECT` 設成專用 project 並以原本的 database 環境執行。Evidence storage 驗證使用相同 project 的 `M4D_COMPOSE_PROJECT`。驗證 capture 視窗可用 `M4E_CAPTURE_DIR`。Browser logs 和 traces 放在被 Git 忽略的 `frontend/test-results`。

## 測試服務停止

早期停止時，fixture 與 dispatcher 等到逾時後退出 137，兩者的 OOMKilled 為 false。d1926e2 改用 SIGINT，fixture 處理 KeyboardInterrupt。修復後，兩組重新演練的容器及最後的獨立驗收全部以 `docker compose stop` 結束，六個服務均回 0、OOMKilled 均為 false，每個 project 的 `postgres_data`、`redis_data`、`evidence_data` 仍存在。開發資料與既有資料卷保留。

## Final Gate 補充核對

`fix/M4-closure` 起始 HEAD 為 `25d47ab9ffcf555a945b636279aa6e40e918392b`，程式及測試與 `439e1a2` 一致。Final Gate 只交付文件，因此完整 suite 的原報告與本次 focused rerun 並列。

| Check | Actual result |
| --- | --- |
| Draft concurrency／Source replay／Evidence-only／Host and Origin（實際 PostgreSQL） | `backend/tests/m2/test_m4_closure.py` 4 passed，1.82 秒。 |
| Chromium keyboard、forms、polling、Records、Evidence | 10 passed，12.3 秒。 |
| Firefox Evidence／axe bounded reproduction | 5 passed，27.7 秒；逐次獨立 Playwright worker、串行、retry 停用、保留 5 個 traces。 |
| Firefox live closure smoke | 2 passed，9.4 秒。包含證據案例的第六次執行，另覆蓋 Source response-loss replay 與兩個 Draft editors。 |
| TypeScript／Vite／Ruff／Alembic | typecheck／build exit 0，Ruff lint 通過、58 files 已格式化。新隔離資料庫 upgrade 至 0006，`alembic current --check-heads` 及 `alembic check` 通過。 |
| Compose shutdown | `collection-m3-test-final-gate` 六個服務 exit 0／OOMKilled false。PG smoke 後再次停止。三個 named volumes 保留。 |
| Narrator／macOS Safari／iPhone Safari／實體 8 GB Windows | NOT RUN。未有使用者接受未測項目的紀錄。 |

沿用 pinned browsers。以下是本次執行的 test selectors。由 [組員覆核套件](../reviews/M4-teammate-review-checklist.md) 設定隔離 Compose、瀏覽器及變數。原始 Firefox failure 的分析見 [Device and Resource Acceptance](M4-device-and-resource-acceptance.md#firefox-page-crashed-investigation)。

```powershell
# Repo root；M2_TEST_DATABASE_URL 已指向 isolated PostgreSQL。
.\.venv\Scripts\python.exe -m pytest -q -rs --tb=short backend/tests/m2/test_m4_closure.py
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend

# frontend/；受控模式，使用 Chromium。
npm.cmd run typecheck
npm.cmd run build
node node_modules/playwright/cli.js test tests/sources.spec.ts tests/profiles.spec.ts tests/job-create.spec.ts tests/results.spec.ts --grep 'keyboard|polling stops|Evidence shows' --workers=1 --output=test-results/final-gate-chromium

# frontend/；設定 M4_REAL_API=1、LOCAL_PROFILE_APPROVAL=1、API_PROXY_TARGET、
# PLAYWRIGHT_BROWSER=firefox 及 isolated frontend port。
node node_modules/playwright/cli.js test tests/closure.integration.ts --grep 'failed capture opens Evidence' --repeat-each=5 --workers=1 --retries=0 --trace=on --output=test-results/final-gate-firefox
node node_modules/playwright/cli.js test tests/closure.integration.ts --workers=1 --retries=0 --output=test-results/final-gate-firefox-smoke
```
