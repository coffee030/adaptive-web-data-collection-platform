# M21A — Pull request verification

**Local verification passed; hosted PR verification pending.** The feature branch starts at accepted M20 commit `3591d6c3d809e333f48e755666ab27d113837257`. The fetched M18 and M19 tips, `5f6f5b461676a561ca53c40ee50c275140413bc6` and `65b8e7363f0c3fca7629d20627a67c8fce389d72`, are ancestors. The fetched `main` tip was `1b1ed19fe03670dac57a6006d3b1a5be149700b0`.

## Local results on 20 November 2026

Each test environment was a fresh virtual environment. Linux runs used Debian 12 and CPython 3.12.14. Windows runs used Windows 11 Pro 25H2 build 26200 and CPython 3.13.7. Times below are pytest session durations unless specified.

| Check | Environment | Actual result | Evidence |
| --- | --- | --- | --- |
| Dependency consistency | Separate MCP and backend environments on Linux and Windows | Passed in all four environments | Each `python -m pip check` printed `No broken requirements found.` |
| MCP protocol suite | Linux and Windows, pytest 9.2.0 | 14 collected and 14 passed, 0 skipped. Linux 9.56 s, Windows 11.94 s. | Five stdio subprocess cases passed. The other nine cases covered startup and API-base validation. |
| Job API and attribution contracts | Linux and Windows, PostgreSQL 17.12, Redis 7.4.8, pytest 9.2.0 | 5 collected and 5 passed, 0 skipped. Linux 45.23 s, Windows 43.64 s. | The unclaimed Job, populated `0009` upgrade, direct CLI, expired-attempt recovery and Collection Request status cases all executed. Both services were healthy. |
| Required-test failure conditions | Windows, pytest 9.2.0 | Passed the failure probes | Removing the PostgreSQL URL produced five named skips and exit 1. A runtime skip and a collection-time skip each exited 1 with a passing case present. Empty collection exited 5. |
| Existing backend unit suite | Linux and Windows, pytest 9.2.0 | Linux 205 passed in 28.80 s. Windows 202 passed, 3 skipped in 18.54 s. | The three Windows skips needed OpenSSL on `PATH` to generate the local TLS fixture certificate. All three executed on Linux. |
| Existing frontend build and type check | Windows, Node 22.18.0 and npm 10.9.3 | Passed | `npm ci` completed, TypeScript passed and Vite built 82 modules. |
| Workflow and repository checks | Windows, actionlint 1.7.7, Ruff 0.17.5 and Git | Passed | `actionlint` accepted the workflow, Ruff passed on the changed Python files and `git diff --check` passed. The scoped diff contains no tracked environments, local settings, generated output, credentials or machine-specific paths. The database password in the workflow is a disposable fixture value. |

The five stdio outcomes were `PASSED` on both platforms:

- `test_stdio_read_trace_and_tool_annotations`
- `test_prepare_and_start_stdio`
- `test_stdio_submission_errors_are_structured_and_bounded`
- `test_stdio_bounded_errors`
- `test_stdio_unavailable_api`

The MCP suite uses loopback REST fixtures and a reserved port for the unavailable-API case. It needs no AI account, API key or public publisher. The backend checks exercise the Job Detail and Events endpoints through FastAPI, the direct CLI and migration, and the real Collection Request status response used by MCP. The PostgreSQL fixtures migrate and drop a disposable schema per case. The Collection Request case uses Redis for the rate controller and a loopback source fixture. M21B covers fresh-Windows acceptance, and M21C covers release evaluation.

## Repeat the checks

Run from the repository root. These PowerShell commands use Python 3.13 on Windows. For Linux use Python 3.12, `bin/python` inside each virtual environment, and the same pytest arguments as the [workflow](../../.github/workflows/pull-request.yml).

```powershell
py -3.13 -m venv .local/m21a-mcp
$mcpPython = '.local/m21a-mcp/Scripts/python.exe'
& $mcpPython -m pip install -r mcp_access/requirements.txt pytest==9.2.0
& $mcpPython -m pip check
& $mcpPython -m pytest --collect-only -q mcp_access/tests
& $mcpPython -m pytest -p scripts.require_pytest_pass -v -ra -o faulthandler_timeout=30 mcp_access/tests

# Verify empty collection. Expected exit is 5.
New-Item -ItemType Directory -Force .local/empty-tests | Out-Null
& $mcpPython -m pytest -p scripts.require_pytest_pass -v -ra .local/empty-tests
$LASTEXITCODE

py -3.13 -m venv .local/m21a-backend
$backendPython = '.local/m21a-backend/Scripts/python.exe'
& $backendPython -m pip install -r backend/requirements.txt
& $backendPython -m pip check
& $backendPython -m pytest -q -rs backend/tests/test_m0_http.py backend/tests/test_m0_extraction.py backend/tests/m1
```

Use unused container names and loopback ports. Wait for both health statuses to report `healthy` before running the contract command.

```powershell
docker run --rm -d --name collection-m21a-pg -p 127.0.0.1:55521:5432 `
  -e POSTGRES_USER=collection -e POSTGRES_PASSWORD=m21a-fixture-only -e POSTGRES_DB=collection_m21a `
  --health-cmd 'pg_isready -h 127.0.0.1 -U collection -d collection_m21a' `
  --health-interval 3s --health-timeout 3s --health-retries 10 postgres:17-alpine
docker run --rm -d --name collection-m21a-redis -p 127.0.0.1:56321:6379 `
  --health-cmd 'redis-cli ping' --health-interval 3s --health-timeout 3s --health-retries 10 redis:7.4.8-alpine
docker inspect --format '{{.Name}} {{.State.Health.Status}}' collection-m21a-pg collection-m21a-redis

$env:M2_TEST_DATABASE_URL = 'postgresql+psycopg://collection:m21a-fixture-only@127.0.0.1:55521/collection_m21a'
$env:M3_TEST_BROKER_URL = 'redis://127.0.0.1:56321/0'
$contracts = @(
  'backend/tests/m2/test_jobs.py::test_job_api_creates_a_pending_job'
  'backend/tests/m2/test_m20_attempt_identity.py'
  'backend/tests/m2/test_m3_reliability.py::test_expired_attempt_cannot_publish_or_fail_a_new_claim'
  'backend/tests/m2/test_m8_collections.py::test_multiple_sources_refresh_history_and_revocation'
)
& $backendPython -m pytest -p scripts.require_pytest_pass -v -ra @contracts

# Verify that the contract gate rejects missing database setup. Expected exit is 1.
Remove-Item Env:M2_TEST_DATABASE_URL
& $backendPython -m pytest -p scripts.require_pytest_pass -v -ra @contracts
$LASTEXITCODE
Remove-Item Env:M3_TEST_BROKER_URL
docker stop collection-m21a-pg collection-m21a-redis
```

```powershell
npm.cmd ci --prefix frontend
npm.cmd run build --prefix frontend
& $backendPython -m ruff check scripts/require_pytest_pass.py backend/tests/m2/test_m3_reliability.py backend/tests/m2/test_m8_collections.py
actionlint .github/workflows/pull-request.yml
git diff --check 3591d6c3d809e333f48e755666ab27d113837257 HEAD
```

## Hosted verification

The workflow runs when a pull request targeting `main` opens, reopens, or receives a new head commit. GitHub normally checks out the PR merge commit. Record both the PR head SHA and the checked-out merge SHA when reviewing the run. A standalone feature-branch push does not trigger this workflow. GitHub reported no open PRs and no M21A run during review.

`MCP protocol tests` is defined in the workflow. The GitHub API reported `main` as unprotected and returned no applicable ruleset rules. The classic branch-protection detail endpoint denied access, so its required-check configuration is unverified. [Main branch](https://api.github.com/repos/coffee030/adaptive-web-data-collection-platform/branches/main) · [Applicable rules](https://api.github.com/repos/coffee030/adaptive-web-data-collection-platform/rules/branches/main)
