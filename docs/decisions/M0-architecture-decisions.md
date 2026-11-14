# M0 Architecture Decisions

2026-11-14（香港時間）。決策記錄以本次已確認的 MVP 方向為準。後續同儕審查待進行，涉及正式 Proposal 的更改須按學校和組內流程確認。

## ADR M0-01 Modular Monolith 與單一排程權責

- **背景** Core 初期由一人開發，需保留可獨立擴充的 workers 和可重現測試。
- **決定** 保留 Modular Monolith 加獨立 Celery workers。FastAPI 和 Celery 共用 domain 與 application services，各自持有自己的 DB session／transaction。Celery／Redis 派送，PostgreSQL 保存 durable state。Scrapling 只做 HTTP 和 HTML。
- **替代方案** 同步 FastAPI 執行、獨立 microservices 或另外加入 Scrapling Spider 排程。
- **理據** 同一 Python 專案降低部署和共享 contract 的成本。單一派送機制使 attempt、quota 和狀態的責任清晰。
- **取捨** 需處理 DB commit 與 queue publish 的失敗窗口，且獨立 worker 仍要實測序列化和重複派送。
- **後果** M2／M3 須驗證 durable dispatch、idempotent writes、commit-before-ack 和 terminal state 保護。初期以簡單 DB-backed dispatch recovery 為候選方案。
- **狀態** MVP 架構已確認。派送一致性設計待驗證。

## ADR M0-02 Scrapling HTTP 與平台 Source Access Policy

- **背景** Formal Proposal 列 HTTPX／Beautiful Soup 和有限 Playwright。Spike 證實 Scrapling 能處理本次的兩種靜態 HTML、HTTP status 和 metadata，並測得預設 browser-like headers、redirect 及 retry 行為。
- **決定** MVP 採 Scrapling HTTP／Parser。Platform wrapper 管理來源授權、初始及每跳 URL、robots、request budgets、固定 project UA、timeouts、錯誤分類及重試。對正式流量關閉自動 redirect 及 browser impersonation。
- **替代方案** 沿用早期 HTTPX／Beautiful Soup，或直接依賴 Scrapling 的預設安全與重試行為。
- **理據** Fixture 結果支持已確認的技術選型。預設會加 Chrome headers 和 Google Referer，並在 timeout 時自行重送，需明確控制。
- **取捨** 0.5.1 HTTP import 需要 Patchright package。Production DNS pinning、TLS、環境 proxy 和 response size enforcement 仍有技術風險。
- **後果** M1 先走受控站。公開來源需驗證 egress 可維持核准 IP、Host／SNI 及 TLS，並具備安全策略測試後才啟用。
- **狀態** MVP 技術方向已確認。正式 Proposal 的技術差異待 Supervisor 確認。

## ADR M0-03 已批准版本與可追溯 ingestion

- **背景** 通用 Core 同時收 web 和 CSV，需要可重現、可審查的資料 lineage。
- **決定** 分開 Source 存取授權及 extraction profile approval。Job 固定參照已驗證並人手批准的 immutable Profile Version。Web 和 CSV 產生同形 candidates，經共用 validation、dedup、evidence persistence 後提供 versioned Generic Records。
- **替代方案** 每次 Job 讀取當前可變設定，或為 CSV 和 Web 各自維護持久化流程。
- **理據** 版本、config hash 和原始 bytes 支持重現與稽核。下游 ML／IA 可依各自的 payload schema 使用相同 Core 介面。
- **取捨** 加入 approval 狀態、驗證報告及 evidence 容量管理。來源撤銷和跨來源 dedup 需要具體規則。
- **後果** M1 應驗證 draft 修改失效、批准後不可改、未批准版本不能開 Job、CSV／Web lineage 及 invalid candidate handling。正式 storage、retention 和交易邊界留待 M2。
- **狀態** 概念規則已確認。Schema、retention 和權限設計待定。

## 與正式 Proposal 的差異和交付追蹤

| Proposal 條目 | M0／初期 Core 的處理 |
| --- | --- |
| §4.4、§5.4 和 FR06 的 HTTPX／Beautiful Soup／Playwright | M0 實測 Scrapling 靜態 HTTP 和 CSS／XPath。動態瀏覽器渲染屬後續正式交付範圍，技術差異待確認。 |
| FR01–FR05 | Source 及 Profile rules 先以概念 contract 表達。正式角色、視覺 selector、排程、pause/resume、cancel 和 discovery 實作分階段交付。 |
| FR07–FR08 | M0 取得 headers、429、timeout 和 redirect 證據。正式 robots、跨 worker rate control、cache、adaptive backoff、授權 proxy health／failover 仍待驗收。 |
| FR09–FR15 | M0 只有 extraction 候選紀錄及契約。Durable workers、validation／dedup、dashboard、資料搜尋／匯出、REST API、heartbeat／lease recovery 和 audit 屬後續工作。 |
| §5.3 NFR、§7 Evaluation、§8 Schedule、D1–D9 | 保留正式交付及評核項。包括 1／2／4 workers 對照、2 workers ≥1.5 倍吞吐、field precision／recall ≥95%、duplicate product URL <1%、10 分鐘配置目標、3 秒 dashboard 更新、worker recovery、proxy failover、8 GB Windows 11／WSL2 Compose。M0 的 fixture suite 只支持本機技術選型。 |

ML Section B 要求有權使用的資料集、模型訓練和測試結果、程式與報告。IA 的資料來源、平台、matching criteria 和 acceptance criteria 待確認。這兩個 downstream workstreams 將透過帶 schema version 及 provenance 的 Generic Records 連接 Core。
