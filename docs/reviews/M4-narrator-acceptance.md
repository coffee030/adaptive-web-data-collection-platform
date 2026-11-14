# M4 Windows Narrator 驗收

**狀態 NOT RUN**。本機已確認內建 Narrator 可用。由使用者本人聽取語音並操作瀏覽器。預留約 15 分鐘，使用 Windows 11、Edge 或 Chrome、耳機或喇叭，以及 [Demo Runbook](../demo/M4-core-demo-runbook.md) 的隔離 CSV fixture。先確認 `/api/v1/health`、localhost console 及本機核准設定。需要 Source Authorization 時，請在隔離環境依 Runbook 使用 terminal 授權。

1. 按 `Win+Ctrl+Enter` 啟動 Narrator，在瀏覽器以 `Tab`／`Shift+Tab` 移動真實鍵盤焦點，用 `Enter`／`Space` 操作。可用 `Narrator+Space` 切換 Scan Mode，Scan Mode 可用方向鍵讀取內文；預設 Narrator key 是 `Caps Lock` 或 `Insert`。請分辨讀取游標與鍵盤焦點。 [Microsoft 開關指引](https://support.microsoft.com/en-us/accessibility/windows/narrator/chapter-1-introducing-narrator) · [Microsoft Scan Mode 指引](https://support.microsoft.com/en-us/accessibility/windows/narrator/chapter-3-using-scan-mode)
2. 從 Collection Jobs 開始。用鍵盤選 **Skip to main content**，核對焦點進入主區域，再用 **Sources → Create source**，核對 route 轉換後可聽到主區域或新標題。記下跳焦、看不到焦點或鍵盤卡住的情形。
3. 在空白 **Create source** 送出。應能從語音辨識錯誤摘要及可修正的欄位，啟動摘要中的欄位連結後再確認欄名、必填狀態及錯誤。使用 CSV adapter，填 **Source name**、**Permission reference** 和 **Allowed dataset IDs**（`listings`），送出並確認可以讀到註冊結果及 Pending access。由可信操作員授權後重開頁面核對 Approved access。
4. 進 **Create draft**。確認 **Record type**、Identity field、各 field group、CSV header 和 Add field 可辨識。用 Runbook 的 mapping 建立 Draft，修改 Record type 並儲存。聽取或透過頁面讀取儲存結果。先以有錯的 CSV 驗證，再用 clean sample，核對 Validation failed／passed 的區別及建議處理資訊。
5. 用鍵盤找到 **Approval review**，聽取 **Approver label** 的說明及 **I reviewed this report and confirm approval** 核取方塊。填 label 後確認核取狀態可聽、未勾選時不能送出。勾選並按 **Approve version**。核對核准結果與 Read only 說明。
6. 在 **New Collection Job** 核對 Source 和 Profile 選單，貼上 Runbook 的 CSV fixture 並提交。Job Details 開啟後保持頁面可見。記錄哪些 Pending／Running／Partial 狀態自動讀出，哪些需移到 **Run overview** 才讀得出，以及結果更新時焦點是否維持。若 fixture 太快，事件清單仍可核對 `CLAIMED`；未聽到的過渡狀態填「未觀察」，勿推定結果。
7. 用 **View job records** 開啟 record；檢查表頭、row 上下文和連結名稱，再從該 record 或 **Capture evidence** 到 Evidence Metadata。核對能讀到 Evidence heading、checksum 標籤、來源與 pinned Profile，並能返回 Job。用 `Win+Ctrl+Enter` 關閉 Narrator。

每步記錄 **PASS／FAIL／NOT RUN**、實際語音或摘要、焦點位置與重現步驟。附 reviewer、日期和時區、Windows build、瀏覽器版本、Narrator 語音語言、commit、Job ID。操作可完成但關鍵資訊只在視覺出現時請回報。若狀態沒有自動宣讀，分別記錄它是否可透過讀取頁面取得。尚無人工結果時維持 NOT RUN。驗收回報可沿用 [Teammate Review 格式](M4-teammate-review-checklist.md)。
