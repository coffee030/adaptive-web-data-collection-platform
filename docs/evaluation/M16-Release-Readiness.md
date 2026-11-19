# M16 release candidate and integration decision

The acceptance report provides the supporting evidence. The presentation runbook covers demo order and recovery. [Final MVP acceptance](M16-Final-MVP-Acceptance.md) [FYP Presentation Runbook](M16-FYP-Presentation-Runbook.md)

## Release gates

| Gate | Status | Review evidence |
| --- | --- | --- |
| A Repository | PASS | Started from approved M15. The comparison confirmed `main` was an ancestor and M6–M15 commits were traceable. |
| B Core | PASS | PostgreSQL, Core, migration, validation, results, Evidence, and export suites. |
| C Safety and authorisation | PASS | Verified loopback Host and Origin checks, separate Source authorisation and Profile approval, and backend enforcement of Binding eligibility. |
| D Reliability | PASS | Live Redis, PostgreSQL, Dispatcher, worker lease recovery, and replay with the same UUID. Retained historical throughput evidence for the unchanged Core. |
| E Frontend completeness | PASS | M11–M15 suites, operator and user journeys, Job return navigation, and Record and Evidence lineage. |
| F Windows one-click startup | PASS | Started directly from a fresh archive via BAT, verified persisted presets, triggered the default browser, and checked repeated startup, stop, and data retention. |
| G Demo data | PASS | Three persisted fixture baselines, the manifest, Records and Evidence, articles, the `detail404` exception, and both export formats. |
| H Accessibility and design | PASS | UI Slop v1.7 narrow and desktop review, Chrome 200% zoom, keyboard, reduced motion, visible focus, and axe. |
| I Documentation and protection | PASS | Startup, error codes, recovery, backups, and both operating modes are documented. Tracked environment files were examples. Checked for secrets and runtime artifacts. |
| J GitHub integration | PARTIAL | Independent review and final merge were PENDING. The handoff records Draft PR, CI, and integration status. [M16 handoff](../../M16-Implementation-Handoff.md) |

## Data and safety review

Local deployment assumes a trusted operator and loopback. Host and Origin checks and opt-in approval restrict cross-origin actions. Real websites still use a Source allowlist, approved immutable Profiles, path, DNS, and redirect checks, and origin rate limits. The Demo uses a separate Compose project, credentials, network, database, Evidence and manifest volumes, and an internal fixture network. Backend idempotency, claims, leases, and transactions protect key writes.

`git ls-files` checked for `.env`, private launcher settings, runtime databases, `.lnk`, logs, keys, and dumps. The only exceptions were tracked environment examples. A content scan checked common secret formats and this change set. The 12 candidate launcher logs contained zero matches for actual private settings values. QA console output, browser traces, downloads, and settings stayed in ignored local paths. Docker fault injection was scoped to the QA project. Earlier Normal and Demo inventories and Desktop shortcut inventories were retained.

## Independent review and merge

**The merge decision was PENDING.** The Draft was available for technical review. After GO, verify remote main, the PR head, all open PR bases, ancestry, main rules, CI, and review again. If main has moved, integrate it safely into the feature branch and repeat affected verification. Change the GitHub PR to Ready using the normal process and prefer a merge commit. Follow the platform's actual review and check requirements.

After GitHub confirms the merge, use a fresh main checkout to verify SQL migrations, BAT startup, presets, document links, and checkout content. Check M6–M16 ancestry and the final main SHA. Mark #1–#4 as superseded only after confirming their integration. Retain the branches and discussion history for reference.

## Backup, rollback, and troubleshooting

- Before updating, stop the owned services using Stop for the correct mode. Back up ACL-protected launcher settings, PostgreSQL dumps, the Evidence volume, and the Demo manifest. If queued Jobs need to survive, back up Redis as well. Record the Compose project identity and volume names. Rehearse restoration in a separate project and compare the API, approved configurations, and capture hashes.
- To restore the behaviour of merged code, submit a normal corrective or revert PR. Check expected schema compatibility and restore the backup into a new project. Retain existing volumes and settings for investigation. The M16 candidate uses the same migration.
- Use `Diagnose-Platform.bat` or `Diagnose-Platform.bat -Demo` to check mode, ports, Docker Linux Engine, settings, schema, and baselines. Follow the reported error code. [Windows setup and operation](../setup/Windows-One-Click-Setup.md)

A physical 8 GiB Windows machine, Docker Desktop cold start, and physical screen reader tests remained outstanding. FTC and New York Fed configurations were outside the MVP's verified Source set. [Real website feasibility](M10-Real-Website-Feasibility.md)
