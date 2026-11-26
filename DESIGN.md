# Harbourline interface

The customer workspace is organized around creator research, evidence and campaign budgets. Use the current customer workspace stylesheet and its feature components when extending the interface. [Marketing styles](frontend/src/features/marketing/marketing.css)

## Data Operations

Use the operator landing page for source approval, creator intake, collection and investigation. Keep a direct route from a job to its validated records, quarantined items and source evidence. Place service health beside the task directory. Separate system health from worker activity or collection outcomes.

The operator shell defaults to dark charcoal surfaces, with aqua for links and active selections, amber for attention and a distinct error color. The theme selector also supports light and system settings. Use the shared CSS properties for backgrounds, text, state colors, controls and focus. Keep Traditional Chinese and English system font fallbacks and tabular numerals for financial amounts and timestamps. [Shared tokens](frontend/src/styles/console.css)

Use native controls, descriptive links, named regions and visible keyboard focus. On narrow screens the administration menu can collapse and the task directory becomes a single column. Keep uncertainty, partial data and failure states explicit. Report the status of the service that actually responded.
