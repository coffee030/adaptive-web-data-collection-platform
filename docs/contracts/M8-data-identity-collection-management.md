# M8 資料識別與收集管理

## 操控台流程

1. 在 **Sources** 登記及授權網站，驗證及核准 Keyword Search Profile。若需要文章歷史，在 Profile 的 **Article mapping** 啟用 **Store article history**，將文章欄位對應到已宣告的輸出欄位，再使用既有 Profile 審核流程。
2. 在 **Sources → Categories and topics** 建立 Category 和 Topic。從 Topic 開啟 **Manage approved bindings**，選擇已授權的 Source、已核准的 Keyword Search Profile Version，填寫操作者標籤並選擇 **Approve binding**。
3. 從 **New Collection → Collect by topic** 先選 Category，再選該 Category 的 Topic。各選項清單逐頁載入，按 **Load more** 可繼續。輸入 1–128 個可列印字元的關鍵字，選擇最多四組可執行的綁定。每組啟動一個既有 Collection Job。HTML／CSV 單一來源流程仍在 **New Collection** 內。
4. 在 Request Detail 查看子 Jobs、個別失敗原因和本次觀測到的 Articles。**Refresh collection** 建立連回原 Request 的新一輪收集。從 **Data Explorer → Browse articles** 亦可開啟文章最新內容、歷史版本、原始擷取值與 Evidence。

本機操控台使用既有 `LOCAL_PROFILE_APPROVAL=1` 的 Vite loopback 模式調整綁定。API 使用既有 loopback Host／Origin 邊界，並驗證 Source 授權、Profile 狀態、綁定狀態和輸入路徑。操作者標籤供審核紀錄，部署模式為 trusted local。

## API

所有路徑以 `/api/v1` 為前綴。分頁清單接受 `limit`（預設 50，上限 100）和 `offset`。

| 路徑 | 操作與輸入 |
| --- | --- |
| `/categories`、`/categories/{id}` | GET 清單或明細，清單可用 `active_only` 篩選。POST 建立，PUT 編輯 `name` 和 `active`。 |
| `/topics`、`/topics/{id}` | 同上。建立時加 `category_id`，清單可用 `active_only`、`category_id` 篩選。 |
| `/topics/{id}/bindings` | GET 清單（`eligible_only=true` 只顯示可執行綁定）。POST 提交 `source_id`、`profile_version_id` 和 `approved_by`，明確核准指定版本。 |
| `/topics/{id}/bindings/{binding_id}/disable` | POST 停用原綁定。 |
| `/topics/{id}/bindings/{binding_id}/approve` | POST 以 `approved_by` 重新核准停用綁定。 |
| `/collection-requests` | GET 近期執行清單。POST 以 `topic_id`、`keyword`、`binding_ids` 和 UUID `request_key` 提交。 |
| `/collection-requests/{id}` | GET 執行詳情、子 Jobs、綁定與核准快照。 |
| `/collection-requests/{id}/refresh` | POST UUID `request_key` 後建立新執行，並透過 `refresh_of` 追溯前一輪。 |
| `/articles`、`/articles/{id}` | GET 最新文章清單或明細。清單可按 `request_id` 篩選曾在該次執行觀測到的文章，內容顯示各文章在所有執行中的最新觀測。 |
| `/articles/{id}/versions`、`/articles/{id}/versions/{version_id}` | GET 歷史版本目錄或單一版本的共用欄位。 |
| `/articles/{id}/observations`、`/articles/{id}/observations/{record_id}` | GET 觀測目錄或單一觀測的 lineage 及 `raw_payload`。 |

Request 和 Refresh 首次成功回應 HTTP 201。同一 UUID 和相同內容的 replay 回應 200。用相同 UUID 更換執行意圖回應 409，選取綁定的順序可互換。停用 Category、Topic 或任一既有綁定後須恢復資格才能再執行，Source 撤銷回應 403，Profile 退役回應 409。資格不符時整次提交回滾。已建立的 Jobs 依 M7 的執行及撤權政策運行。

新 Request 保存 Topic ID、當時名稱和固定的關鍵字。每個子 Job 保存 Source、Profile Version、設定 hash，關聯列另保存綁定 ID 和核准標籤與時間。Refresh 複用同一組執行設定及核准快照，檢查目前的執行資格。Topic 改名或綁定變更後，原 Request 歷史資料可繼續讀取。Parent 在所有 Jobs 未開始時為 `pending`，已開始而仍有非終態 Jobs 時（包括重試等待）為 `running`。所有 Jobs 終結後，全數成功為 `succeeded`，全數失敗為 `failed`，其餘結果為 `partial`。

## 文章映射、識別與版本

`configuration.article` 套用到已核准的 Keyword Search Profile。 `title` 必須對應必填文字輸出。可選 `canonical_url`、`author`、`published_at`、`summary`、`body` 對應文字，`stable_id` 可對應文字或整數。省略 article 設定會保留 M7 Profile hash 和 Generic Record 行為。

- URL 識別使用核准映射的 canonical URL，或在未設定 canonical 欄位時使用實際詳情 URL。驗證沿用 Source 的 origin 和 path 規則，規範化百分號編碼，移除 fragment，保留 query 的內容與順序。URL 識別只適用於一個候選項目的詳情頁。一次 Job 內互相衝突的 canonical URLs 會略過文章投影。
- 同頁多項可用明確穩定鍵識別，穩定鍵優先並須由該 Source 提供。此鍵在整個 Source 內須唯一，當次缺值會略過文章投影。Source ID 和「URL 或穩定鍵」加上其值共同決定身份。不同 Sources 各有各的 Article，變更識別策略可能建立新 Article，舊歷史繼續保留。
- 成功擷取的 Detail Evidence 和通過驗證的 Generic Record 才可建立觀測。資料包含 Source、Profile／hash、Job、Record、Evidence、收集時間和版本連結。 `raw_payload` 是 adapter 擷取後、Generic Record 型別轉換前的欄位，UTF-8 JSON 上限 1 MiB。原始 HTML 仍存於 Evidence store；無合格文章投影的 Generic Records 仍正常發布。
- 內容 hash 涵蓋 title、author、published_at、summary、body。文字使用 NFC 並合併空白，具時區的 ISO 日期時間轉 UTC。缺少可選欄位保存為 null，提供無法解讀的發布時間則略過文章投影。Job、Evidence、收集時間、URL 和未映射欄位不參與 hash。再次觀測到同一內容會複用版本，包括回到先前的內容狀態。
- Article、Content Version 和 Observation 隨鎖定的 Job 終態交易發布。SQL uniqueness 與逐 Article 鎖處理並行。每筆 Generic Record 最多一筆 Observation。Latest 選擇 Evidence 收集時間最新的 Observation，同時間以 Record UUID 排序。版本編號按新內容提交次序分配。搜尋沒有找到文章或抓取失敗時，先前觀測仍可讀取。

## 資料庫

Alembic `0009` 在 `0008` 上新增八個資料表，原有 Source／Profile／Job／Record／Evidence／Quarantine 資料不需轉換。Case-insensitive Category 名稱、Category 內 Topic 名稱、綁定、Request key、Article identity 與 Content Version hash 使用資料庫唯一限制。觀測用 Record FK 追溯 Evidence，並用 composite FK 固定 Article／Content Version 組合。生產資料需要保留 M8 歷史時，先備份 PostgreSQL 及 Evidence volume，再執行會移除 M8 表的 downgrade。
