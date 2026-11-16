# Windows 11 一鍵安裝及啟動

## 開始使用

1. 將 repository 複製或解壓到自己有寫入權限的本機 NTFS 資料夾。
2. 在檔案總管雙擊 `Start-Platform.bat`。如有安裝提示，先閱讀版本、來源和所需權限，再輸入 `YES`，並在系統提示確認。
3. 首次啟動需要下載依賴和建置 Docker image。待畫面顯示 `[SUCCESS]` 後，預設瀏覽器會收到開啟 [Overview](http://127.0.0.1:5197/) 的要求。也可複製畫面顯示的網址。
4. 下次雙擊同一個檔案即可再次啟動。已健康的服務、依賴與資料庫會重用。Frontend 已運行時，使用原有分頁或畫面上的 URL。

| 入口 | 用途 |
| --- | --- |
| `Start-Platform.bat` | 檢查環境、啟動、核對服務健康和開啟瀏覽器。 |
| `Setup-Platform.bat` | 檢查與修復前置環境、驗證本機設定。 |
| `Stop-Platform.bat` | 關閉本 checkout 的 Vite 與 Compose 服務，保留 volumes。 |
| `Diagnose-Platform.bat` | 產生英語診斷報告，Docker 無法連線時仍可使用。 |

自動化可傳入 `-NonInteractive` 關閉 launcher 的安裝同意提示、使用 `-NoBrowser` 關閉 Start 的自動開頁，並設定 `PLATFORM_NO_PAUSE=1` 取得錯誤 exit code。互動使用時 BAT 遇錯會停留供閱讀。

## Isolated Synthetic Demo

1. With the Windows prerequisites installed, double-click `Install-FYP-Demo-Shortcut.bat` once to create **FYP Demo** on your Desktop. Run the installer again after moving the checkout to update its shortcut.
2. Double-click **FYP Demo** each time you present. The launcher opens the Dashboard in your default browser when all three baselines are ready. It opens the existing Dashboard if the Demo is already running. You can also double-click `Start-FYP-Demo.bat` in File Explorer.
3. If startup fails, the launcher window displays the cause, recovery steps and diagnostic log path. Wait for an ongoing startup to finish before clicking again.

The first one-click Start prepares the isolated settings and seeds the existing Demo. It prefers Dashboard port `5198` and selects an available nearby port if needed. It checks existing Docker subnets and Windows routes before choosing private subnets for the new Demo. Later launches use the saved settings and reuse the existing data. Windows prerequisite installer prompts require your approval.

Use these commands when you want to diagnose, stop, or operate the same Demo from PowerShell. Normal defaults to Dashboard port `5197`.

```powershell
.\Setup-Platform.bat -Demo
.\Start-Platform.bat -Demo
.\Diagnose-Platform.bat -Demo
.\Stop-Platform.bat -Demo
```

Demo Setup validates installed Windows prerequisites, ownership, ports and bundled fixture files. When npm dependencies are missing it can use the local cache. On a cold machine, install the prerequisites and run `npm ci` in `frontend` with registry access before repeating offline Demo Setup. Start may download the application's pinned dependencies and container images on a cold machine. The presets collect exclusively from the bundled fixture service.

Demo uses `.local-demo/launcher.env` with its own protected credentials and identity. Its loopback API and PostgreSQL ports default to `58098` and `55498`. If a port is occupied, Stop the Demo and change the relevant port in the Demo file. If Docker's default pools are exhausted and the Demo networks have yet to be created, inspect Docker and Windows/VPN routes and add two unused RFC 1918 `/24` values as `LAUNCHER_SUBNET` and `LAUNCHER_FIXTURE_SUBNET`. Keep the project name, owner and credentials.

Find Demo diagnostics at `logs/launcher/demo/latest.log`. `DEMO-001` identifies missing bundled files. `DEMO-002` identifies incomplete or conflicting presets. Fix the reported cause and Start again. Use `Start-Platform.bat -Demo -DemoRetry` to create a replacement for a terminal failed or partial baseline. Earlier Requests and Evidence remain available.

Keep the Demo settings and its PostgreSQL, Redis, Evidence and `demo_state` volumes together for backup and restore. Use the Normal commands to operate the Normal project. [Demo architecture and expected results](../evaluation/M10-Demo-Presets-and-Launcher.md)

## 前置條件與權限

- 64-bit Windows 11、內建 Windows PowerShell 5.1、Docker Desktop Linux Engine、Docker Compose 2.20+、WSL 2。啟動時會檢查 Windows build、CPU 架構、WSL、虛擬化和可測得的 RAM、磁碟空間。Docker Desktop 安裝適用的 Windows build、記憶體與 WSL 最低需求以 Docker 官方頁面為準。 [Docker Desktop Windows 安裝指南](https://docs.docker.com/desktop/setup/install/windows-install/)
- 建議 Node.js 22.13+（22.x）和 npm。Launcher 也接受符合目前 lockfile 條件的 Node.js 23.5 或以上。日常啟動使用容器內 Python 3.12 和 Windows 上的 locked npm 套件。
- 若缺少相容 Node.js，launcher 會查詢 WinGet 官方 community source 的 `OpenJS.NodeJS.22`，列出所選 22.x 版本。經確認後，WinGet 核對 installer hash 並啟動互動安裝。若 WinGet 資料源尚未初始化、遭學校封鎖或找不到相容版本，可從 Node.js 官方頁面安裝後再跑 Setup。 [Microsoft WinGet install](https://learn.microsoft.com/windows/package-manager/winget/install) · [Node.js 下載](https://nodejs.org/en/download)
- Docker Desktop 尚未安裝時，已同意的安裝流程從 Docker 官方下載點取檔，以 Authenticode 核對有效簽章及 Docker 發行者，然後用 WSL 2 per-user 選項啟動安裝。請親自在 Docker Desktop 閱讀並處理授權、初始化與 Windows 權限提示。
- WSL 2 檢查失敗時，可確認執行 `wsl --install --no-distribution` 或 `wsl --update`。Windows 可能要求系統管理員核准及手動重新開機。若韌體虛擬化停用，依電腦廠商說明在 BIOS/UEFI 開啟 Intel Virtualization Technology 或 AMD SVM Mode。 [Microsoft WSL 指南](https://learn.microsoft.com/windows/wsl/install)
- 每台電腦的 PowerShell 與組織政策仍適用。若網路下載造成信任封鎖，請以可信來源重新取得 repository，或依學校批准的腳本信任流程處理。

## 設定、資料與受控 Demo

首次 Setup 或 Start 產生 `.local/launcher.env`。檔案使用受限 Windows ACL，存放本機隨機 PostgreSQL 密碼和每個 checkout 專屬的 Compose project identity。保留檔案和原本的 volumes，就能重用 Sources、Profiles、Jobs、Records、Redis 和 Evidence。勿提交、公開或把檔案內容貼到聊天。

| 設定 | 預設 | 用途 |
| --- | --- | --- |
| `FRONTEND_PORT` | `5197` | Vite HTTP port。 |
| `API_PORT` | `58097` | FastAPI host port。Vite 同源代理會跟隨。 |
| `POSTGRES_PORT` | `55497` | PostgreSQL host port。容器內使用 5432。 |
| `LAUNCHER_FIXTURE` | `0` | 設成 `1` 時啟動現有受控 HTML fixture，網路只在 Docker 內。 |
| `LOCAL_PROFILE_APPROVAL` | `0` | 信任目前 Windows 帳戶與本機開發環境時，可明確設成 `1`。 |
| `LAUNCHER_SUBNET`、`LAUNCHER_FIXTURE_SUBNET` | 由 Docker 選擇 | Docker 網段用盡時，可加上兩段各自可用的 RFC 1918 IPv4 `/24`。 |

先 Stop，再用純文字編輯器修改支援的設定，儲存後 Start。保留其他設定原值。API、PostgreSQL、Vite 均發布於 `127.0.0.1`，Redis 留在 Docker 網路。啟用 approval 時，Vite 會核對 loopback、API 代理和瀏覽器 Host/Origin，FastAPI 也會執行既有 Host/Origin 檢查。Source 授權和 Profile 版本批准仍要分別完成，operator label 是操作者自行填報。

全新受控 HTML／CSV 示範可先執行 `Setup-Platform.bat` 產生設定，再於首次 Start 前設定 `LAUNCHER_FIXTURE=1`、`LOCAL_PROFILE_APPROVAL=1` 及空閒連接埠。示範亦提供手動 Compose 啟動步驟。 [M5.5 受控示範](../demo/M5.5-dashboard-demo-runbook.md)

現有手動環境使用自己的 `.env` 和 Compose project，仍可照 M5 Runbook 啟動。若搬移原有 launcher，請先停止舊 checkout，私下保存整份 `launcher.env`，確認目標 Docker Engine 具備該 identity 的原有 volumes，再將備份檔還原到已限制 ACL 的 `.local` 資料夾。對沒有 launcher ownership label 的既有手動資料庫，請以原環境讀取和備份，交由團隊核對 schema 後安排匯入。 [M5 Demo Runbook](../demo/M5-core-demo-runbook.md)

## 停止、重啟、更新與卸載

- 雙擊 `Stop-Platform.bat`。Vite 收到本機停止訊號後會關閉，Docker Compose 停止擁有相符標籤的服務。再雙擊 Start 即可恢復。
- 更新前先 Stop 並備份設定、PostgreSQL 與 Evidence。更新 repository 後執行 Setup 和 Start。Launcher 以 `package-lock.json` 檢查 frontend、在 backend build inputs 變更時重建 image，並在舊 schema 上執行現有 Alembic migrations。遇 migration 錯誤時，保留 volumes 並查診斷報告。
- 備份前先記下私人設定所載的 project name。在同一個 Desktop Engine 以邏輯方式備份 PostgreSQL，並另存 `<project>_evidence_data`。需要恢復排隊狀態時也要另存 Redis volume。請存於有權限限制的資料夾，並在獨立測試環境核對備份可還原。
- 移除 launcher 時，先 Stop 及核對備份，再刪除 checkout。Docker named volumes 可留在 Desktop，之後使用原設定重新連接。清理 Docker CLI 或 Desktop 所有資料的操作請先由該電腦的管理者評估其他專案與備份。

## 疑難排解

雙擊 Diagnose，查看畫面所列的報告，或開啟 `logs/launcher/latest.log`。每次執行另有帶時間戳的報告。報告會記錄命令 exit status、容器狀態和從最近服務輸出辨識的錯誤類別。可依錯誤碼找對應處理方法。

| 錯誤 | 處理 |
| --- | --- |
| `ENV-003` / `ENV-004` | 核對 BIOS/UEFI 虛擬化、WSL 版本、Windows Virtual Machine Platform 和待完成的重啟。 |
| `ENV-005`–`ENV-008` | 開啟 Docker Desktop 並完成提示，確認 Linux containers、WSL 2 和 Compose 可用。學校政策造成存取被拒時請聯絡 IT。 |
| `ENV-009` / `WEB-001` | 核對 Node/npm 版本、套件 registry 存取、磁碟及 lockfile，然後執行 Setup。 |
| `NET-001`–`NET-003` | 核對畫面上的 port 及可辨識的 PID。在 Stop 後可更改對應 port 為 1024–65535 之間的未使用值。 |
| `NET-004` | 使用 `docker network ls` 和 `docker network inspect` 查看 Docker 網段，並用 `Get-NetRoute -AddressFamily IPv4` 核對 Windows/VPN 路由。選未重疊的 private `/24` 放入上述 subnet 設定。既有 network 的 subnet 更換需要人工評估。 |
| `DB-004`–`DB-006` | 查 PostgreSQL 和 Redis 的健康、資料卷權限、原有憑證及 migration 狀態。保留原始設定和 volumes。 |
| `SVC-001`–`SVC-005` | 查建置網路存取與 container states。Launcher 對失敗的 Redis 或 Celery worker 各最多嘗試一次重啟。 |
| `WEB-003`–`WEB-005` | 核對 Vite、代理、瀏覽器及 port。若仍在使用平台的瀏覽器有長連線，先關閉該分頁再跑 Stop。 |

Windows CIM 可用時，報告可提供實體 RAM 和虛擬化資料。磁碟檢查使用 checkout 所在 drive 與 Docker Desktop 的預設安裝 drive。Docker 自訂資料位置所需容量請從 Docker Desktop 核對。已測環境為已配置的 Windows 11 AMD64。全新環境的系統安裝及 ARM64 安裝仍待驗證。
