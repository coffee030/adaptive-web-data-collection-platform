# M4 Closure Environment Readiness

核對日期 2026-11-14（香港時間）。主要隔離 Compose projects 使用 58022／55452（完整後端）、58023／55453（限額量測）及 58025／55455（最終 clean rehearsal）。另用 58024／55454 排查冷啟動測試。既有開發服務和資料卷保留。

| Component | Version | Status | Action Taken | Verification |
| --- | --- | --- | --- | --- |
| Windows | Windows 11 Pro 25H2，26200.9974 | INSTALLED | Registry 代替被 sandbox 限制的 CIM | `[Environment]::OSVersion`、Windows NT CurrentVersion |
| Python / venv | 3.12.14 | INSTALLED | 使用 repository 的 `.venv` | Python、`pip check` 通過 |
| FastAPI / Pydantic | 0.162.7 / 2.14.3 | INSTALLED | 讀取 pinned dependency metadata | Docker API、OpenAPI、pytest |
| SQLAlchemy / psycopg / Alembic | 2.0.57 / 3.3.9 / 1.20.1 | INSTALLED | 使用既有 venv | PostgreSQL transaction、migration |
| Node / npm | 22.18.0 / 10.9.3 | INSTALLED | 沿用工具鏈和 lockfile | `node --version`、`npm.cmd ls --depth=0` |
| React / TypeScript / Vite | 19.3.1 / 7.0.2 / 8.3.8 | INSTALLED | 依現有依賴版本 | TypeScript / Vite build |
| Playwright / axe | 1.65.0 / @axe-core/playwright 4.14.0 | INSTALLED | 使用 repository CLI | `npx.cmd playwright --version`、axe A/AA |
| Installed Chrome | 157.0.8103.51 | INSTALLED | 基線 browser | 74 controlled tests |
| Playwright Chromium / headless shell | 158.0.8127.18，revision 1254 | RECOVERED | 安裝於 `var/m4-closure-browsers` | `install --list`、launch 及 title smoke |
| Playwright Firefox | 159.0，revision 1572 | RECOVERED | 同上 | `install --list`、launch 及 title smoke |
| Playwright WebKit | 27.2，revision 2388 | RECOVERED | 同上 | `install --list`、launch 及 title smoke |
| Playwright FFmpeg / Winldd | 1013 / 1007 | RECOVERED | 官方 CLI 一併恢復內部工具 | `install --list` |
| Docker Desktop / Engine / Compose | 4.99.0 / 29.9.3 Linux / 5.7.0 | INSTALLED | 專用 projects 及 image tag | Docker info、stats、Compose start/stop |
| WSL | 3.0.5，kernel 6.18.58.1-1 | INSTALLED | sandbox 外讀取版本與 distribution 列表 | docker-desktop Running，WSL2 |
| PostgreSQL / Redis / Celery | 17.12 / 7.4.8 / 5.6.3 | INSTALLED | 使用既有 image 和 native 測試工具 | Container version commands、PostgreSQL／broker regression |
| Impeccable | 4.9.0，engine 0.1.23 | INSTALLED | 沿用 project 安裝 | engine-probe，source 與 rendered detector |
| Narrator | Windows 內建 | INSTALLED | 已確認 executable 存在 | 語音操作未執行。此環境未架設可聽取 Narrator 的人工操作及音訊驗收。 |
| NVDA | 未在預設位置或程序中發現 | NOT REQUIRED | 無系統安裝 | 可作後續人工測試工具 |
| Git | 2.51.0.windows.2 | INSTALLED | 保留本機分支及工作樹 | `git branch -vv`、`git remote -v` |
| GitHub remote | 無 | NOT REQUIRED | M4 使用本機 Git，GitHub 延至 M5 | remote 列表空白 |
| macOS Safari | 無 Mac | NOT REQUIRED | 使用者從 M4 驗收移除 | macOS Safari 未測 |
| 實體 8 GB Windows／iPhone Safari | 未測 | BLOCKED | 保留 per-container 限額與 Playwright WebKit 證據 | 待實測或使用者接受為 MVP 限制 |

## Browser recovery

預設 sandbox browser cache 的 `.links` 資料夾缺失。改用 repository-local cache，沿用鎖定的既有 installer。

```powershell
# frontend/
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Split-Path $PWD.Path -Parent) 'var/m4-closure-browsers'
node node_modules/playwright/cli.js install chromium firefox webkit
node node_modules/playwright/cli.js install --list
```

CLI 從官方 `cdn.playwright.dev` 取得與 1.65.0 registry 相容的 Windows binaries。下載由既有 Playwright installer 完成，重新列出各 revision 並實際啟動各引擎。瀏覽器版本與支援 API 照已鎖定的 package；應用程式跨瀏覽器驗證另見 [Remediation test results](M4-remediation-test-results.md)。
