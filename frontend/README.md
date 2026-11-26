# Harbourline frontend

The React application serves the marketing workspace and the separate Data Operations console. The marketing home uses the running API to determine which modes are available. The local pilot opens at `/`. The connected fictional demo opens at `/demo/connected`. [Windows launch instructions](../README.md)

Customers can research creators, inspect content and source evidence, compare candidates, save a campaign, recalculate its budget and export the supported report. The Advisor returns checked requirements, ranked evidence and a selection based on firm quotes. Data without a current authorization or usable quote cannot substantiate a priced recommendation. Outcome scenarios use the customer's explicit assumptions. [Intelligence contract](../docs/contracts/Marketing-M2-intelligence.md)

## Operations

Open `/operations` to manage creator intake, review source permissions, run collections and investigate validation or processing. The Core retains its original job, record, quarantine, evidence and export routes. The operator credential is separate from company sign-in.

- `/operations/intelligence-datasets` manages companies, imports granted data, inspects processing and withdraws datasets.
- `/operations/public-directory` reviews the shared directory source and its mapping before enabling scheduled intake.
- `/operations/creator-research` manages restricted YouTube research and refresh. This source requires its own permissions.

## Local development

Start the API in an isolated development environment. Run the following commands from this directory.

```powershell
npm ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:8000'
npm run dev -- --port 5173
```

`npm run build` checks TypeScript and creates the production frontend. `npm test` runs the Playwright browser suite. Set `M4_REAL_API=1` and `API_PROXY_TARGET` to exercise integration tests against an isolated backend. The Core supports a separate local approval mode for trusted operator actions. [Operator setup](../docs/setup/Windows-One-Click-Setup.md)
