# M16 FYP 展示 Runbook

## 開始前

使用 Windows 11、WSL2、Docker Desktop Linux Engine、Node.js 22.13+ 及本機瀏覽器。在候選或已接受的 `main` checkout，於檔案總管雙擊 **Start-FYP-Demo.bat**。安裝或信任提示由操作者閱讀並確認。等待 `Synthetic Demo is ready!`。Launcher 先驗證三組保存的 baseline，再請 Windows 開啟預設瀏覽器。若 port 已使用，採用它列印的 loopback URL。使用同一 checkout 重複啟動可繼續前次資料。

| 預設 | Keyword | 預期 baseline |
| --- | --- | --- |
| Core Demonstration → Fixture Listings | `quick` | 2 Jobs、2 Records、4 Evidence captures |
| Marketing Intelligence → Influencer Advertising and Sponsorship | `partnership` | 2 Jobs、8 Records、12 captures |
| Financial Markets → Market News and Economic Updates | `market` | 2 Jobs、8 Records、12 captures |

資料來源為 bundled controlled fixtures。行銷內容為虛構；價格欄與匯出含 **SIMULATED DATA — NOT LIVE MARKET PRICES**。三組共 6 個 Jobs、18 筆 Records／Observations 和 28 個 Evidence captures。

## 一次完整展示

1. 在 **Overview** 介紹 Topic、近期 Requests、子 Jobs 和已驗證紀錄。選 **New Collection**，展開 **Core Demonstration**，選 **Fixture Listings** 及兩個核准來源。輸入 `quick`，先選 **Review collection**，核對來源與 Profile 版本，再選 **Start topic collection**。
2. Request 建立後查看 **Child jobs**。開啟 **Job details**，查看 **Execution and dispatch** 及 **Execution events**。等待 Jobs 終態。回到 Request 選 **View request records**，點選 **Inspect Alpha**，查看 extracted payload、Job、固定 Source／Profile、Evidence。打開 Evidence 顯示捕獲時間、類型及 SHA-256。
3. 回到 Record Inspector，打開 **Article history**。展示 Article identity、內容 version 與本次 observation。回到 Request 執行 **Refresh collection**，說明每次新增 Request 與 observations；相同內容重用相同內容 version。內容變更演習可使用內部金融 fixture revision，另測於專用 Demo。 [Fixture revision](M10-Demo-Presets-and-Launcher.md#controlled-financial-refresh)
4. 用完成的 Request 下載 **CSV** 和 **JSON**，兩者包含該 Request 的已接受結果。從獨立 Job 下載時僅涵蓋該 Job。說明運行中的 scope 要先完成，Partial 可保留有效紀錄。
5. 示範例外時，以 **Fixture Listings** 重跑 `detail404`。預期兩個 Partial Jobs，各保留 Alpha。打開 **Execution events** 與 **Capture evidence**，展示可見錯誤仍伴隨有效證據。用獨立 CSV 測試案例展示非數值欄和缺少必填欄如何進入 **Quarantine**。
6. 在 **Operations → Sources** 展示註冊、Source 授權、Draft 設定、保存、Preview、Validate、明確 Approve。到 **Topics & bindings** 建立 Category／Topic 並核准 binding，再選 **Continue to New Collection**。示範操作可在另一個空 Normal project 完成；使用該環境的受控 fixture 和手動核准。 [Windows Normal 設定](../setup/Windows-One-Click-Setup.md)

## 停止與恢復

在同一 checkout 執行 `Stop-Platform.bat -Demo`。重開 **Start-FYP-Demo.bat** 後以同一 Request、Evidence reference 及附件檢查持久化。診斷使用 `Diagnose-Platform.bat -Demo`，重點看 fixture、schema、API proxy 和 baseline。部署模式、DB 或 port 錯誤依 [Windows 錯誤碼表](../setup/Windows-One-Click-Setup.md#疑難排解) 處理。必要時展示 [M10 已驗證可靠性記錄](M10-Reliability-Evaluation.md) 及實際 Dispatcher／Worker 歷史，不需中斷現場 Demo。完整測試資訊見 [最終 MVP 驗收](M16-Final-MVP-Acceptance.md)。
