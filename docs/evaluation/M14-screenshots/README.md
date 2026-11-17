# M14 瀏覽器證據

使用桌面 Microsoft Edge 157.0.4341.60 擷取。測試用的 Source、Topics、操作者標籤與紀錄來自隔離資料庫、受控 fixture 或明確標記的 Playwright mocks。

| 畫面 | 證據來源 |
| --- | --- |
| [01 Normal 空 Catalog](01-normal-sources-empty.png) | 全新、獨立遷移的 PostgreSQL，讀取真實空陣列。 |
| [02 Source Catalog](02-source-catalog.png) · [03 註冊](03-source-registration.png) | 隔離 Core 與受控網站欄位。 |
| [04 Pending](04-source-pending.png) · [05 Approved](05-source-approved.png) · [06 Revoked](06-source-revoked.png) | 真實 Source 及人工操作對應的 API 結果。 |
| [07 Profile Editor](07-profile-editor.png) · [08 Validation](08-profile-validation.png) · [09 Approval Review](09-profile-approval-review.png) · [10 Immutable Profile](10-profile-immutable.png) | 受控 HTML、實際保存版本、驗證報告與核准。 |
| [11 Category／Topic](11-category-topic.png) · [12 無可用 Binding](12-no-eligible-binding.png) · [13 Binding 檢閱](13-binding-approval.png) · [14 Bindings](14-bindings.png) | 真實分類、主題、版本資格與核准紀錄。 |
| [15 New Collection](15-new-collection.png) | 真實 Topic 深層連結，選定兩項已再次驗證的綁定，畫面擷取於送出前。 |
| [16 Profile 手機深色](16-profile-mobile-dark.png) · [17 HTTP 503 恢復](17-source-recovery-503.png) | Playwright API mock。 |
| [18 900px Dark](18-bindings-900-dark.png) · [19 768px System](19-bindings-768-system.png) · [20 390px Dark](20-bindings-390-dark.png) · [21 320px Light](21-bindings-320-light.png) | Playwright API mock。System 使用深色媒體偏好。 |
| [22 Source 200%](22-source-edge-zoom-200.png) · [23 Binding 200%](23-binding-edge-zoom-200.png) · [24 Profile 200%](24-profile-edge-zoom-200.png) | 以唯讀方式瀏覽既有隔離 Synthetic Demo。Edge 原生 200%，DPR 2、708 CSS px，文件寬度與 viewport 一致。 |
