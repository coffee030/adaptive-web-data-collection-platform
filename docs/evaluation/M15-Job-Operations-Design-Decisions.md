# M15 Job Operations 設計決策

## M15-A 稽核

GitHub Compare 顯示 `feature/M14-operator-configuration-workspace` 與已審閱的 `b7cc87d2305c57cd8e5e523efa4ac5f21182de17` 相同。本機工作樹乾淨，M15 由此提交建立。審閱 AGENTS、PRODUCT、DESIGN、M3、M4-E、M4 Closure、M10 Reliability Evaluation、M11–M14 決策，及 vendored UI Slop v1.7 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`)。

| 既有契約 | M15 應用 |
| --- | --- |
| `GET /collection-jobs` 支援五種狀態、oldest/newest、limit 1–100、offset 0–2147483647，依建立時間及 ID 排序 | 20+1 查詢，URL 保存篩選、排序與 offset，設定改變即回第一頁。 |
| Job DTO 保存 claim 次數、publish 嘗試次數、lease、最早重試、派送期限、最後派送、錯誤、時間與結果數量 | 使用各欄位的實際語意。已派送而仍 Pending 時，下一次 dispatch deadline 可代表尚未 claim 的再次派送期限。 |
| Events 依資料庫 sequence 排序，舊事件可能缺 kind 或 attempt | 原順序顯示，原始 kind／ID 可展開。Dispatcher 自動處理到期 lease 與重派；HTTP 沒有執行控制或 Worker 指標。 |
| Source 及指定 Profile Version 有獨立 GET；Job 不提供可讀名稱或 Request ID | 清冊只解析目前頁面唯一的 Source／Profile，並限制並行查詢。Request 關聯由子 Job 導覽保留。 |
| Job-scoped Evidence／Quarantine、Record 篩選及 CSV／JSON export 已存在 | 保留 captures 與 Record 的直接證據關聯。Quarantine 按實際 persistence 列出 invalid candidates；一般重複候選只計入 duplicate count。 |
| POST 接受核准 Source、固定 Profile 及 CSV／HTML 輸入；201 建立、200 同一請求重播、409 衝突 | 先審閱，再提交一筆 Job。發送後保留原始 intent，直至確認建立、重播或明確拒絕。 |

現行清冊在窄螢幕需要橫向捲動，UUID、開始及結束時間佔據主欄。詳情已有輪詢和檢視路徑，但缺少 dispatch、retry 和 lease 判讀。背景讀取失敗會移除最後可讀的快照。提交頁已有輸入驗證及 UUID 回復工具，缺少明確的提交前確認，跨路由也需維持未確認意圖。

## 低保真結構比較

| 選項 | 空間配置 | 使用與實作評估 |
| --- | --- | --- |
| A 清冊＋診斷詳情 | `[Status · Order] → [Source/Job · Status · Results · Created] → [Outcome → Execution → Timeline → Results]` | 一般使用者容易定位所有狀態；篩選足以支援例外排查。詳情可容納完整事件及結果脈絡。窄版每列重新排列 status 與 counts，原有深層 URL 和分頁可沿用。使用現有 list／detail API。 |
| B 例外優先 | `[Failed / Partial queue] ⇄ [Investigation]`，其餘 Jobs 在第二入口 | 重複處理失敗時有效。使用者需要切換工作區才能找到等待或成功的 Job；雙欄壓縮長錯誤和結果，手機需額外切換。要建立一致的例外順序需要多個狀態查詢或新的 API。 |
| C 事件優先 | `[Event sequence with job links] → [Selected execution] → [Outputs]` | 事件適合分析單筆 claim、重試及 recovery；全體事件需要跨 Job 聚合、更多讀取及不同分頁契約。事件密度也使一般使用者難以找到一筆工作及其輸出。 |

採用 A，詳情優先呈現例外。沿用 Cobalt／Slate 的文字、控制元件和主題。清冊用對齊欄位及列分隔線，結果數字保持鄰近。詳情用 outcome、執行欄位和序列化事件分隔三種不同語意，技術資訊可展開。審閱表單把輸入政策和預計建立的 Job 放在相同操作路徑。

## 實作與驗證次序

1. M15-B 清冊及 URL 分頁，保留載入、錯誤、空資料與深層連結。
2. M15-C Job outcome、執行和派送、錯誤與 Events，驗證失敗後可繼續讀取及終態停止輪詢。
3. M15-D Evidence、Records、Quarantine 及 Request 的回程，利用 M13 原有導覽機制。
4. M15-E 受控 Web 與 CSV 的審閱及提交，保留原始 UUID 與寫入復原契約。
5. M15-F/G 執行瀏覽器兩輪檢視、可及性、回歸及隔離 Backend 驗證，記錄實際結果與缺口。
