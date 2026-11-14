# M1 Collection Core Contracts and Architecture

本文件將 [M0 概念 contracts](M0-core-contracts.md) 具體化至受控 Python library。沿用 [M0 ADR](../decisions/M0-architecture-decisions.md) 的 Modular Monolith、Scrapling HTTP／Parser、來源與 Profile 分開批准，以及版本化 ingestion。M1 用同步 `CollectionRunner` 驗證這些邊界，將 Job、Task 及 durable dispatch 留給後續 milestone。

## Source 與 Profile

- `Source` 以 `source_id`、`adapter_type`、`permission_reference` 和 `approval_status` 記錄存取授權。Web 只接受明確列出的 `http://127.0.0.1:PORT`。CSV 以核准 dataset ID 限制輸入，呼叫端提供 bytes。
- `ExtractionConfiguration` 與 `CsvMappingConfiguration` 皆明確指定 `config_schema_version="1"` 和含 `schema_version="1"` 的 `RecordSchema`。欄位名稱唯一，mapping 須逐一覆蓋 schema。Web 的 selector 類型可按欄位覆寫，attribute mode 要求屬性名稱。欄位是否必填由共用 schema 定義。
- `config_hash` 是 canonical JSON 的 SHA-256。JSON keys、field mappings 及 schema fields 按名稱排序，等同預設 selector strategy 的顯式覆寫會正規化。每個 Source 的版本號由 1 開始遞增。
- `ProfileRepository` 在同一程序內管理 Source、Draft、最新 validation report 及版本。修改 Draft 清除其舊 report。Validation 綁定 Profile Version、config hash、sample location、sample SHA-256、時間、counts 和無效紀錄的原因。
- Preview 最多回傳五筆 candidates。Validation 使用同一 ingestion 檢查整份受限樣本，至少有一筆有效記錄、零無效記錄且無讀取／擷取錯誤才算通過。重複筆數保留在報告，供人手核對。
- `approve()` 要求現行 Source 授權、最近且通過的 `report_id` 及顯式 `approver`。批准後的 config、fields 和 schema 以 frozen models 與 tuples 保存。Retirement 保留 approval metadata 與歷史 lookup。新 Run 重新檢查 Source 和 Profile 狀態，HTTP 也在每次請求前檢查 Source 授權。已發出的請求可能完成。

## Adapters 與共享 ingestion

HTML 透過 Scrapling 使用 configured CSS／XPath、重複項目、首個欄位匹配、text 或 attribute、空白正規化和基於最終頁面 URL 的相對連結解析。URL 欄位是資料。Runner 只請求已核准 input URL 和同 origin redirect。CSV 使用標準 `csv` 模組、UTF-8（含 BOM）及逗號分隔。欄位映射產出相同 `CandidateRecord`，並記錄 record 起始的實體行號。行寬錯誤屬可分類的 invalid row，無法解析的 CSV 語法、空檔、缺少必要 columns 及 encoding 錯誤屬 input failures。

`ingest()` 依 schema 處理 string、integer、finite number 和 boolean。缺值、型別不符、未宣告欄位及結構錯誤有欄位或位置資訊。Number 以 Python float 表達，需精確小數的 schema 待後續定義。Dedup 採 first valid wins，每次 Run 獨立。鍵是 source ID、record type、schema version、identity kind 與已正規化的值。若 identity 缺少，使用 canonical payload；其 `source_record_key` 為 null。對同一輸入重跑，`record_id` 穩定，`run_id` 和 `evidence_id` 各自新建。

## Runner 結果及 Evidence

- `completed` 有有效資料且零無效資料，重複筆數另外列出。 `partial` 同時有有效及無效資料。 `failed` 代表 gate、input、evidence 或整份資料驗證失敗。
- `LocalEvidenceStore` 以 UUID 作目錄名，保存 `input.bin` 和 `metadata.json`，兩檔先寫到同一檔案系統的 staging 位置再發布。Record 建立前須保存成功。可取得完整 bytes 的 HTTP／解析失敗亦可保存 evidence。Timeout、拒絕存取及超限情境可能沒有完整 evidence。
- `GenericRecord → evidence_reference → metadata + input.bin`。Metadata 含 source ID、run ID、profile version ID、config hash、UTC 擷取時間、SHA-256、requested／final URL 或 dataset ID，以及 HTML status／content type。Record 含起始 CSV 行或一基 HTML 項目、provenance 和 validation status。使用 `LocalEvidenceStore.resolve()` 可讀回並核對 hash。
- Store root 由可信呼叫端配置。Filesystem evidence 可供本機重開後讀取，Source、Profile approval、validation reports、run results 和 quarantine state 由呼叫程序保管。

## 受控 HTTP 邊界

單文件、最多兩次同 origin redirect、每個請求 timeout 2 秒及一次嘗試。HTML／CSV 最多 1 MiB，最多 10,000 項或行。HTTP 傳輸關閉 auto-follow、瀏覽器 impersonation、stealth headers 和環境 proxy，使用專案 User-Agent。請求前核對 origin 和 robots，遇 HTTP 401／403 或明確 challenge header 停止。429、5xx 和 timeout 各有失敗結果，`Retry-After` 排程屬後續工作。robots timing directives、取得失敗及 redirect 採拒絕方式，404／410 表示受控站沒有 robots 檔。完整公開網站的 DNS／TLS／egress policy、ratelimit、通用 block marker、跨頁 discovery 和長期 evidence retention 留待後續驗證。
