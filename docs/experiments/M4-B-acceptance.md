# M4-B Acceptance Report

Verification ran on 2026-11-14 Hong Kong time. Baseline was `98b57d3`. All 15 M4-A Playwright tests passed before the changes.

## Commands and results

Run from `frontend/` with Node 22.18.0, npm 10.9.3, and installed Chrome.

```powershell
npm.cmd run typecheck
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:M4_FRONTEND_PORT = '5177'
npm.cmd test
$env:M4_REAL_API = '1'
$env:API_PROXY_TARGET = 'http://127.0.0.1:58004'
npm.cmd test
```

- TypeScript and the Vite production build passed.
- Controlled Playwright passed 27, including 15 M4-A and 12 M4-B tests.
- Live API Playwright passed 3, including two Jobs tests and one Sources test.
- From the repository root, set `M2_TEST_DATABASE_URL` to isolated PostgreSQL on port 55436 and run `& .venv/Scripts/python.exe -m pytest -q -rs backend/tests/m2/test_profiles_api.py backend/tests/m2/test_vertical_slice.py`. Five passed, 0 skipped, in 7.22s. The full 172-test backend suite was NOT RUN in this round.
- `git diff --check 98b57d3 HEAD` passed. Backend, Compose, PRODUCT.md, and DESIGN.md matched at both tips.

## Live acceptance

The existing isolated Linux Compose project `collection-m4a-local` used FastAPI port 58004. OpenAPI confirmed Sources and Versions return arrays without pagination. Source list, detail, and POST used the same Vite proxy. The first registered test Source was `718e6edb1c714987817778317944d66e`. The browser received HTTP 201 and showed Pending and an empty version list. Independent GET matched the POST reply. Integration also read existing versions and hashes for approved CSV fixture `3b70bfdd286a4e39b86b33607a0362a6`. Stopping PostgreSQL for that test project produced a real HTTP 503 in Sources. After `docker compose ... up -d --wait postgres`, Retry loaded the table. The development database was unused.

## Accessibility and design review

Using Impeccable Operate, critique, and audit, Chromium reviewed list, form, and detail. Desktop retained its sidebar. Tablet and mobile used horizontal navigation. Source name and access authorisation appear first, and details go from policy to a separate read-only version table. The first mobile layout squeezed authorisation. Column widths were adjusted and checked against rendered table coordinates. The form focuses the error summary, keyboard links move to fields, and `aria-describedby` associates error text. Long IDs, hashes, and policy values wrap or scroll inside named table regions.

- Checked all three pages at 1440, 1280, 768, and 390px. Twelve combinations had no document-level overflow and zero violations under the specified WCAG A/AA axe rules.
- At 390px, checked keyboard submission, error summary, required and invalid-origin errors, long origins, and three Profile statuses. Desktop and mobile used existing tokens. Screen reader, Safari, and physical mobile were NOT RUN.
- The first mobile scan raised two `straggler` advisories in Permission reference and Allowed dataset IDs help. After shortening, final source, desktop, and mobile scans returned `[]` and exit 0. No detector ignores were added. Hooks and Live Mode stayed disabled.

```powershell
& .agents/skills/impeccable/scripts/impeccable.cmd detect --json frontend/src
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
foreach ($view in @('1280x900','390x844')) {
  & .agents/skills/impeccable/scripts/impeccable.cmd detect --json --viewport $view http://127.0.0.1:5178/sources http://127.0.0.1:5178/sources/new http://127.0.0.1:5178/sources/3b70bfdd286a4e39b86b33607a0362a6
}
```

Screenshots were saved in the local Codex visualisation directory `m4b/` as `list-*.png`, `form-*.png`, `detail-*.png`, and `validation-390.png`.
