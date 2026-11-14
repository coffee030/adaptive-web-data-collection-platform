# M5 Core Capability Gap Matrix

對照本機 FYP Proposal §5.1、§5.3、§7 和 §9（FR01–FR15、D1–D9），以及後續 M0–M5 範圍。整個 FR 有未完成部分時列為 LIMITED。實際測試範圍見 [M5 Test Results](../experiments/M5-test-results.md)。

| Proposal | Capability | 分類 | 已有證據及差距 |
| --- | --- | --- | --- |
| FR01 | 使用者及角色 | OUT OF MVP SCOPE | Loopback Host／Origin、可信 operator label。Production authentication／RBAC 需獨立設計批准。 |
| FR02 | Visual source configuration | IMPLEMENTED BUT LIMITED | Console 表單、CSS／XPath、欄位與 dataset mapping、Preview／Validation。DOM click-to-select、selector generation 和配置 pagination 未交付。 |
| FR03 | Reusable source profiles | IMPLEMENTED AND VERIFIED | Draft revision、immutable Approved Version、retire、Source approval／revocation；同一 adapter 由配置處理不同 fields。 |
| FR04 | Job management | IMPLEMENTED BUT LIMITED | 手動 submit、idempotency、history、監控及自動 recovery。Schedule、pause/resume、cancel 為 proposal gap。 |
| FR05 | Discovery／pagination | PLANNED / NOT IMPLEMENTED | 每 Job 一份輸入。未跟隨 extracted links，無分頁 crawl 或 URL task frontier。 |
| FR06 | Static／dynamic fetch | IMPLEMENTED BUT LIMITED | Scrapling 靜態 HTTP 替代 Proposal 的 HTTPX／Beautiful Soup。Playwright 驗證 Console。Dynamic collection、arbitrary public crawling 仍在 MVP 範圍外。 |
| FR07 | Polite request control | IMPLEMENTED BUT LIMITED | robots、固定 UA、timeout、bounded redirects／attempts、429／5xx 重試；robots timing 規則未能執行時採拒絕。Shared per-domain rate、cache、jitter、完整 public policy 尚有差距。 |
| FR08 | Proxy pool／failover | OUT OF MVP SCOPE | 無 proxy registry／routing；M5 禁止 proxy rotation 或規避封鎖。 |
| FR09 | Extraction／normalization | IMPLEMENTED AND VERIFIED | HTML DOM content 和 CSV mapping，string、integer、number、boolean、required/optional。受控樣本比對。 |
| FR10 | Validation／dedup | IMPLEMENTED BUT LIMITED | 欄位類型、required、per-Job first-valid-wins、Quarantine。無通用 ranges、全域 URL/page dedup。 |
| FR11 | Distributed execution | IMPLEMENTED AND VERIFIED | Redis／Celery，1／2 replicas 和 duplicate claim；MVP 受控規模。四 replicas／internet scale 未驗證。 |
| FR12 | Monitoring | IMPLEMENTED BUT LIMITED | Job states、ordered events、counts／錯誤、可見 detail 約每輪後 3 s 排程刷新。無 fleet heartbeat、queue dashboard、alerting 或 aggregate latency。 |
| FR13 | Failure recovery | IMPLEMENTED AND VERIFIED | Redis outage、worker kill／lease、stale attempt fencing、DB interruption、bounded retries；測試支援 at-least-once delivery 及 commit protection。 |
| FR14 | Output delivery | IMPLEMENTED BUT LIMITED | Documented JSON REST、Record filter／detail。無 CSV file export、全文搜尋、raw bytes HTTP。 |
| FR15 | Audit trail | IMPLEMENTED BUT LIMITED | Source、Profile、Job、Run、position、Evidence SHA-256、time、failure history。缺 worker identity audit 及集中式安全 audit。 |
| §4.5／§7 | Schema-change detection | IMPLEMENTED BUT LIMITED | no-records、missing field、wrong type、Quarantine。無統計 drift alert、自動 selector repair 或 AI agent。 |
| §5.3／§7 | Performance | IMPLEMENTED BUT LIMITED | 1／2 workers 重跑同一 bounded workload，報告實測值。4 workers、1.5× proposal target、共享 quota 和總體吞吐能力無普遍驗證。 |
| §5.3／§7 | Data quality | IMPLEMENTED BUT LIMITED | 小型 fixture 的獨立預期輸出和實際結果。未建立代表性 product URL 樣本與普遍 precision/recall。 |
| §5.3／§7 | Usability／portability | IMPLEMENTED BUT LIMITED | 可重演 Console、keyboard／axe、Docker＋Vite、資源樣本；10-minute user study、物理 8 GB、手動讀屏、實機 Safari 仍待測。 |
| D1／D4／D7 | Core design、Evidence、deployment | IMPLEMENTED AND VERIFIED | ADR、migrations、architecture review、loopback Compose、獨立 volumes、operator runbook。 |
| D2／D3／D5 | Console、worker engine／request control | IMPLEMENTED BUT LIMITED | 見 FR02–15 差距。 |
| D6 | Controlled environment | IMPLEMENTED BUT LIMITED | Compose 靜態 fixture 及測試程序注入 HTTP 429、5xx、redirect、delay、markup change。全功能 test-site sandbox 尚欠。 |
| D8／D9 | Evaluation、documentation | IMPLEMENTED BUT LIMITED | 有自動測試、可重跑 Core 實驗和 demo。人類 reviewer／user study、較廣資料集和最終學校文件待安排。 |
| M6／M7 | Sentiment／IA consumers | PLANNED / NOT IMPLEMENTED | Core REST read contract 可用；domain pipeline、模型與 IA 需求由各 milestone 負責。 |

**Adaptive** 指可配置 extraction、schema mapping、Preview／Validation、版本化及按 failure 分類的 retry。**Scalable** 在現階段指用共享 queue 增減獨立 Worker 與 DB fencing，測量範圍僅受控及 bounded。**Observable** 指 Job、events、counts、quarantine 和 Evidence lineage，fleet metrics、tracing 和 alarms 尚在能力差距內。
