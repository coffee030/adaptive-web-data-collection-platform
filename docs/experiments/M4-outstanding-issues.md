# M4 Closure Issue Ledger

基線 feature/M4E-frontend-integration @ 081c5f3。分支 fix/M4-closure。歷史 M4-A acceptance 與 issue 編號收錄在 Git 內的 M4-A handoff。M4-B 至 M4-E 的報告、manifests、合約及既有 demo runbook 作為基線證據。

| Issue ID / Origin / Severity | Description and reproduction | Root cause / impact | Proposed fix / files | Tests required | Status / Fix commit / Evidence |
| --- | --- | --- | --- | --- | --- |
| M4CL-01 / C / P1 | 兩個 client 讀 Draft，接連送不同 PUT。兩次都可寫入。 | PUT 無預期 revision。Source row lock 只序列化寫入，未阻止失效 client 覆寫。 | 交易內比較 Draft revision，PUT 強制提供預期 revision。profiles API、後端 service、React editor。 | PostgreSQL 併發 PUT、無 revision、immutability、stale report、瀏覽器衝突。 | VERIFIED / 668323a、f6606af / PostgreSQL 併發 200／409，缺 revision 428；兩個 browser editors 保留失敗者輸入。 |
| M4CL-02 / B / P1 | 同一 Source JSON 重送或雙連線同時提交。 | 每次產生新 ID，未綁定 request intent。 | Source request key、payload hash、PostgreSQL unique constraint、原 key Retry。 | DB 併發、200 replay、409 conflict、授權變更後重播、瀏覽器斷線恢復。 | VERIFIED / 668323a、f6606af / PostgreSQL 並行 201／200；同 key 異 payload 409；真實 HTTP 201 回應丟失後 React 以原 key 收到 200，同一 Source。 |
| M4CL-03 / D / P2 | 執行會保存 capture 但拒絕整份輸入的 Job。 | Job 沒有 Evidence 欄位，候選列不存在時無法導航。 | Job-scoped Evidence metadata，省略 storage reference。 | 成功、partial、failed capture、no capture、404 與 UI link。 | VERIFIED / 668323a、f6606af / backend tests 覆蓋成功、partial、failed、有／無 capture；新 browser workflow 在零 results 時開啟 metadata。 |
| M4CL-04 / A、B / P2 | 開啟 Sources 或 Profile Versions 第 2 頁，進入子頁後用 breadcrumb 返回，原列表頁遺失。 | 分頁 offset 只存元件 state，重新 mount 由第 1 頁起。 | 在 URL 保存 offset 並透過 links 保留上層 query。沿用 deterministic offset／排序。 | Sources／Profile 返回、status filter、空尾頁和 offset 邊界。 | VERIFIED / f6606af / Sources 返回保留 offset。原有 Jobs 空尾頁提示符合預期，新增 regression。Records／Quarantine 採 deterministic offset。 |
| M4CL-05 / C、E / P0 | 以非 loopback Host／Origin 對本機 API 發送 trusted mutation。 | FastAPI 缺少 browser origin 邊界。Vite 只過濾 approve，直接 API 和代理的其他 trusted 方法仍可觸達。 | 拒絕外部 browser origins／Host，維持 loopback proxy 及可信 terminal 操作。 | localhost 成功、foreign Origin/Host 拒絕、CORS、demo proxy gate。 | VERIFIED / 668323a、f6606af / 基線 foreign Host／Origin 回 201；修復後外部 Host／Origin 403、可信 terminal／same-origin proxy 成功，既有 restricted approval 拒絕測試通過。 |
| M4CL-06 / A / P2 | 時間欄收到無效 timestamp。 | Intl.DateTimeFormat 會拋出 RangeError，可能中斷整頁。 | 共用 Timestamp fallback。 | Job detail 顯示格式錯誤的 timestamp。 | VERIFIED / f6606af / invalid timestamp 表示 Unavailable，Job Detail 正常保留。 |
| M4CL-07 / Closure / P3 | GitHub 交付與組員覆核原為 M4 門檻。 | 使用者改為個人本機驗收。 | GitHub 延至 M5，組員覆核從 M4 移除。 | 本機驗收由使用者進行。 | DEFERRED／OUT OF SCOPE / 使用者決定。 |
| M4CL-09 / Closure / P3 | Narrator、macOS Safari、實體 iPhone Safari、實體 8 GB Windows。 | 有限的人工驗收與實機可用性。 | macOS Safari 依使用者決定移除。保留其餘三項的實際狀態。 | Narrator 由使用者操作；iPhone Safari／8 GB Windows 實測或由使用者逐項接受限制。 | PARTIAL / macOS Safari OUT OF SCOPE／NOT RUN；其餘 BLOCKED／NOT RUN。 |
| M4CL-10 / C / P3 | Playwright WebKit 在剛建立的 Profile route 上直接 fill 視窗外的 Record type 後，Save draft 停用。 | 測試未以操作者點選方式 focus／scroll 至欄位；只看 URL 就直接填寫。在 WebKit 的受控實際點選流程中 app 可儲存。 | Core workflow 測試加入點選與 enabled assertion。 | 三個瀏覽器的實際 create/edit/preview/approve/submit workflow。 | VERIFIED / 7afe0b1 / Chromium 14、Firefox 6、WebKit 6 live suites 通過，app focus 原樣。 |
| M4CL-11 / E / P2 | 演練後 compose stop 時 fixture 與 dispatcher 等到逾時後 exit 137。 | Python 容器的 PID 1 未處理 Compose 既定停止信號。 | Compose 為兩服務設 SIGINT，fixture 處理 KeyboardInterrupt。 | 實際 Compose stop、exit/OOM 核對、volume 查詢。 | VERIFIED / d1926e2 / 隔離演練與後端測試專案各六個容器 exit 0、OOMKilled false，各組三個 named volumes 保留。 |
| M4CL-12 / B、E / P3 | 全新隔離 DB 跑 live suite 時 Sources 測試找不到 Controlled fixture。 | 歷史測試依賴先前手動 seed。 | 測試走現行 API 建立 Source／合法 Approved fixture；實測 Job 503 recovery。 | 由空白 database 跑完整 Chromium live 與代表性 Firefox／WebKit。 | VERIFIED / 439e1a2 / 各引擎在隔離 acceptance project 通過。 |

## Historical manifests

M4-B／C／D／E 的 issue manifests 保留原有時點和 PASS 記錄。M4-C-03 的歷史結果覆蓋舊 UI／API 當時的行為，server-enforced concurrency 以 M4CL-01 為準。M4-B-02 的可重播註冊以 M4CL-02 為準，M4-D-04 的 Job 直達 Evidence 以 M4CL-03 為準。

## Baseline and code evidence

- M4CL-01 與 M4CL-02。Baseline 使用 FastAPI 和真實 PostgreSQL。現行 regression 見 `backend/tests/m2/test_m4_closure.py`、`test_approval.py` 及 `frontend/tests/closure.integration.ts`。
- M4CL-03。API、資料層與 UI 變更分別在 `backend/api/results.py`、`backend/application/results.py`、`frontend/src/features/collection-jobs/JobDetail.tsx`。結果查閱測試亦覆蓋成功及 partial 的 persisted evidence。
- M4CL-04。現行排序來自後端查詢，Sources 和 Profile Versions 的分頁 context 修復在 `SourceList.tsx`、`SourceDetail.tsx`、`ProfilePage.tsx`。跨請求 snapshot 屬既有 offset 限制。
- M4CL-05。API middleware、Vite proxy 分見 `backend/api/app.py`、`frontend/vite.config.ts`，Docker host port 綁定見 `compose.yaml`。核對 `test_loopback_http_boundary`、browser proxy rejection 及 live runbook。
- M4CL-06。Fallback 位於 `frontend/src/components/feedback.tsx`，受控案例在 `frontend/tests/jobs.spec.ts`。

Firefox 在一輪 axe analyze 時曾報 Page crashed。重新啟動瀏覽器後同一個案例及整組六項皆通過。單次崩潰未定位到應用層根因；原始失敗和重測均保留在測試報告。

## Final Gate — 外部待辦與責任

按使用者最新決定更新。M4CL-01～06、10～12 保留 VERIFIED。

| Issue / Gate | Current status | Required action and owner | Evidence | Codex 可獨立完成 | User decision | Human testing |
| --- | --- | --- | --- | --- | --- | --- |
| M4CL-07A GitHub delivery | DEFERRED TO M5 | M4 使用本機 Git。GitHub 工作留待 M5 獲授權後處理。 | `git remote -v` 空白，無 PR。 | M4 無待辦 | 已決定 | 無 |
| M4CL-07B Team review | OUT OF SCOPE | M4 由使用者個人驗收。 | 組員覆核未執行。原覆核文件可作個人自查。 | M4 無待辦 | 已決定 | 組員覆核不適用 |
| M4CL-09A Narrator | BLOCKED／NOT RUN | 使用者實際聽測並記錄結果。 | Narrator executable 存在，Chromium keyboard smoke 及 axe 已有結果。 [Narrator procedure](../reviews/M4-narrator-acceptance.md) | 否 | 待使用者回報 | 需要 |
| M4CL-09B macOS Safari | OUT OF SCOPE／NOT RUN | 使用者因無 Mac 從 M4 門檻移除。 | Windows Playwright WebKit 已測。 | M4 無待辦 | 已決定 | 無 |
| M4CL-09C iPhone Safari／8 GB Windows | BLOCKED／NOT RUN | 使用者分別實測或接受為 MVP 限制。 | Windows Playwright 已測。1792 MiB 是容器服務限額，實體 8 GB Windows 尚無結果。 [Device evidence](M4-device-and-resource-acceptance.md) | 本機缺所需設備 | 未測項目待決定 | 如選實測則需要 |

Firefox 歷史崩潰已查 trace 及重跑。六次 Evidence 執行均通過，根因仍未確定。 [調查與限制](M4-device-and-resource-acceptance.md#firefox-page-crashed-investigation)
