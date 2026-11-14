# M1 Verification and M2 Readiness

驗證日期為 2026-11-14（香港時間）。基線 `a85f5de` 在修改前重跑 36 項 M0 測試全部通過。Git 沒有 remote。完整 v3 Guide 在指定專案內缺少，實作依據為使用者提供的 M1 規格、M0 contracts 及 ADR。

## 實測結果

在 Windows 11 x64 的全新 `.venv` 安裝，CPython 3.12.14、Scrapling 0.5.1、Pydantic 2.14.3、pytest 9.2.0 和 Ruff 0.17.5。以下指令從 repository 根目錄執行，`$py = './.venv/Scripts/python.exe'`。

| 命令 | 結果 |
| --- | --- |
| `& $py -m pip install --index-url https://pypi.org/simple/ --disable-pip-version-check --retries 0 --timeout 15 --no-cache-dir -r backend/requirements.txt` | PASS |
| `& $py -m pip check` | PASS |
| `& $py -m pytest -q backend/tests/test_m0_extraction.py backend/tests/test_m0_http.py` | 36 PASS，0 FAIL，6.17 秒 |
| `& $py -m pytest -q backend/tests/m1/test_m1_profiles.py backend/tests/m1/test_m1_adapters.py backend/tests/m1/test_m1_ingestion_evidence.py` | 65 PASS，0 FAIL，1.33 秒 |
| `& $py -m pytest -q backend/tests/m1/test_m1_runner.py` | 11 PASS，0 FAIL，0.85 秒 |
| `& $py -m pytest -q backend/tests` | 112 PASS，0 FAIL，0 SKIP，7.27 秒 |
| `& $py -m ruff check backend` | PASS |
| `& $py -m ruff format --check backend` | PASS，17 個檔案 |
| `git diff --check a85f5de HEAD` | PASS，M1 提交範圍。全工作樹的 `git diff --check` 另指出原有 teammate brief 本機副本多一個檔尾空行，該變更保留在本機。 |

批次結果依次為 A 的 23 項、B 連同 M0 Parser 的 33 項、C 的 6 項、D 的 11 項、E 的 112 項。Batch B 第一次出現一項失敗，原因為 `Disallow: /denied` 同時封鎖了原測試的 redirect 起點 `/denied-redirect`。改用 `/go-denied` 後，實際確認起點收到請求、受限制的下一跳沒有收到。HTTP 傳輸另從已鎖定 curl_cffi 行為確認，write callback 回傳 0 可能只產生警告，因此以 `CURL_WRITEFUNC_ERROR` 中止下載，並用受控超限回應驗證。M1 HTTP 測試只連接本機受控 fixtures。

CSV 混合資料得到 2 筆有效、3 筆無效（必填缺失、wrong type、row width）、1 筆 duplicate，狀態為 `partial`。重跑保留相同 record IDs，使用不同 run／evidence IDs。CSS 及 XPath 流程均用真實 HTTP 和 Scrapling 執行。測試會查證原始 bytes 與 SHA-256，並由 output record 追溯 Source、Run、Profile Version 和位置。

## M1 Definition of Done

| 要求 | 狀態 |
| --- | --- |
| M0 regression | PASS，36 項 |
| 可建立 Draft | PASS |
| 可 Preview | PASS，端到端 |
| Validation 綁定精確設定版本 | PASS，含 stale report |
| Invalid Profile 不能批准 | PASS |
| 顯式 Human Approval | PASS，傳入 approver 和當前 report ID |
| Approved Profiles immutable | PASS，含 nested config |
| 未批准／retired 版本不能執行 | PASS |
| 同一 extractor 支援兩種 HTML layouts | PASS |
| CSV 和 HTML 共用 ingestion | PASS |
| Generic Records 通過 schema 驗證 | PASS |
| Deterministic dedup | PASS，含無 ID 及不同 Source |
| Invalid records 有結構化原因 | PASS |
| Raw Evidence 及 SHA-256 | PASS |
| Record provenance 可追溯 | PASS |
| Controlled runner 端到端 | PASS，11 項 |
| Core 無 ML 或 IA dependencies | PASS，依賴及 diff 檢查 |
| 此階段維持獨立 Python library | PASS，程式與依賴範圍檢查 |
| pytest 與 Ruff | PASS |
| 實測結果與限制已記錄 | PASS |
| M2 整合工作清楚 | PASS |

附帶狀態為 GitHub remote／Project／PR **BLOCKED**，缺少核實的目標。Docker／Linux、8 GB 部署、正式 public-network security 和 production persistence **NOT RUN**，屬後續驗證。第二位學生 review 待安排。

## M2 Readiness

**GO** 接入 FastAPI 和 PostgreSQL 的第一段持久化流程。建議先做 Source、Profile Version、validation report 和人手 approval 的 transaction，保留 `source_id + version` 唯一、immutable config 及 config hash 檢查。用 PostgreSQL integration tests 覆蓋 stale validation、重複批准、重啟後讀回及兩個 concurrent approvals。FastAPI transport 應從受信任身份取得 approver，並呼叫同一套 domain rules。

後續再接 Run／Task、evidence metadata、record identity 約束及持久化的 quarantine。需決定來源撤銷及 in-flight 邊界、檔案／DB rollback 和 orphan cleanup、保留期，以及 schema evolution。公開來源必須另行驗證授權、DNS／TLS、egress、完整 robots 行為和 request budget。
