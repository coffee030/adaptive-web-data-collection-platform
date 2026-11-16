---
name: "Data Collection Workspace"
description: "Cobalt and Slate design system for the Data Collection Workspace."
colors:
  page: "#F4F6FB"
  surface: "#FFFFFF"
  navigation: "#FAFBFF"
  text: "#17233B"
  text-secondary: "#576781"
  divider: "#D8E1EF"
  accent: "#375DDD"
  accent-ink: "#2B4CBF"
  on-accent: "#FFFFFF"
  control-border: "#74839D"
  success: "#19704A"
  warning: "#875807"
  error: "#A93048"
typography:
  body:
    fontFamily: "Inter, IBM Plex Sans, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  section-title:
    fontSize: "1.125rem"
    lineHeight: 1.4
    fontWeight: 600
  mono:
    fontFamily: "IBM Plex Mono, Consolas, monospace"
    fontSize: "0.875rem"
rounded:
  compact: "6px"
  standard: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.compact}"
    height: "36px"
---

# Data Collection Workspace

M11 採用 Modern Data Workspace。Overview 以可收集主題為起點，以下方清冊對照 Request、子 Jobs 和有效紀錄。維運導覽與主要收集流程分組。設計取捨及 UI Slop v1.7 版本見 [M11 決策](docs/evaluation/M11-Frontend-Redesign-Decisions.md)。

## 色彩與表面

| CSS token | Light | Dark | 用途 |
| --- | --- | --- | --- |
| `--page` | `#F4F6FB` | `#0C1424` | 工作區底色 |
| `--navigation-surface` | `#FAFBFF` | `#101B2E` | 導覽區及清冊表頭 |
| `--surface` | `#FFFFFF` | `#172237` | 資料列、主題目錄與既有功能面板 |
| `--accent` | `#375DDD` | `#7090FF` | 主要操作、目前導覽和焦點 |
| `--on-accent` | `#FFFFFF` | `#10182C` | 主要操作上的文字 |
| `--accent-ink` | `#2B4CBF` | `#9BB0FF` | 一般連結和選取文字 |
| `--selected` | `#E8EEFF` | `#24385B` | 目前頁面及互動懸停 |
| `--text` | `#17233B` | `#E9EFFB` | 標題與主要文字 |
| `--text-secondary` | `#576781` | `#AFBCD2` | 狀態輔文、日期及範圍 |
| `--divider` | `#D8E1EF` | `#344158` | 資料分隔線 |
| `--control-border` | `#74839D` | `#70809D` | 控制項外框 |
| `--success` | `#19704A` | `#79D4A8` | 已完成及有效資料 |
| `--warning` | `#875807` | `#F4C16A` | 部分成功及資料來源提示 |
| `--error` | `#A93048` | `#FF9BAA` | 失敗和錯誤 |

共用 token 位於 `frontend/src/styles/console.css`。System 使用瀏覽器的色彩偏好及 CSS `light-dark()`。顯式 Light 或 Dark 在文件根節點設定 `data-theme`。`collection-theme` 保存於本機，HTML 在 React 掛載前套用已保存偏好。

## 文字與空間

- 以既有本機 Inter／IBM Plex Sans 及系統 fallback 顯示介面。Overview 頁名為 1.65–2.125 rem，區段標題 1.125 rem，記錄摘要及輔文 0.8125–0.9375 rem。時間及紀錄量使用等寬數字。ID、hash、JSON 使用 IBM Plex Mono／Consolas。
- 以 4／8／16／24／32 px 為間距基準。圓角 6 px 用於控制項與 Overview 資料邊界，既有功能面板保留 12 px。目錄以內部分隔線建立讀取順序，清冊以共同對齊的欄形成關聯。
- Shell 用 `frontend/src/app/shell.css`。當視窗不超過 900 px 時改為上方導覽，600 px 以下主流程呈 2×2 並獨立提供 Operations 開關。Overview 根據工作區實際寬度重排。640 px 以下主題為單欄，Request 狀態與紀錄入口保留在各列內。
- 既有寬表格使用具名、可用鍵盤聚焦的水平捲動區。主內容不應產生整頁水平捲動。工作台採自然頁面捲動與靜態狀態回饋，包含 reduced-motion 偏好時的相同行為。

## 控制與狀態

- 主動作使用 Cobalt 實底及明確文字，導覽使用帶目前頁面狀態的連結。可用主題進入已選 Topic 的表單。沒有可用主題時以 Manage sources 為區段主動作。實際收集仍需明確選擇核准來源及輸入 keyword。
- 使用具名區段、原生連結與按鈕及 2 px 可見焦點。窄版主導航與操作開關至少 44 px 高。Escape 關閉窄版操作區並返回開關。Skip link 直接聚焦 main。
- Status 同時顯示文字與顏色。失敗與部分成功以狀態文字、子工作摘要及適用的錯誤資訊呈現。Overview 標示提交時間為 UTC。紀錄入口保留 Request 範圍。
- 載入使用 status，API 錯誤使用 alert 和局部 Retry。Retry 返回區段標題，更新活動可保留可讀的既有結果並宣布更新完成。真正的空資料以設定來源、綁定主題或等待有效紀錄的下一步呈現。
- 既有功能頁保留其表單、狀態、表格和深層連結規則，使用同一 Shell 與共用 token。
