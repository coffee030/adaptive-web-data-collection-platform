# M16 final MVP implementation handoff

## Version and review status

| Item | Observation |
| --- | --- |
| Latest reviewed baseline | M15 `0b609b198146fdc2e0ab494e7a4a3b58083abc5d` |
| Final M16 implementation commit | `185981553a14bf005345a5761eb549aa216a785c`. Release documents and GitHub verification results were saved in a separate documentation commit. |
| Integration snapshot | [M16 MVP acceptance](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/3f0aeb095ddba703dcb632deb677722ed68b7052) |
| Draft PR | Targeted `main`. [#5 · M16 — Final MVP Acceptance and M6–M16 Integration](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/5) |
| GitHub Actions | The local frontend build and all 187 selected Linux unit checks passed. [Draft PR #5 live check report](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/5/checks) |
| Independent technical review | PENDING |
| Normal PR merge and post-merge verification | PENDING. Before review, `main` was `2f880f9ae1e30fa3fff7e11261194873b8ccd2de`. |
| Earlier stacked PRs | #1–#4 remained Draft pending post-integration verification. |

## Implementation and results

- Removed `Install-FYP-Demo-Shortcut.bat` and `scripts/windows/Install-DemoShortcut.ps1` and updated user documentation and launcher regression checks. Retained `Start-FYP-Demo.bat`, `Start-Platform.bat`, `Setup-Platform.bat`, `Stop-Platform.bat`, `Diagnose-Platform.bat`, and `scripts/windows/Platform.ps1`.
- The fresh archive ran the BAT directly from a directory containing Unicode and spaces, installed locked npm packages, accommodated occupied ports, verified persisted Demo baselines, and asked Windows to open the default browser. Normal and Demo use separate settings, Compose identities, and volumes. PostgreSQL data and evidence references matched before and after restart. The existing Desktop shortcut inventory was unchanged.
- Job Detail shows a parent Request only when the backend confirms it. Incorrect or stale hints and IDs present only in Router state cannot establish the relationship. Return navigation preserves the originating Request's focus and query.
- Fixed a shared class conflict between the Overview heading and Data Explorer, and enlarged the touch targets for small Source Binding links. Retained the M11–M15 interface structure. The GitHub workflow added the frontend build with TypeScript and non-destructive backend unit tests.

| Test | Result |
| --- | --- |
| Backend Core, PostgreSQL, Redis, and Celery | PASS, 270 tests, 0 failed and 0 skipped. |
| Chrome Playwright | PASS, 154 mocked regression tests and 26 live API cases. |
| Windows PowerShell and real BAT | PASS, 28/28 regression checks. Covered isolated Normal Setup, Start, Diagnose, and Stop, plus repeated Demo startup, stop, restart, and retained volumes. |
| Demo data and accessibility | PASS. Checked three baselines, `detail404`, Article versions, Evidence files, and both exports. Seventeen live page and viewport checks found no axe A or AA violations or page-wide horizontal overflow. |
| Physical 8 GiB, actual Docker Desktop cold start, and physical screen reader | NOT RUN. A separate test constrained containers to 1,664 MiB, and real Windows Shell verification used an existing Docker Engine. |

The acceptance report contains the audit, complete test matrix, reproduction commands, and evidence locations. Release Readiness records gates, data protection, and rollback. Start the demonstration with the presentation runbook. [Final MVP acceptance](docs/evaluation/M16-Final-MVP-Acceptance.md) [Release Readiness](docs/evaluation/M16-Release-Readiness.md) [FYP Presentation Runbook](docs/evaluation/M16-FYP-Presentation-Runbook.md)

**Recommended GO for independent technical review.** M16-H would proceed after independent GO confirmation, following the applicable GitHub branch rules, CI, and normal PR merge process.
