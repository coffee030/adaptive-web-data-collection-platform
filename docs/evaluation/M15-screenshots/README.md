# M15 瀏覽器畫面

畫面由 Chrome 產生。隔離 PostgreSQL／Celery／Redis 的畫面以 `persisted-` 開頭，Normal 空清冊也來自全新隔離資料庫。其餘畫面來自 Playwright 測試替身，方便重現固定狀態。測試替身不會載入產品 UI。

| 畫面 | 證據 |
| --- | --- |
| 清冊與篩選 | [1440 Light](ledger-1440.png)、[900 Light](ledger-900.png)、[768 System Dark](ledger-768.png)、[390 System Dark](ledger-390.png)、[320 System Dark](ledger-320.png)、[Failed 篩選](ledger-failed-filter.png) |
| 活躍 Job | [首次 Pending](pending-job.png)、[Running lease deadline](running-lease-deadline.png)、[重試排程與派送錯誤](retry-and-dispatch-failure.png)、[真實重試排程及事件](persisted-scheduled-retry.png)、[真實 Redis 派送失敗](persisted-dispatch-failure.png) |
| 終態與事件 | [Partial 1440](partial-1440.png)、[Partial 390 Dark](partial-390.png)、[第三次執行後 Failed](failed-job.png)、[真實 Failed](persisted-failed.png) |
| 結果與來源證據 | [真實 Detail Page 證據](persisted-detail-evidence.png)、[Quarantine 驗證問題及來源位置](quarantine.png) |
| 提交 | [引導式受控 Web](guided-web-review.png)、[固定版本 CSV](contextual-csv-review.png)、[提交未確認](uncertain-submission.png) |
| Normal 與縮放 | [全新 Normal 清冊](normal-empty.png)、[Chrome 原生 200% 清冊](ledger-chrome-200-percent.png)、[Chrome 原生 200% 診斷](detail-chrome-200-percent.png) |

兩輪檢視比較桌面欄線、窄版資料列及結果入口。第二輪確認欄首和內容對齊、320 px 的篩選版面，以及 Record 預覽和 Evidence 連結可以在窄版完整讀取。200% 畫面以 Chrome Appearance 的 Page zoom 設定產生，從 1440 CSS px 基準重排到 720 CSS px。

在 `frontend/` 設定 `M15_CAPTURE_DIR=../docs/evaluation/M15-screenshots`，用 Chrome 執行 `npm.cmd test -- jobs.spec.ts job-create.spec.ts` 可更新測試替身畫面。真實畫面需要交接文件所列的隔離 API 與對應整合測試。
