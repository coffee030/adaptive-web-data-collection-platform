# M4 Closure Environment Readiness

Checked on 2026-11-14 Hong Kong time. Main isolated Compose projects used 58022/55452 for full backend, 58023/55453 for constrained measurements, and 58025/55455 for the final clean rehearsal. Cold-start diagnosis used 58024/55454. Existing development services and volumes were retained.

| Component | Version | Status | Action Taken | Verification |
| --- | --- | --- | --- | --- |
| Windows | Windows 11 Pro 25H2, 26200.9974 | INSTALLED | Registry used because sandbox restricted CIM | `[Environment]::OSVersion` and Windows NT CurrentVersion |
| Python / venv | 3.12.14 | INSTALLED | Repository `.venv` | Python and `pip check` passed |
| FastAPI / Pydantic | 0.162.7 / 2.14.3 | INSTALLED | Read pinned dependency metadata | Docker API, OpenAPI, pytest |
| SQLAlchemy / psycopg / Alembic | 2.0.57 / 3.3.9 / 1.20.1 | INSTALLED | Existing venv | PostgreSQL transactions and migrations |
| Node / npm | 22.18.0 / 10.9.3 | INSTALLED | Existing toolchain and lockfile | `node --version`, `npm.cmd ls --depth=0` |
| React / TypeScript / Vite | 19.3.1 / 7.0.2 / 8.3.8 | INSTALLED | Existing dependencies | TypeScript / Vite build |
| Playwright / axe | 1.65.0 / @axe-core/playwright 4.14.0 | INSTALLED | Repository CLI | `npx.cmd playwright --version`, axe A/AA |
| Installed Chrome | 157.0.8103.51 | INSTALLED | Baseline browser | 74 controlled tests |
| Playwright Chromium / headless shell | 158.0.8127.18, revision 1254 | RECOVERED | Installed in `var/m4-closure-browsers` | `install --list`, launch and title smoke |
| Playwright Firefox | 159.0, revision 1572 | RECOVERED | Same cache | `install --list`, launch and title smoke |
| Playwright WebKit | 27.2, revision 2388 | RECOVERED | Same cache | `install --list`, launch and title smoke |
| Playwright FFmpeg / Winldd | 1013 / 1007 | RECOVERED | Official CLI restored internal tools too | `install --list` |
| Docker Desktop / Engine / Compose | 4.99.0 / 29.9.3 Linux / 5.7.0 | INSTALLED | Dedicated projects and image tag | Docker info, stats, Compose start and stop |
| WSL | 3.0.5, kernel 6.18.58.1-1 | INSTALLED | Read version and distribution list outside sandbox | docker-desktop Running, WSL2 |
| PostgreSQL / Redis / Celery | 17.12 / 7.4.8 / 5.6.3 | INSTALLED | Existing images and native test tools | Container version commands and PostgreSQL and broker regressions |
| Impeccable | 4.9.0, engine 0.1.23 | INSTALLED | Existing project installation | engine-probe, source and rendered detector |
| Narrator | Built into Windows | INSTALLED | Executable confirmed | Spoken interaction was not run. This environment had no manual audio verification setup. |
| NVDA | Absent from default paths and processes checked | NOT REQUIRED | No system installation | Possible tool for later manual verification |
| Git | 2.51.0.windows.2 | INSTALLED | Retained local branches and worktree | `git branch -vv`, `git remote -v` |
| GitHub remote | None | NOT REQUIRED | M4 used local Git, with GitHub deferred to M5 | Empty remote list |
| macOS Safari | No Mac | NOT REQUIRED | User removed it from M4 acceptance | macOS Safari untested |
| Physical 8 GB Windows and iPhone Safari | Untested | BLOCKED | Retained container limits and Playwright WebKit evidence | Pending actual test or user acceptance as an MVP limitation |

## Browser recovery

The default sandbox browser cache lacked `.links`. Verification used a repository-local cache and the existing locked installer.

```powershell
# frontend/
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Split-Path $PWD.Path -Parent) 'var/m4-closure-browsers'
node node_modules/playwright/cli.js install chromium firefox webkit
node node_modules/playwright/cli.js install --list
```

The CLI downloaded Windows binaries for the 1.65.0 registry from official `cdn.playwright.dev` through the existing Playwright installer. It listed revisions again and launched each engine. Browser versions and supported APIs follow the locked package. [Cross-browser remediation results](M4-remediation-test-results.md)
