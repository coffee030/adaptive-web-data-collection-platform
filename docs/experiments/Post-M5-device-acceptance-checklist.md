# Post-M5 Device Acceptance Checklist

以下是使用者於 2026-11-14 延至 M5 後的獨立驗收。每項狀態為 **DEFERRED / NOT RUN**。

| Check | 狀態 | 後續實測紀錄 |
| --- | --- | --- |
| [ ] iPhone／iOS Safari | DEFERRED / NOT RUN | 機型、iOS／Safari、viewport，記錄 Source／Profile／Job／Evidence 流程和 touch、focus、檔案貼上。 |
| [ ] macOS Safari | DEFERRED / NOT RUN | Mac、macOS／Safari，記錄相同流程、鍵盤和 layout。 |
| [ ] 實體 8 GB Windows 電腦 | DEFERRED / NOT RUN | Windows／WSL2、Docker 配置、可用 RAM、cold start、實際 demo／restart、主機和各 service RAM／CPU。 |
| [ ] 個人裝置與自訂環境 | DEFERRED / NOT RUN | 原有本機 ports／Docker／runtime 環境、明確採用的參數和整合結果。 |
| [ ] 人工 screen-reader | DEFERRED / NOT RUN | 使用者實際操作並記錄讀出內容、focus、更新及錯誤、兩種 workflow。 [Narrator 操作](../reviews/M4-narrator-acceptance.md) |

Playwright Windows WebKit、viewport、keyboard 和 axe 檢查屬 M5 自動驗證證據。實機結果及 WCAG 全面合規需各自驗收。組員正式 code review 另行安排。 [M4 授權決策](M4-final-closure-review.md#2026-11-14-使用者授權與驗收範圍更新)
