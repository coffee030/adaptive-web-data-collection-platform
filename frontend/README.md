# Harbourline frontend alpha

Harbourline is the marketing workspace for Hong Kong businesses and agencies on the Adaptive Scalable and Observable Web Data Collection Platform. The approved collection Core remains available in Data Operations. The marketing workspace is a downstream product alpha. Alignment against the formal FYP Proposal and teammate review are pending.

## Open the workspace

- `/` opens Harbourline. Campaign briefs, search context and draft plans are saved in the current browser.
- `/demo` opens the bundled fictional Instagram sample. `/demo/connected` opens the M2 backend demo when enabled. Live, bundled and backend demo drafts use separate storage keys.
- `/operations` opens the local Data Operations workspace. Existing source, profile, binding, job, record, quarantine, evidence and export links continue to work. The Windows Synthetic Demo launcher continues to open its Core Overview at `/`.
- `/operations/creator-research` opens the approved local YouTube research controls. Enter the deployment's marketing operator token for that page session. The frontend sends it through the same-origin proxy. Access and permission decisions are enforced by the backend.

Use the existing Compose or Windows launcher to start the stack. For local React development with the Core API running, run the existing commands from this directory.

```powershell
npm ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:8000'
npm run dev -- --port 5173
```

- `/operations/intelligence-datasets` imports, inspects and withdraws M2 datasets under the operator token. The import JSON supplies the grant and record evidence.

## Supported data and permissions

The live workspace reads `GET /api/v1/marketing/capabilities`. Marketing M1 YouTube access covers approved research. Its commercial intake rejects requests. Research payloads are displayed in the operator research page and held for that page session. Disabled research, authorization failures, partial coverage and expiry are shown from the API or supplied timestamps.

Marketing M2 connects creator search and profile reads, comparison, processing status, campaign evaluations with cited evidence and ranking factors, exact budget allocation and assumption-based scenarios. The connected demo consumes the backend's synthetic dataset. Enable and seed it using the [M2 deployment instructions](../docs/contracts/Marketing-M2-intelligence.md#local-setup-and-verification). Catalog errors and permission denials are shown with retry. Connected allocations use the current session’s evidence. Reopen the brief to evaluate again after a reload or expiry. The bundled sample remains an explicit choice.

A live partner deployment needs independently authorized datasets and a trusted same-origin application host to forward the server-held customer token for M2 partner routes. The browser does not accept or store that token. This alpha has a local deployment boundary. Customer identity and multi-tenant access remain deployment dependencies. Partner CSV exports include user-authored draft fields. The fictional demo can export its sampled allocation. Trained outcome forecasting is deferred.

`npm run build` checks TypeScript and creates the production frontend. `npm test` runs the Playwright browser suite. Use `M4_REAL_API=1` and `API_PROXY_TARGET` against an isolated test API to exercise the integration tests.