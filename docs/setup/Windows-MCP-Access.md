# Windows 本機 MCP 使用指南

在 Windows 11 安裝 Python 3.12 或 3.13，並按 [Windows 一鍵啟動指南](Windows-One-Click-Setup.md) 準備 Docker Desktop Linux Engine 和 Node.js。由本 checkout 根目錄啟動 `Start-FYP-Demo.bat`，等待 `Synthetic Demo is ready!`。執行 `Diagnose-Platform.bat -Demo` 取得當次 **API port** 和 **Dashboard URL**。

在 checkout 根目錄開啟 PowerShell。將 `<DEMO_API_PORT>` 換成診斷報告的 API port。下例的 `python` 代表已安裝的 Python 執行檔，亦可使用它的完整路徑。

```powershell
python -m venv mcp_access/.venv
$python = '.\mcp_access\.venv\Scripts\python.exe'
& $python -m pip install -r mcp_access/requirements.txt
$env:FYP_MCP_API_BASE = 'http://127.0.0.1:<DEMO_API_PORT>/api/v1'
Invoke-RestMethod "$env:FYP_MCP_API_BASE/health"
```

## 連接 Codex 或其他本機 MCP client

將 [設定範例](../../mcp_access/codex.config.example.toml) 的 `fyp` 表加入此 checkout 的 `.codex/config.toml`。填入 checkout 的絕對路徑和本次 Demo API port。在信任此 checkout 的 Codex CLI 新工作階段，請它呼叫 `fyp.list_categories` 並回傳第一個 Category 的名稱和 ID。其他本機 client 可使用同一個 Python 執行檔、參數 `-m mcp_access.server`、checkout 根目錄及環境變數，stream 設定為 stdio。 [Codex MCP 設定](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

也可以從 PowerShell 以單次設定執行。以下指令沿用上節的 `$python` 和 `FYP_MCP_API_BASE`。

```powershell
$command = (Resolve-Path $python).Path.Replace('\', '/')
$root = (Get-Location).Path.Replace('\', '/')
$overrides = @(
    '-c', ('mcp_servers.fyp.command="' + $command + '"'),
    '-c', 'mcp_servers.fyp.args=["-m","mcp_access.server"]',
    '-c', ('mcp_servers.fyp.cwd="' + $root + '"'),
    '-c', ('mcp_servers.fyp.env.FYP_MCP_API_BASE="' + $env:FYP_MCP_API_BASE + '"')
)
codex @overrides --ask-for-approval never exec --ignore-user-config --ephemeral --sandbox read-only --json 'Use only the fyp MCP server. Call list_categories with limit 1 and report the category name and ID.'
```

## 重現一筆 Demo 紀錄的證據追溯

1. 在 Dashboard 的 **Collection requests** 開啟已保存的 **Fixture Listings · quick**。從網址複製 Request UUID。
2. 執行下列指令。SDK 透過 stdio 發現和呼叫七個工具，讀取兩頁 Records，並用 REST API 比對 selected Record 的 lineage、Evidence hash，以及前後的 Request 與 Job ID 集合。
3. 回到同一個 Request，核對 **Child jobs** 的 Job details 和 **Pinned profile version** 連結。點選 **View request records**，以 **Oldest first** 排序後開啟第一筆 Record。展開 **Provenance and identifiers** 核對各 ID，再按 **View capture evidence** 核對 **Content SHA-256**。如兩筆 Record 標題相同，以 SDK 輸出的 Record ID 確認。

```powershell
& $python -m mcp_access.verify_demo '<REQUEST_UUID>'
& $python -m pip install pytest
& $python -m pytest -q mcp_access/tests
```

## 疑難排解

- 如 MCP 初始化失敗，檢查 Python 絕對路徑、checkout 工作目錄、依賴套件及 stderr。API base 必須是 `http://127.0.0.1:<port>/api/v1` 或 IPv6 loopback 等效位置。
- 如收到 API unavailable 或 HTTP 錯誤，執行 `Diagnose-Platform.bat -Demo` 並查 `/api/v1/health`。更新 host 設定後開啟新的 MCP session。
- `get_collection_records` 要求 Request UUID。未知 Request 回傳工具錯誤，已知 Request 的空頁回傳空的 `items`。每頁上限為 25 筆，使用 `next_offset` 繼續。單次 REST 讀取上限為 5 秒和 2 MiB，遇到大小限制時調低 `limit`。
- `payload` 是擷取的來源資料。每筆預覽最多 12 欄，每個文字值最多 512 字元。省略超長欄名或截短文字時，`payload_truncated` 會標示為 `true`。Evidence 的 `content_hash` 代表後端儲存的 SHA-256。驗證原始擷取內容需要另外取得並重新計算該內容的雜湊。
