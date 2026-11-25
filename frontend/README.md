# Harbourline frontend alpha

Harbourline is the marketing workspace for Hong Kong businesses and agencies on the Adaptive Scalable and Observable Web Data Collection Platform. The approved collection Core remains available in Data Operations. The marketing workspace is a downstream product alpha. Alignment against the formal FYP Proposal and teammate review are pending.

## Open the workspace

- `/` opens Harbourline. Campaign briefs, search context and draft plans are saved in the current browser.
- `/demo` opens a separate fictional Instagram sample. It includes recommendation evidence, desk and gallery views, shortlist comparison and quoted budget scenarios. Live and fictional drafts use separate storage keys.
- `/operations` opens the local Data Operations workspace. Existing source, profile, binding, job, record, quarantine, evidence and export links continue to work. The Windows Synthetic Demo launcher continues to open its Core Overview at `/`.
- `/operations/creator-research` opens the approved local YouTube research controls. Enter the deployment's marketing operator token for that page session. The frontend sends it through the same-origin proxy. Access and permission decisions are enforced by the backend.

Use the existing Compose or Windows launcher to start the stack. For local React development with the Core API running, run the existing commands from this directory.

```powershell
npm ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:8000'
npm run dev -- --port 5173
```

## Supported data and permissions

The live workspace reads `GET /api/v1/marketing/capabilities`. Marketing M1 currently returns research-only access, and `POST /api/v1/marketing/intelligence-requests` rejects commercial use. Live creator search, recommendations and quote selection stay unavailable under this contract. API errors are shown with retry. The fictional demo is opt-in.

Data Operations uses Core health and workflow APIs and the M1 protected research watch, refresh, discovery, run, withdrawal and provider recovery endpoints. Research payloads are displayed only in the operator research page and kept in memory for that page session. The deployment can disable research and discovery separately. Expired provider results are hidden. The UI leaves platform permission and operator authorization to the API.

Marketing M2 integration needs the actual eligible creator and evidence read contracts, availability and operation-status semantics, recommendation result and ranking evidence, and quote and budget selection results. Partner ingestion also depends on the implemented M2 contract. Draft CSV exports report their status and known costs. An unknown quote makes the total unresolved. Planning assumptions are carried as text. Outcome and ROI forecasting are deferred.

`npm run build` checks TypeScript and creates the production frontend. `npm test` runs the Playwright browser suite. Use `M4_REAL_API=1` and `API_PROXY_TARGET` against an isolated test API to exercise the integration tests.