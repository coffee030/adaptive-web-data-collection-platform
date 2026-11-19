# M13 browser screenshots

Pass B used Edge with separate Normal and Synthetic Demo APIs. Chrome separately checked native 200% page zoom. Demo screenshots show actual persisted results from controlled fixtures. For screenshots 12 and 13, Playwright temporarily controlled loading and the HTTP 503 response for the same Records API. Retry then reconnected to the live Demo API.

| View | File |
| --- | --- |
| Global and Request-scoped ledgers, 1440 px | [01](01-ledger-desktop.png), [02](02-request-records-desktop.png) |
| Ledger with adjacent Inspector, 1440 px | [03](03-ledger-inspector-desktop.png) |
| Record Detail and Evidence Metadata, 1440 px | [04](04-record-detail-desktop.png), [05](05-evidence-desktop.png) |
| Content Versions and Observation History, 1440 px | [06](06-article-versions-desktop.png), [07](07-observation-history-desktop.png) |
| Ledger reflow | [900 px](08-ledger-900.png), [768 px](08-ledger-768.png), [390 px](08-ledger-390.png), [320 px](08-ledger-320.png) |
| Inspector and Record Detail in Dark mode | [320 px](09-inspector-320-dark.png), [390 px](10-record-390-dark.png) |
| Empty Normal, simulated loading, and API 503, 900 px | [11](11-normal-empty.png), [12](12-simulated-loading.png), [13](13-simulated-failure.png) |
| Validated records and child Job states for a Partial Request, 1440 px | [14](14-partial-request-records.png), [15](15-partial-request.png) |
| Chrome native 200% page zoom with a 712 px CSS viewport | [Ledger](16-ledger-200-percent.png), [Inspector](17-inspector-200-percent.png) |
| Latest persisted Version 2 and Version 1 retained by the original Request | [18](18-latest-version-and-original-request.png) |

The M13 handoff records browser checks, UI Slop review gates, and test results. [M13 handoff](../../../M13-Implementation-Handoff.md)
