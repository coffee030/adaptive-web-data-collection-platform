# M0 Development Environment Verification

| Item | Result |
| --- | --- |
| Host | Windows 11 `10.0.26200` AMD64. `GlobalMemoryStatusEx` showed 31.89 GiB of visible physical RAM and 18.47 GiB available. |
| Python | CPython 3.12.14. `py -0p` found no registered Python. The workspace CPython created an isolated venv with pip 25.0.1. |
| Scrapling | 0.5.1. Imported `scrapling.Selector`, `scrapling.fetchers.Fetcher`, and `FetcherSession` successfully. |
| HTTP dependencies | `curl_cffi` 0.17.0, `browserforge` 1.2.4, and `patchright` 1.64.4. Scrapling's shared response converter imports Patchright APIs. No browser runtime was installed or started. |
| QA | pytest 9.2.0 and Ruff 0.17.5. [Verified requirements](../../backend/experiments/scrapling_spike/requirements.txt) |
| WSL and Docker | `wsl --status` exited 50 and reported WSL uninstalled. The `docker` command was missing. Docker Compose startup, Linux wheels, and full-platform use on an 8 GiB host were **NOT RUN**. |

## Install and reproduce

1. In the sandbox, `python -m pip index versions scrapling --index-url https://pypi.org/simple/ --retries 0 --timeout 10 --disable-pip-version-check -v` found no versions. With PyPI access, `python -m pip install scrapling==0.5.1 pytest ruff` succeeded.
2. With only base Scrapling, `Selector` imported. `Fetcher` reported `ModuleNotFoundError: No module named 'curl_cffi'`.
3. After installing `curl_cffi>=0.16.3`, `browserforge>=1.2.4`, and `patchright>=1.62.1`, both Fetcher imports and `python -m pip check` passed. The lock records tested versions. The official `fetchers` extra declares additional browser and crawler packages. This run installed the minimum packages needed for the observed imports. [Scrapling 0.5.1 metadata](https://pypi.org/project/scrapling/0.5.1/) [Release pyproject.toml](https://raw.githubusercontent.com/D4Vinci/Scrapling/3a4bb5b0a008233c85269a0a38a6d08edd4ce329/pyproject.toml)
4. Created a fresh `.m0-venv-repro` and ran `python -m pip install -r backend/experiments/scrapling_spike/requirements.txt`. Installation, `pip check`, and imports of `Selector`, `Fetcher`, and `FetcherSession` passed.

## Resource measurements

- Sampled a single Python process with Windows `GetProcessMemoryInfo` before importing pytest and after tests. Working set was 14.43 MiB before import and 64.47 MiB after 36 tests. OS peak was 64.57 MiB. Pytest reported 5.90 seconds, and import through completion took about 6.51 seconds. The run included an in-process controlled HTTP server and short timeout and retry waits.
- Actual `site-packages` file lengths totalled about 155.1 MiB, including about 107.8 MiB for Patchright. These measure disk use. RAM is reported above.
- Running WSL2, PostgreSQL, Redis, workers, and the frontend dev server together raises memory demand on the target 8 GiB Windows 11 computer. First measure the one-worker Compose baseline and then check two and four workers. Docker Desktop's WSL2 backend requires a supported Windows version, virtualisation, and 8 GB system RAM. Full-platform compatibility, throughput, and scale remained untested. [Docker Windows requirements](https://docs.docker.com/desktop/setup/install/windows-install/) [Docker WSL 2 backend](https://docs.docker.com/desktop/features/wsl/)
