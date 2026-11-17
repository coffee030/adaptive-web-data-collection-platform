# M16 發行候選與整合決策

驗收依據為 [最終 MVP 驗收](M16-Final-MVP-Acceptance.md)。展示順序和復原流程見 [FYP Presentation Runbook](M16-FYP-Presentation-Runbook.md)。

## Release gates

| Gate | 狀態 | 審閱依據 |
| --- | --- | --- |
| A 儲存庫 | PASS | 由核准 M15 建立。比較確認 `main` 已在祖先鏈，M6～M15 提交可追溯。 |
| B Core | PASS | PostgreSQL、Core、migration、驗證、結果、Evidence 與 export suite。 |
| C 安全及授權 | PASS | 查核 loopback Host／Origin，Source 授權與 Profile 核准各自驗證，Binding 由後端判定。 |
| D 可靠性 | PASS | 真實 Redis、PostgreSQL、Dispatcher、Worker lease recovery 及相同 UUID 重送。另引用未變更 Core 的歷史 throughput。 |
| E 前端完整性 | PASS | M11～M15 套件、operator 與 user journey、Job 回程與 Record／Evidence lineage。 |
| F Windows 一鍵啟動 | PASS | 新封存版直接以 BAT 啟動、驗證 persisted preset、觸發 default browser，及重複啟動／停止／保留資料。 |
| G Demo 資料 | PASS | 三組真正寫入的 fixture baseline、查核 manifest、Record/Evidence、article、`detail404` 例外及兩種 export。 |
| H 可及性及設計 | PASS | UI Slop v1.7 窄版／desktop 檢視、Chrome 200%、鍵盤、reduced motion、可見焦點和 axe。 |
| I 文件及保護 | PASS | 啟動、故障碼、恢復、備份與兩種模式操作皆有文件。追蹤檔只包含範例環境檔，檢查了秘密與 runtime artifacts。 |
| J GitHub 整合 | PARTIAL | Draft PR、CI 與整合狀態記於 [交接](../../M16-Implementation-Handoff.md)。獨立審閱和最終合併 PENDING。 |

## 資料及安全審查

本機部署使用可信 operator 與 loopback。Host／Origin gate 和 opt-in approval 限制跨來源操作。對真實網站仍使用 Source allowlist、已核准不可變 Profile、路徑與 DNS／redirect 檢查及 origin rate limits。Demo 透過獨立 Compose、認證、network、database、Evidence 和 manifest volumes 運行，fixture 為內部網路。關鍵寫入仍受後端 idempotency、claim、lease 和 transaction 約束。

用 `git ls-files` 查 `.env`、launcher 私有設定、runtime database、`.lnk`、日誌、key 與 dump；例外只有版本控制中的範例環境檔。用內容掃描檢查常見 secret 格式與本次變更。候選的 12 個 Launcher logs 與實際私有設定值逐一核對，匹配數為 0。QA console、瀏覽器 trace、下載檔和設定留在本機忽略路徑。Docker 故障注入限 QA project。先前的 Normal／Demo 及 Desktop shortcut inventories 保留。

## 獨立審查和合併

**合併決策目前為 PENDING。** Draft 可供技術審閱。確認 GO 後，重新查 remote main、PR head、全部 open PR bases、祖先鏈、main rules、CI 與 review。若 main 有新提交，在 feature branch 安全整合後重跑受影響驗證。以正常 GitHub PR 操作轉 Ready 並優先用 merge commit。如平台有審閱或 checks 阻擋，遵循實際規則。

GitHub 確認合併後，使用全新 main 檢出驗證 SQL migration、BAT、preset、文件連結和 checkout 內容。核對 M6～M16 祖先鏈及 final main SHA。確認 #1～#4 整合後才將它們標示 superseded。現有分支與討論歷史供回溯。

## Backup、rollback、troubleshooting

- 更新前以對應模式的 Stop 停止自有服務。備份受 ACL 保護的 launcher 設定、PostgreSQL dump、Evidence volume 及 Demo manifest；若需保留待派工作，同時備份 Redis。記下 Compose project identity 和 volume names。用獨立 project 演練 restore，再以 API、核准設定和 capture hash 核對。
- 需要回復已合併的程式行為時，提出正常 corrective／revert PR。先確認預期 schema 相容性，再於新 project 復原備份。保留現有 volumes 和設定以便調查。M16 候選使用同一份 migration。
- 使用 `Diagnose-Platform.bat` 或 `Diagnose-Platform.bat -Demo` 查 mode、port、Docker Linux Engine、設定、schema 與 baseline。按錯誤碼處理。 [Windows 詳細操作](../setup/Windows-One-Click-Setup.md)

限制包含物理 8 GiB Windows 機器、Docker Desktop 冷啟動及實體螢幕閱讀器測試待驗。FTC 與 New York Fed 的配置不屬此 MVP 的已驗證來源。 [真實網站可行性](M10-Real-Website-Feasibility.md)
