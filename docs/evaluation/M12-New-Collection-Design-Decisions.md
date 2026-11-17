# M12 新收集工作區設計決策

## 基準與範圍

GitHub M11 分支、本機 HEAD 與已獨立審閱的 commit 均為 `875c94c8f0c358904813fe1c41e1018034713049`。建立 M12 前，本機 M11 工作樹乾淨，遠端未有同名 M12 分支。審閱專案規範、產品及設計文件、M8 契約、M11 決策、React 路由、集合 API、分頁、送出及 Playwright 測試。工作範圍為 New Collection、Request Detail 的交接及現有 Source／Profile 詳情的返回連結。維持 M11 shell、色彩與三種主題模式。

## 低保真結構比較

| 結構與輪廓 | 初次理解與重複操作 | 密度、空間與情境 | 鍵盤、窄版與 M11 shell |
| --- | --- | --- | --- |
| A. 漸進式縱向工作區 `主題目錄 ↓ 核准來源 ↓ 關鍵字及檢閱 ↓ 啟動` | 下一步由資料相依性決定。已選主題收成一列，讓重複操作直接回到來源。 | 目錄內 Category 與 Topic 對齊，來源以清單呈現，底部檢閱列出完整意圖。每段使用內容所需空間。 | DOM 跟隨任務順序。窄版選好分類後收合分類清單，保留改選入口。沿用 M11 導覽與自然捲動。 |
| B. 目錄與組態並列 `[分類及主題] ｜ [來源、關鍵字、檢閱]` | 桌面頻繁跨主題很快。未選主題時右邊無法完成任何操作，初次使用要在兩區之間找下一步。 | 寬版能同時比較，長來源名稱與核准資料會和目錄爭寬度。 | DOM 順序要跨欄，手機回到長串清單。在 M11 側欄旁長期保留第二索引列的空間成本高。 |
| C. 展開式收集畫布 `[主題 ▾] [來源 ▾] [關鍵字 ▾] → [摘要]` | 熟練後跳轉直接。開關、已完成／待完成與設定有效性同時出現在一列，首次辨識成本較高。 | 桌面壓縮得最緊密。收合會隱藏判斷所需的來源版本，錯誤也需要重新定位。 | 手機橫列換行或增加 disclosure 層。焦點須在收合時返回，較難連續對照內容。 |

採用 A。以現有 Cobalt／Slate 構成安靜的操作工作區。主題選擇是目錄，來源是帶核准版本的可勾選清單，檢閱是完整的送出摘要。選取主題收合目錄後保留 Category 與 Topic 的關係，來源變動會更新已選數量並失效之前的檢閱。省去獨立精靈頁與裝飾性的進度 UI。

## 資料與導航規格

- Category 與 Topic 依現有 active-only 清單及 offset/limit 載入。只查詢所選 Category 的 Topic 與所選 Topic 的 bindings。Topic 連結使用現有 `topic_id`，以 Topic 詳情及當前 Category 詳情驗證。未知目錄頁不推斷為空。
- 來源與核准 Profile Version 來自 eligible-only bindings。每個明確選取的 binding 產生一個子 Job，上限四個。檢閱前後以 binding ID 及 pin 欄位對照。送出前重查當前 Category、Topic 及已瀏覽範圍內的 bindings。現有端點缺少按 binding ID 篩選，超出重新載入範圍的 pin 必須透過繼續分頁重新確認。提交時仍由原有交易檢查授權及核准。
- 關鍵字依後端規格以修剪後的 Unicode 字元數與可列印性驗證。使用者可完整編輯超長輸入。只將實際送出的字串放進檢閱。
- 未送出的關鍵字、選取及檢閱只存在同一個 JavaScript 頁面工作階段。路由歷史只帶草稿識別碼，URL 只帶可分享的 Topic。切換情境保留關鍵字並更新來源與檢閱。從詳情返回重查資格。重新載入會重新解析 Topic。
- 首次送出以最新資料核對，未確認的 POST 可用原內容及同一 UUID 恢復。重送由後端先判斷是否為已建立 Request 的 replay，若需建立仍檢查全部資格。成功後替換當前歷史項目為已保存的 Request Detail，舊草稿項目只提供查看 Request 或開始新的收集。
- Request Detail 依已保存的 Job 狀態及有效紀錄計數提供下一步，沿用輪詢、Refresh、文章歷程和下載。

## UI Slop v1.7

結構比較使用 Structural Direction。Category → Topic → binding → Job 是 Information Relationships／Reactive Surfaces 的主軸。Task Continuity 規範返回、選取失效及送出後生命週期。目錄、核取控制、狀態及檢閱各以合適語意呈現，符合 Semantic Diversity。Browser QA、AI Fingerprint、Evidence Gate 與 Taste Gate 的執行結果見 M12 handoff。
