# M5 Core Evaluation Plan

以隔離 Docker Compose、Linux prefork、合成資料及本機 API 評估可信本機 Core。主機、Docker VM、套件版本、實際 sample sizes 及原始測量位置見結果文件。每次測試用新的 Source 及 request keys。1／2 workers 使用同一 image、fixture、容量限制和 4-job client concurrency。

| 實驗 | Hypothesis 及 procedure | 預定樣本與指標 | 限制 |
| --- | --- | --- | --- |
| A／B 正確性、validation、dedup | 人工閱讀 `table.html` 和 `listings.csv`，先固定預期 payload、position、問題類別及 counts。以 REST 走 Source 授權、Draft、Preview、Validate、Approve、Job，再核對 Records、Quarantine、Evidence metadata 和磁碟 bytes。 | 每次執行 HTML／CSV 各 1 Job。比較完整欄位、位置、null、型別、缺值、錯誤、duplicates、SHA-256、lineage、event 順序。 | 兩個 fixture 屬測試工作負載，無外部 precision／recall 推論。Preview 本身最多 5 筆。 |
| C Reliability | 現有 live pytest 重現 Redis stop/start、Worker SIGKILL、真實 90 s lease 到期、duplicate messages、replica contention、API/DB restart。Browser 驗收重播 DB outage 前後同一 Job key。 | 每個 failure case 在 final suite 至少 1 次。時間採可驗證的同 clock events 或新量測 monotonic elapsed。核對結果列、單一 terminal event、bytes 及前／後 snapshots。 | 固定本機拓撲。針對個別 failure，故障組合、斷電及 durable disk corruption 未覆蓋。 |
| D／E Timing and concurrency | 先量一次 API cold-ready 及首個 HTML Job，warm suites 以 4 個 client requests 並行，連續 3 批，每批提交各 2 HTML／CSV Jobs。每個 Job 以同 key replay，並查所有輸出及 events。依序比較 1／2 prefork replicas。 | 每個 topology 12 warm Jobs，報 min／median／max，Job/s、accepted Records/s、CPU % 和 MiB sample。POST 及 GET 用 `perf_counter`。Job end-to-end 用同 clock 輪詢至 terminal，包含輪詢延遲。 | DB 的 created／last dispatched 差為 durable admission 到最後一次 publication 確認；started／finished 差包含 capture 及結果準備，finished timestamp 早於 commit。不可當成純 parsing 或 queue transport latency。小樣本不支持 SLO。 |
| D Record processing | 對同一 bytes 和 Profile 單獨運行 Candidate extraction + shared `ingest`，以 warm monotonic clock 量測，另生成 500 CSV rows 展示較大批次及核對 count。 | 每種 1 warm-up + 10 timed iterations。記錄 fixture 大小和候選數。 | In-process CPU 路徑包含 decode／parser／normalize／dedup，排除 HTTP、SQL、Evidence I/O。與 worker wall clock 用途不同。 |
| F Maintainability | 手動核對 routes/OpenAPI、layers、lockfile、migration、failure contracts、log redaction、Compose boundary、tests 和 runbook。 | 1 次審查及 RC 版本全量 rerun。 | 以代碼和運行結果作證據。正式組員覆核和人工可用性驗收待獨立安排。 |

重現命令與測試環境見 [M5 Demo Runbook](../demo/M5-core-demo-runbook.md)。設 `M3_TEST_COMPOSE_API_URL` 及 `M3_TEST_COMPOSE_PROJECT` 後執行以下命令。每次 worker topology 為獨立 run，先確認所有 worker ready。兩次拓撲比較之間不並行執行 live regression。

```powershell
.\.venv\Scripts\python.exe -m backend.experiments.m5_evaluation --workers 1
docker compose @composeArgs up -d --wait --scale worker=2 worker
.\.venv\Scripts\python.exe -m backend.experiments.m5_evaluation --workers 2
docker compose @composeArgs up -d --wait --scale worker=1 worker
```
