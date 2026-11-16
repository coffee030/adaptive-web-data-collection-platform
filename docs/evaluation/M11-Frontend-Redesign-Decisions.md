# M11 前端重設決策

## 審核基準

GitHub 的 M10 branch 與 open Draft PR #4 同指向 `1572fc8a8aab05f0d81a81c9b0a7ffc994218974`。GitHub 帳戶可讀寫專案，open PR 為 #1–#4。M11 從驗證過的遠端 commit 獨立 checkout。原本兩個 M10 checkout 各有不同的本機歷史。審閱 `AGENTS.md`、`skills/AGENTS.md`、`PRODUCT.md`、`DESIGN.md`、FYP frontend skill 及 Impeccable 4.9.0 的 Operate 與 Audit 參考。

React Router 的 `App` 統管路由及頁面焦點。Scope 以現有 path 與 query 參數為準。Vite 使用 loopback API proxy 和編譯期 Demo 旗標。M10 launcher 由同一 Vite 入口啟動 Normal／Synthetic Demo。現有測試使用 Playwright、axe、mocked REST 和獨立 live suites。舊 Overview 將最新工作和有效紀錄放在介紹下方，390 px 實際畫面要往下捲才看見結果。共享的 button、table、狀態、焦點和 CSS token 影響各功能頁。

## 低保真比較

| 結構 | 桌面／手機 | 可見性、密度、導覽及延續性 |
| --- | --- | --- |
| A. 工作台與請求清冊 | `側欄 ｜主題目錄 → 請求清冊 → 工作／紀錄`／主流程 2×2 導覽，請求列換行 | 主題可直接開始，請求、工作狀態及紀錄入口同列。來源及維運清楚分組。窄版保持關聯及語意順序。 |
| B. 依階段排列的引導畫布 | `頂部路徑｜選主題 → 來源 → 執行 → 成果`／順序捲動 | 初次流程明確，空資料庫容易理解。執行程序同時跨主題時，階段容易把同一請求拆開。回看已完成的工作也更深。 |
| C. 以事件為中心的時間線 | `頂部導覽｜時間線（主）｜當前事件（次）`／時間線轉詳情 | 排查單一事件迅速，翻閱相關事件自然。新收集容易被歷史活動掩蓋，空庫資訊稀少，手機需反覆返回時間線。 |

**採用 A。** 工作台先提供可收集主題，再以 Request 為同一筆工作的主體，直接連到其保存的紀錄與子 Jobs。無法進行主題收集時，在原位置引導來源與綁定設定。採用既有 Cobalt／Slate、較低的分隔線與清楚的數字層級，維持安靜、精確的操作介面。主題名稱使用目錄與可操作連結，狀態以狀態文字和顏色表示，工作摘要使用數量與事件時間。這是日常資料工作台的介面，內容以實際來源、請求與紀錄構成。

## UI Slop

Codex 專案技能置於 `.agents/skills/ui-slop/`，固定在 [v1.7.0 upstream commit](https://github.com/suna-kabo/ui-slop/tree/6f8a7d22aff293e0e92183df93cf5d53e886ba1a)。上游透過 `release/v1.7-task-continuity` 提供版本，commit 內 changelog 標示 1.7.0。主檔、參考、佐證及授權以同一 commit 版本保存在 Git。Windows checkout 後即可讀取，無全域安裝、額外套件或 hook。Impeccable 的進入檔改名，指令、參考、sidecar 與歷史評估保留供重現。

## 導覽及狀態生命週期

- 路徑標識頁面，收集歷史與結果深層連結保留 URL 所表達的範圍。初始網址及上一頁／下一頁行為交給瀏覽器與路由器。
- 主動跨頁聚焦 main，頁面標題隨路徑設置。Skip link 只移動焦點。窄版維運導覽的展開是暫時狀態，Escape 回到開關。主題連結攜帶候選 topic ID，表單仍重新檢查有效的 Category／Topic 和批准綁定。
- Theme 是本機持久偏好。Overview 資料與 API 讀取錯誤屬當次檢視。後端已提交工作與成果獨立於 UI 檢視繼續存在。
- **M12** 將合法 Topic、Category 與來源選擇的 Back／恢復納入 New Collection 合約。僅保存可安全恢復的草稿內容，回來時再次驗證來源及版本資格。從 Request 到子 Job、工作錯誤及 Evidence 保留原請求 ID 和合理的直接連結後備目的地。
- **M13** 為 Data Explorer 的 filter、sort、selected record 和 scroll 定義 URL 與 history entry 的分工。Record ↔ Evidence ↔ 原 Request 應可返回有相同條件的清冊與鍵盤觸發點。Article History 返回原 Article／Request，保留選中的版本及列表位置。驗證查看第二筆與第三筆資料的流程。
- **M14** 整合維運表單與診斷一致性，並重驗前端跨頁流程和可及性。
