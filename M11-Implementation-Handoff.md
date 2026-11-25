# M11 Implementation Handoff

**Recommended GO for independent review.** M11 verification covered UI Slop, frontend foundations, the app shell, navigation, and Overview.

| Git item | Reference |
| --- | --- |
| Delivery branch | `feature/M11-ui-foundation-overview` |
| Implementation and evidence commit | `8e4f400b6492502a048e62683ea9d022fb3b36ff` |
| M10 baseline | `1572fc8a8aab05f0d81a81c9b0a7ffc994218974` |

The delivery snapshot includes this handoff. The preceding commit contains the implementation. [Delivery snapshot](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/875c94c8f0c358904813fe1c41e1018034713049) [Implementation commit](https://github.com/coffee030/adaptive-web-data-collection-platform/commit/8e4f400b6492502a048e62683ea9d022fb3b36ff)

## Review and design

- Git history, remote branch, and Draft PR #4 HEAD matched. The authorised GitHub account had read and write access. PRs #1–#4 were open. M11 used a separate checkout to preserve different local M10 histories. Review covered React Router, REST client, global CSS, FYP frontend skill, Impeccable 4.9.0 and Operate and Audit references, Playwright and axe, and both M10 launch modes. [M10 Draft PR #4](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/4)
- UI Slop 1.7.0 was pinned to `6f8a7d22aff293e0e92183df93cf5d53e886ba1a` on upstream `release/v1.7-task-continuity`, with version confirmed by the changelog. Codex used `.agents/skills/ui-slop/SKILL.md` from the M11 checkout. SHA-256 matched all 36 upstream files, including MIT LICENSE, ACKNOWLEDGEMENTS, references, and upstream evidence. Impeccable's entry was renamed to `SKILL.legacy.md`. Command paths, sidecars, and historical acceptance references supported reproduction. [Pinned UI Slop version](https://github.com/suna-kabo/ui-slop/tree/6f8a7d22aff293e0e92183df93cf5d53e886ba1a)
- Compared a workspace and Request ledger, staged workflow, and event timeline. Chose the workspace and ledger. The Topic directory lets operators start directly. Each ledger row brings together Request, child Jobs, failures or partial completions, and results. Empty state guides Source setup. [Low-fidelity comparison and continuity rules](docs/evaluation/M11-Frontend-Redesign-Decisions.md)
- Shared Cobalt and Slate, font fallbacks, spacing, state, and focus rules apply to desktop and narrow layouts. Shell and Overview CSS are scoped independently. Added a navigation surface token. Existing views retain shared controls, tables, status colours, and detail reflow. [Design system](DESIGN.md)

## Operator workflow

1. Workspace offers Overview, New Collection, Collection requests, and Data Explorer. Operations offers Sources, Topics & bindings, Collection Jobs, and Single-source & CSV. Mobile keeps four primary entries. Operations expands and Escape restores the toggle. Open Profiles from Sources and Evidence from Request, Job, or Record links.
2. Overview previews up to six active Topics and reads approved bindings via existing APIs. A Topic selection opens the form with that Topic, then the form rereads Category and Topic and queries eligible bindings. The operator explicitly selects Sources. If the full preview has no eligible Topics, Manage sources is the primary action with Topics & bindings alongside.
3. The five latest Requests follow API order and show Topic, keyword, UTC time, child Job status, and validated Record links. Separate running and pending queries expose global activity. Below are results and errors for the five latest Jobs and links to the four latest persisted Records with their existing dataset notices.
4. Router retains URLs, query scope, and Back and Forward. Route changes focus main. The Evidence heading receives focus on navigation to the hash. Retry is local to a failed section. Refresh activity rereads activity and retains readable loaded data during refresh. Themes are Light, Dark, and System.

## Verification

| Check | Result | Observation |
| --- | --- | --- |
| TypeScript and Vite production build | PASS | `npm run typecheck` and `npm run build` passed, including the workspace favicon. |
| Playwright frontend regression | PASS | 91 Edge tests covered Topic eligibility and prefilling, unchecked Sources, Loading, 503, Retry, active Jobs, Partial, Failed, focus, navigation, and existing features. |
| Normal mode | PASS | Windows launcher used a fresh isolated DB with PostgreSQL, Redis, Alembic, FastAPI, worker, and Dispatcher ready. Seven API lists returned `[]`. Desktop and mobile could open Sources from empty state. |
| Synthetic Demo | PASS | Used the running M10 Demo API for Fixture Listings, Influencer Advertising and Sponsorship, and Market News and Economic Updates. Checked each Topic preset, two baseline child Jobs, and persisted Records. One existing live test verified six CSV and JSON downloads and the simulated-market warning. A separate persisted failed Request and both source errors appeared in the ledger and Jobs. |
| Launcher smoke | PASS | `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/windows/Test-Launcher.ps1`, 29/29. Used existing BAT for fresh Normal mode and confirmed live API and frontend proxy. |
| Primary workflow and nested history | PASS | In the live Demo, used touch to open three Topics, opened child Job Evidence from a Request, returned through both levels, opened scoped Records for the same Request, and checked Back and Forward. |
| Light, Dark, and System | PASS | Manually switched all three in live pages. Regression verified System follows environment and explicit themes persist over navigation and reload. |
| Viewport, overflow, and 200% | PASS | Edge Chromium 157.0.4341.60 checked 1920, 1440, 1280, 901, 900, 768, 430, 390, 360, and 320 px. Native Chrome 200% had DPR 2 and clientWidth and scrollWidth both 712 CSS px. Keyboard could open New Collection and return. |
| Focus, keyboard, semantics, and reduced motion | PASS | axe WCAG 2.0 and 2.1 A and AA found no violations. Checked main, headings, regions, link names, and status text in Chromium accessibility tree. Verified Skip, Escape, focus outline, Retry focus, and primary navigation. Topic links had no transition with reduced motion. |
| Live console and API | PASS | Final live paths in both modes showed no console errors, page errors, or unsuccessful API replies. Mock suite Vite logged default proxy messages for unmocked requests and warnings from tests disabling sessionStorage. |
| UI Slop Browser QA, AI Fingerprint, Evidence, and Taste | PASS | Visually compared original, first redesign, and corrected desktop, mobile, and grayscale views. Topic directory, Request ledger, grouped navigation, and child Job results were distinct in grayscale. Actual controls and status text defined the workspace. |
| External screen reader | NOT RUN | Used Chromium accessibility tree, axe, and keyboard checks. |
| Full backend pytest, cold install, and default browser startup | NOT RUN | Used existing M10 backend and an isolated launcher smoke check. |

## Browser fixes and screenshots

The first 390 px redesign repeated eligibility copy, Demo notice, and wrapped actions, pushing the first Request to the viewport edge. Shortening the notice, removing duplicate copy, and placing Refresh and history on one row made the first failed Request readable above the fold in the new screenshot. Empty-state primary action became Source setup, focus after Retry was improved, and a browser icon fixed startup `/favicon.ico` 404. Delivered captures were visually reviewed. Native Chrome zoom capture used a compositor viewport of 1424×805 physical pixels.

| State | Actual screenshot |
| --- | --- |
| Synthetic Demo desktop 1440 px | [Light](docs/evaluation/M11-screenshots/demo-desktop-light.png) · [Dark](docs/evaluation/M11-screenshots/demo-desktop-dark.png) |
| Synthetic Demo mobile 390 px | [Dark](docs/evaluation/M11-screenshots/demo-mobile-dark.png) |
| Empty Normal with System choosing Light | [Desktop 1440 px](docs/evaluation/M11-screenshots/normal-desktop-light.png) · [Mobile 390 px](docs/evaluation/M11-screenshots/normal-mobile-light.png) |
| Synthetic Demo, Chrome Page zoom 200% | [Chrome viewport](docs/evaluation/M11-screenshots/demo-zoom-200.png) |

## Product scope and follow-up

- The Git diff checked backend Core, REST, database, Demo provisioning, BAT and PowerShell launcher, packages, and lockfile. Existing authorisation, Draft, Preview, Validate, Approve, Topic Bindings, Requests and Jobs, Data Explorer, Evidence and Provenance, Article History and Refresh, and CSV and JSON use their existing contracts. Frontend regression and live tests covered the main entry points.
- Overview previews existing APIs. New Collection browses a larger directory and Request and Job pages provide full activity. Pending and Running refresh on entry or Refresh activity. In the tested mobile flow, Back returned to the same Overview. Scroll position changed from 188 px to 172 px while asynchronous data loaded. Precise return position and trigger restoration for long ledgers were deferred.
- **M12** covers Topic and Source selection continuity in New Collection and Request → Job navigation. **M13** covers the Evidence-first Record Ledger, Inspector, Record and Evidence links, returning from Article History, and the filter, sort, selection, and scroll lifecycle. **M14** covers Source, Profile, and Binding management, Job diagnostics, and overall consistency. [Continuity requirements](docs/evaluation/M11-Frontend-Redesign-Decisions.md#navigation-and-state-lifecycle)

| Acceptance gate | Result |
| --- | --- |
| A Skill, B Product Integrity, C Visual/Structural, D Usability, E Accessibility/Responsive, F Regression | PASS |
| G Independent Review Readiness | PASS. Code, verification steps, screenshots, limitations, and commit are available. Independent user review was pending. |
