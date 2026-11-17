# M13 瀏覽器畫面

Pass B 使用 Edge、獨立 Normal 與 Synthetic Demo API，Chrome 另以瀏覽器設定驗證 200% 頁面縮放。畫面內 Demo 內容均為受控 fixture 實際持久化的結果。第 12、13 幅使用 Playwright 暫時控制同一 Records API 的載入及 503，Retry 隨後重接真實 Demo API。

| 畫面 | 檔案 |
| --- | --- |
| 全域清冊及 Request 範圍，1440 px | [01](01-ledger-desktop.png)、[02](02-request-records-desktop.png) |
| 清冊與相鄰 Inspector，1440 px | [03](03-ledger-inspector-desktop.png) |
| Record Detail 與 Evidence Metadata，1440 px | [04](04-record-detail-desktop.png)、[05](05-evidence-desktop.png) |
| Content Versions 與 Observation History，1440 px | [06](06-article-versions-desktop.png)、[07](07-observation-history-desktop.png) |
| 清冊重排 | [900 px](08-ledger-900.png)、[768 px](08-ledger-768.png)、[390 px](08-ledger-390.png)、[320 px](08-ledger-320.png) |
| Dark 模式 Inspector 及 Record Detail | [320 px](09-inspector-320-dark.png)、[390 px](10-record-390-dark.png) |
| Normal 空資料、模擬載入及 API 503，900 px | [11](11-normal-empty.png)、[12](12-simulated-loading.png)、[13](13-simulated-failure.png) |
| Partial Request 的已驗證紀錄及子 Job 狀態，1440 px | [14](14-partial-request-records.png)、[15](15-partial-request.png) |
| Chrome 200% 頁面縮放，實際 CSS viewport 712 px | [清冊](16-ledger-200-percent.png)、[Inspector](17-inspector-200-percent.png) |
| 真實的最新 Version 2 及原 Request 保存的 Version 1 | [18](18-latest-version-and-original-request.png) |

瀏覽器檢查、UI Slop gates 與測試結果載於 [M13 handoff](../../../M13-Implementation-Handoff.md)。
