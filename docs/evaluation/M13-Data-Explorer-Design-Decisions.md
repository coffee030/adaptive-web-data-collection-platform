# M13 Data Explorer 設計決策

## 審核與實作次序

本機工作樹乾淨，GitHub 的 M12 branch 和已獨立審閱版本均為 `432119acc2ec0860d316877577bf0efd4c2db9c1`。遠端尚未有同名 M13 branch。專案規範、產品、設計、M11／M12 決策、M8 契約及 vendored UI Slop 1.7.0（`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`）為設計依據。檢查 results、Article、Request、App shell、路由／分頁 helper、瀏覽器測試，以及 FastAPI、application 和 persistence 契約。

1. 清冊以既有 REST 範圍、排序和分頁為主，保留動態欄位和 Job 品質入口。
2. 只在選取時打開 Inspector，重用紀錄內容於獨立 Detail。
3. 依真實 Evidence reference 接上儲存的 metadata，保留由 Job 搜尋／詳情擷取進入的脈絡。
4. 為版本和觀測加入可分享的選取與分頁，沿用既有下載。
5. 驗證第二及第三次瀏覽、巢狀返回、隔離資料、回歸、可及性和兩輪瀏覽器檢視。

## API 與關聯

Category → Topic → Collection Request → Child Job → Generic Record → Capture Evidence。單來源 Job 可以獨立存在。Record 清單只查已發布的通過驗證紀錄，支援 `job_id`、`request_id`、`limit`、`offset` 和 `order=oldest|newest`。後端以保存時間及 Record UUID 排序，同時送兩個 scope 時求交集。Request 不存在時回應 404，未知 Job 可以回傳空清單。UI 採單一範圍並提示衝突，避免解除條件後顯示意外資料。每頁顯示 10 筆，以第 11 筆判斷下一頁。

頁面主要關聯為 Record 的標題、型別、來源和欄位摘要。Inspector 以 `include_lineage=true` 補上 Request 及 Article 關聯，依外鍵顯示來源、固定的核准 Profile Version、Job、Evidence 及保存時間。Run ID、來源位置、設定和去重雜湊在深層檢查區。證據端點提供擷取種類、頁次、UTC 時間、位置、安全 HTTP 狀態及後端記錄的 SHA-256。網址只呈現 origin 和 path，CSV 使用 dataset ID。Job 的搜尋及詳情擷取仍各自可查。

有效映射會由 Generic Record → Observation 連到 Article、Content Version 和 Detail Evidence。版本是內容身份，同一內容可被數次觀測。Latest 由最新觀測決定，即使重新觀測到舊版本。Article 清單的 Request 範圍只決定成員，Article Detail 的 latest 及版本目錄跨收集。只有 Observation 清單接受 Request 篩選，單筆觀測要依回傳的 request_id 驗證。觀測提供原始擷取欄位及自己的 Record、Job、Evidence、Profile、Request 和版本。無映射的 Generic Record 保留完整流程。

下載沿用 Job／Request CSV、JSON 完整範圍端點，所有關聯 Job 必須終結。既有 5,000 筆及 8 MiB 限制、檔名及錯誤回饋適用。全域清冊提供瀏覽，下載入口跟隨有資格的範圍。Quarantine 由 Job 品質或 Request 的子工作導航。

## 低保真結構與選擇

| 方案 | 瀏覽、操作、密度、關聯 | 鍵盤、手機、效能與整合 |
| --- | --- | --- |
| A. `[清冊] ｜ [選取後的 Inspector]` | 每列可檢查，寬版保留鄰近紀錄，右側集中內容及 Evidence。收合後恢復清冊全部空間。 | 原生連結／按鈕，窄版切換成單一可讀表面。只查選中的 Detail，保留獨立路由。需要管理 URL 選取與焦點。 |
| B. `[全寬清冊] → [獨立 Detail]` | 清冊密度最高。每筆查證都要離開瀏覽表面，重複操作依賴 Back。 | 鍵盤／手機沿用現有換頁。整合簡單及同時呈現資料最少，跨紀錄比較成本高。 |
| C. `[列] ↓ [展開詳情] ↓ [列]` | 行內可讀，Evidence 靠近資料。長欄位與 lineage 推開下一筆，列表捲動位置不穩。 | DOM 次序直覺，手機單欄。長細節重排和焦點復原複雜，表格欄位難維持；限制單一 Detail 可控制請求。 |

採 A。安靜、精確的 Cobalt／Slate 工作區以清冊關聯、選取對齊和內容層級呈現。資料列、狀態、控制項和 provenance 各用合適語意。Inspector 在寬版相鄰，狹窄工作區使用全寬檢查。優先呈現實際內容及查證動作。使用 Structural Direction、Information Relationships、Reactive Surfaces、Task Continuity、Semantic Diversity、Information Design、Responsive Layout 和 Accessibility；Browser QA 依 AI Fingerprint、Evidence 與 Taste Gate 檢視。

## 導覽與狀態

- 可分享狀態由 URL 保存。Records 使用 `job_id` 或 `request_id`、`order`、`offset`、`record_id`。更換範圍或排序時回第一頁。選取先向伺服器驗證 Record，再檢查其歸屬及當前頁成員資格。離開分頁的紀錄仍有獨立 Detail 入口。
- Article 使用 `request_id`、`version_id`、`observation_id` 及兩份頁面 offset。版本和觀測各自對應已選對象。觀測提供連到實際版本的動作。
- 明確返回由內部 URL 恢復情境。有同頁工作階段歷史時返回原項目，以便復原捲動和焦點。獨立紀錄與證據網址各有安全的 Job Records 或 Data Explorer 後備。React Router ScrollRestoration 繼續管理全域路由。
- 顯示欄位以 scope 管理，同一分頁的 JavaScript 工作階段內以有界暫存保存欄名和勾選，選項由已看過的頁面累積。標題以 title、name、headline 的順序選取。預設摘要優先使用 summary、description、price、count，其餘按名稱排序並最多顯示三欄。Missing、Null、(empty)、0、false 各自保留。欄位設定只影響顯示。瀏覽器儲存不寫入 Record、Evidence 或 Article payload。
