# M15 browser screenshots

Chrome produced the screenshots. Files starting with `persisted-` used isolated PostgreSQL, Celery, and Redis. The empty Normal ledger also used a fresh isolated database. The other screenshots used Playwright test doubles to reproduce fixed states. These test doubles are confined to the test harness.

| View | Evidence |
| --- | --- |
| Ledger and filters | [1440 Light](ledger-1440.png), [900 Light](ledger-900.png), [768 System Dark](ledger-768.png), [390 System Dark](ledger-390.png), [320 System Dark](ledger-320.png), [Failed filter](ledger-failed-filter.png) |
| Active Job | [Initial Pending](pending-job.png), [Running lease deadline](running-lease-deadline.png), [Scheduled retry and dispatch error](retry-and-dispatch-failure.png), [Persisted scheduled retry and events](persisted-scheduled-retry.png), [Actual Redis dispatch failure](persisted-dispatch-failure.png) |
| Terminal states and events | [Partial 1440](partial-1440.png), [Partial 390 Dark](partial-390.png), [Failed after the third attempt](failed-job.png), [Persisted Failed](persisted-failed.png) |
| Results and source evidence | [Persisted detail page evidence](persisted-detail-evidence.png), [Quarantine validation problems and source positions](quarantine.png) |
| Submission | [Guided controlled web collection](guided-web-review.png), [CSV with pinned version](contextual-csv-review.png), [Unconfirmed submission](uncertain-submission.png) |
| Normal and zoom | [Fresh Normal ledger](normal-empty.png), [Ledger at native 200% Chrome zoom](ledger-chrome-200-percent.png), [Diagnostics at native 200% Chrome zoom](detail-chrome-200-percent.png) |

Two review passes compared desktop column rules, narrow rows, and results links. The second confirmed alignment of headings and content, the filter layout at 320 px, and readability of complete Record previews and Evidence links on narrow screens. The 200% captures used Page zoom in Chrome Appearance. The 1440 CSS px baseline reflowed to 720 CSS px.

In `frontend/`, set `M15_CAPTURE_DIR=../docs/evaluation/M15-screenshots` and run `npm.cmd test -- jobs.spec.ts job-create.spec.ts` in Chrome to refresh the mocked screenshots. Persisted screenshots require the isolated API and the corresponding integration tests listed in the handoff.
