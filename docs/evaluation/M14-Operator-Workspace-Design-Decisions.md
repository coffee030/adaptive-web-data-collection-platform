# M14 操作者設定工作區設計決策

## M14-A 儲存庫審核

GitHub compare 確認 `feature/M13-evidence-first-data-explorer` 與本機乾淨工作樹同為 `ff211bef68dec3e304b5fa253d89a50230e25255`。搜尋同名 M14 遠端分支沒有結果。M14 本機分支由該 commit 開始。

審閱 AGENTS、PRODUCT、DESIGN、M11–M13 決策、M2／M4 Closure／M7／M8 契約與現有 React 路由和測試。沿用 FYP frontend skill 與 vendored UI Slop v1.7（`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`）。Source 與 Profile 具備主要操作，但 ID 和雜湊佔據閱讀順序，授權按鈕缺少確認，失敗後仍可重送。Category 和 Topic 的長選單同時負責選擇及修改，Binding 頁先顯示表單，既有資格和核准資料在下方。

| 契約 | 實作查核 |
| --- | --- |
| Source | 清單回完整陣列。UUID request key 唯一，對照正規化 payload。首次 201、相同請求 200、不同 payload 409。註冊 UI 明確送 pending。政策核對留在 Core。Source 變更在 DB transaction 鎖定來源。 |
| Profile | 已存 Draft 以 `expected_revision` 更新。來源鎖與版本檢查保護編輯及核准。Preview 讀當前版本，Validation 寫入前重查 revision、Draft 與 Source。核准在鎖內核對目前 config hash、同 revision 最新 passing report、Source 及版號。 |
| Catalog | Category／Topic 清單支援分頁。Topic 建立時指定 Category，更新只帶 name／active。DB 鎖定更新並拒絕重複名稱。沒有 revision，並行更新仍可能由後寫覆蓋。 |
| Binding | 以固定 Source、Profile Version 及 hash 核准。核准與恢復須符合 Source／Profile 的狀態和 keyword search 合約。API 可為未啟用的目錄保存 Binding。是否 eligible 另由 Topic、Category、Source、Profile 與停用狀態決定。API 沒有逐筆原因欄位。 |
| Local operator | FastAPI 核對 loopback Host 及同源 Origin。Vite 另外限制 Profile approval 和 Binding mutations。Source authorization 的 UI 沿用相同本機旗標，既有 UI 操作為 web Source。核准標籤由操作者自報。 |
| 導覽 | 沿用 `/sources`、`/sources/:id/profiles/:version`、`/topics`、`/topics/:topicId` 及 `/collection-requests/new?topic_id=…`。M12 重查目錄、Binding 及 pin。維持 Back to collection 和 M13 的 history/scroll 契約。 |

## 低保真結構

| 結構草圖 | 理解、密度與安全 | 路由、手機、延續性與成本 |
| --- | --- | --- |
| A. `Source ledger → Source [access policy] ↓ [version history] → draft` | 來源身份長駐。存取、版本與綁定分屬各物件。可在資料旁核對再確認，熟練操作者可就近進入已有版本。 | 直接沿用 Source／Profile 深層連結。窄版清冊轉為帶欄名的資訊列。保留上一頁位置。改動集中在操作表面。 |
| B. `[Source + Topic selector] ｜ [requirements matrix] ↓ [exceptions]` | 可由清單看缺件。選擇前關係較抽象。若要宣稱全域資格，讀取成本高，也容易把獨立核准合成一個狀態。 | 所選 Source／Topic 均需要新的上下文控制。窄版矩陣需要另做導覽。維護及請求成本最高。 |
| C. `[Register] ↓ [Authorize] ↓ [Configure] ↓ [Check] ↓ [Bind]` | 首次學習容易，逐步顯示降低密度。重複比對歷史或修正先前設定要往返階段。 | 窄版順序明確。既有 deep link 需和精靈同步。跨頁草稿和 Back 成本較高。 |

採用 A，加入只依目前物件推導的下一步與漸進顯示設定。清冊以可掃讀資料列呈現，政策與不可變配置用定義清單，核准與停用以原位置的檢閱操作呈現。沿用 Cobalt／Slate token。URL 保存可分享的清冊分頁和選取的 Topic。暫時審核、報告與未存 Draft 不由返回狀態重建。手機優先保留來源名稱、狀態與相關動作。

## 狀態及實作次序

1. **M14-B** 註冊送 pending → 顯示已保存 Source → 檢閱限制 → 明確授權或撤銷 → GET 當前狀態。結果未確認時先重讀，再允許動作。
2. **M14-C** 建立 Draft → 編輯未存內容 → 以 revision 保存。遇到過時或未確認寫入，保留本機值供核對，先讀伺服器再選擇如何處理。
3. **M14-D** 針對已存 Draft Preview／Validate → 檢閱 passing report → 自報標籤及明確確認 → 核准後顯示唯讀版本。內容或樣本改變時停止使用舊報告。
4. **M14-E** 開啟 Category／Topic、檢閱既有 Bindings → 明確選取已授權 Source 和相容核准版本 → 核准、停用或恢復後讀取最新狀態。
5. **M14-F** 可用 Topic 提供 `topic_id` 給 M12，讓 M12 再次確認目前資格。保留 CSV／單來源入口及 M12 回程。
6. **M14-G/H** 使用既有 Playwright 及隔離 Core 測試，兩輪實際顯示檢查及 axe。以具體命令、結果、畫面和缺口完成交接。

## 實作取捨與瀏覽檢視

- Source 清冊以完整 API 資料作本機分頁。列內提示只根據該 Source 的授權狀態。Source 明細記錄准許的 origin、path 或 dataset，並在同一頁呈現版本目錄及後續入口。使用者可直接打開原有深層連結。
- Profile 工作區保留現有 Draft 格式。摺疊分頁和文章映射時，欄位繼續使用同一份 React Draft。已存 revision 對應樣本檢查。樣本或已存設定改動後，畫面撤下上一份報告。核准表單只在當前 hash 和版本與 passing report 相符時啟用。
- Category 選取決定 Topic 清單查詢範圍。Topic 綁定頁只查選取 Topic、其 Category、目前 Binding page 與一筆 eligible-only 結果。選定 Source 才讀其 Profile Versions。窄版依閱讀次序顯示各列的欄名，使用原生表單與按鈕。
- Pass A 在實際 Chromium 瀏覽器看到註冊動作落在首屏以下、寬式 Profile 面板留空，以及 Binding 停用／恢復檢閱離開該列的工作表面。另發現測試中的 selector 欄被折到次要區段。修正將網站輸入分欄、縮短 Profile 工作面板並提供段落跳轉、把停用／恢復檢閱放回清冊，以及將必要 selector 打開。
- Pass B 重作受控流程，檢查註冊、Profile 與核准、Category／Topic、Binding 及 New Collection。快速從 Profile 返回 M12 時，路由級加载限制在當前操作者頁，讓原本的 M12 草稿和伺服器資格重讀正確接續。Edge 200% 原生縮放以完整 viewport 擷取，長值、輪廓及重新排列可從證據查閱。
