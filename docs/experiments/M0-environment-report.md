# M0 Development Environment Verification

| 項目 | 結果 |
| --- | --- |
| Host | Windows 11 `10.0.26200` AMD64，`GlobalMemoryStatusEx` 顯示可見實體記憶體 31.89 GiB，當時可用 18.47 GiB。 |
| Python | CPython 3.12.14。`py -0p` 回報沒有已登記的 Python，本次以工作環境提供的 CPython 建立隔離 venv。venv 內 pip 25.0.1。 |
| Scrapling | 0.5.1，`scrapling.Selector`、`scrapling.fetchers.Fetcher`、`FetcherSession` 成功匯入。 |
| HTTP 相依項 | `curl_cffi` 0.17.0、`browserforge` 1.2.4、`patchright` 1.64.4。Scrapling 的共用 response converter 會匯入 Patchright API。無 browser runtime 安裝或啟動。 |
| QA | pytest 9.2.0、Ruff 0.17.5。實測套件版本見 [requirements.txt](../../backend/experiments/scrapling_spike/requirements.txt)。 |
| WSL／Docker | `wsl --status` exit 50，回報 WSL 未安裝。`docker` command 未找到。Docker Compose 啟動、Linux wheels 和 8 GiB 主機上的全平台使用量 **NOT RUN**。 |

## 安裝與重現

1. 沙箱內 `python -m pip index versions scrapling --index-url https://pypi.org/simple/ --retries 0 --timeout 10 --disable-pip-version-check -v` 回報無可用版本。允許 PyPI 存取後，`python -m pip install scrapling==0.5.1 pytest ruff` 成功。
2. 只裝 Scrapling base package 時，`Selector` 成功匯入，`Fetcher` 回報 `ModuleNotFoundError: No module named 'curl_cffi'`。
3. 安裝 `curl_cffi>=0.16.3`、`browserforge>=1.2.4`、`patchright>=1.62.1` 後，兩種 Fetcher imports 和 `python -m pip check` 通過。鎖檔保留實測版本。官方 `fetchers` extra 同時宣告額外 browser／crawler 套件。本次以實際匯入需求組合最小可用安裝。[Scrapling 0.5.1 metadata](https://pypi.org/project/scrapling/0.5.1/) · [發行版 pyproject.toml](https://raw.githubusercontent.com/D4Vinci/Scrapling/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/pyproject.toml)
4. 另建全新 `.m0-venv-repro`，以 `python -m pip install -r backend/experiments/scrapling_spike/requirements.txt` 重裝鎖定套件。安裝、`pip check`、`Selector`、`Fetcher` 和 `FetcherSession` 匯入均通過。

## 資源量度

- 同一 Python 進程內，以 Windows `GetProcessMemoryInfo` 在 pytest import 前後取樣。Import 前 working set 14.43 MiB，36 項測試後 64.47 MiB，OS 記錄 peak working set 64.57 MiB。pytest 報 5.90 秒，由 import 到測試完成約 6.51 秒。包含同進程受控 HTTP server 和短 timeout／retry waits。
- `site-packages` 實際檔案長度總和約 155.1 MiB，其中 Patchright 套件約 107.8 MiB。這是磁碟佔用，RAM 量度見上項。
- 在目標 8 GiB Windows 11 電腦，WSL2、PostgreSQL、Redis、workers 和 frontend dev server 同時啟動會增加記憶體需求。後續先量度單 worker 與 Compose 的基線，再驗證 2／4 workers。Docker Desktop 的 WSL2 backend 要求支援的 Windows 版本、虛擬化和 8 GB 系統 RAM。全平台相容性、throughput 和可擴展性仍待實測。[Docker Windows requirements](https://docs.docker.com/desktop/setup/install/windows-install/) · [Docker WSL 2 backend](https://docs.docker.com/desktop/features/wsl/)
