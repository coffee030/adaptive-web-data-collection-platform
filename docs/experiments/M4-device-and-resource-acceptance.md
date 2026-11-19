# M4 Device and Resource Acceptance

| Evidence | Verified scope | Remaining acceptance |
| --- | --- | --- |
| Chromium 158.0.8127.18 | Closure passed 78 controlled and 14 live Docker tests. This round also passed 10 controlled keyboard, form, polling, and Evidence tests. | Verified Windows Chromium. Physical mobile and manual Narrator acceptance remained pending. |
| Playwright Firefox 159.0 | Closure passed 6 representative live and 2 polling cases. This round also completed 5 reproduction attempts and 2 live smoke checks. | Retained the original crash and rerun results. |
| Playwright WebKit 27.2 | Closure passed 6 representative live and 2 polling cases. Chromium responsive tests covered 1440, 1280, 768, and 390 px. | macOS Safari **OUT OF SCOPE / NOT RUN**. The user removed it as an acceptance gate. Physical iPhone Safari **NOT RUN**. These tests used Playwright's bundled Windows engines. |
| Docker resource measurements | The isolated Compose project completed the demo and restart within total service limits of 1792 MiB. No sampled OOM, and Docker VM memory was about 15.56 GiB. | Physical 8 GB Windows **NOT RUN**. Host services, VM overhead, paging, concurrent UI processes, and sustained usability still required a physical test. |

[Original measurements and browser evidence](M4-remediation-test-results.md)

## Firefox Page crashed investigation

- Reviewed error context and `trace.zip` from `frontend/test-results/closure-acceptance-firefox/`. At `closure.integration.ts:117`, `frame.evaluate` reported `Page crashed` during `AxeBuilder.runPartialRecursive`. The Evidence page and metadata API returned 200, the hash was visible, and both direct Host and Origin requests returned 403. The archived trace had no minidump or native crash signature. No matching file was found in the default local Firefox crash-report location. A native crash, resource pressure, and an application-triggered crash remained unconfirmed.
- The historical representative Firefox suite passed on rerun, 6/6. This round passed 5/5 sequential reproductions with retries disabled and tracing enabled, plus 2/2 full live closure smoke tests including a sixth Evidence case. Windows ran Firefox 159.0 and Playwright 1.65.0 against isolated PostgreSQL, Redis, and worker in `collection-m3-test-final-gate`. Evidence stayed in ignored `frontend/test-results/final-gate-firefox` and `final-gate-firefox-smoke`. [Acceptance test commands](M4-remediation-test-results.md#final-gate-follow-up-verification)
- This limited check confirmed no reproducible defect. If the incident recurs, record browser and build, frequency, trace, and any crash ID or dump in an issue. Compare before and after axe execution and distinguish browser startup from service changes.

## Explicit device decision

The user removed the macOS Safari gate because no Mac was available. Record decisions separately for **physical iPhone Safari** and **physical 8 GB Windows**.

- **Accept after completing physical checks.** On iPhone, test Source, Profile, Job, Records, and Evidence using authorised fixture deployment and the trusted operator boundary. Record workflows that cannot be performed. On 8 GB Windows, run the Docker demo and a representative live workflow under typical developer-tool load. Record Windows build, installed RAM, paging or pressure, startup time, Job outcomes, and OOM.
- **Explicitly accept an MVP limitation.** The user records each accepted item, reason, date, and impact and retains **ACCEPTED LIMITATION — NOT RUN**. Keep **BLOCKED** until decided.

The MVP uses a trusted local console, a controlled fixture, and live offset pagination. Job status updates depend on actual execution time. Narrator has separate manual acceptance. [Narrator procedure](../reviews/M4-narrator-acceptance.md)
