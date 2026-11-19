# M11 frontend redesign decisions

## Review baseline

GitHub's M10 branch and open Draft PR #4 both pointed to `1572fc8a8aab05f0d81a81c9b0a7ffc994218974`. The GitHub account could read and write the repository, and PRs #1–#4 were open. M11 used a separate checkout of the verified remote commit. The two existing M10 checkouts each had different local histories. The review covered `AGENTS.md`, `skills/AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, the FYP frontend skill, and the Operate and Audit references for Impeccable 4.9.0.

React Router's `App` controlled routing and page focus. Existing paths and query parameters defined scope. Vite used a loopback API proxy and a compile-time Demo flag. M10's launcher started Normal and Synthetic Demo through the same Vite entry point. Existing tests used Playwright, axe, mocked REST, and separate live suites. The old Overview placed recent Jobs and validated records below its introduction. At 390 px, users had to scroll to see them. Shared buttons, tables, status labels, focus, and CSS tokens affected each feature view.

## Low-fidelity comparison

| Structure | Desktop and mobile | Visibility, density, navigation, and continuity |
| --- | --- | --- |
| A. Workspace with Request ledger | `Sidebar → topic directory → Request ledger → Jobs and Records`. Mobile used 2×2 primary navigation and wrapped Request rows. | Topics can be started directly. Each row groups a Request, Job status, and the records link. Sources and Operations are clearly grouped. Narrow screens preserve relationships and semantic order. |
| B. Guided workspace ordered by stage | `Top path → topic → sources → execution → results`. On mobile, scroll through the stages. | Clear for first use and an empty database. Concurrent work across Topics can split a single Request across stages. Completed work takes more steps to revisit. |
| C. Event-centred timeline | `Top navigation → Timeline (primary) → current event (secondary)`. On mobile, open details from the timeline. | Quick for investigating a single event and browsing related events. Recent history can obscure new collection. An empty database shows little information. Mobile users repeatedly return to the timeline. |

**The team selected A.** The workspace first offers available Topics. The Request represents the whole collection and links directly to its persisted records and child Jobs. When Topic collection is unavailable, the same area points to Source and binding setup. Existing Cobalt and Slate colours, subtle separators, and clear numeric hierarchy support routine operation. Topics use a directory with actionable links. Status uses text and colour. Job summaries use counts and event times. Actual Sources, Requests, and Records fill the workspace.

## UI Slop

The Codex project skill lives in `.agents/skills/ui-slop/` and is pinned to the upstream commit below. Upstream published it through `release/v1.7-task-continuity`, and the commit's changelog identifies 1.7.0. The main file, references, evidence, and licence are recorded in Git from the same commit. They are readable after a Windows checkout without a global install, extra packages, or hooks. The Impeccable entry file was renamed. The instructions, references, sidecars, and historical evaluations remain available for reproduction. [v1.7.0 upstream commit](https://github.com/suna-kabo/ui-slop/tree/6f8a7d22aff293e0e92183df93cf5d53e886ba1a)

## Navigation and state lifecycle

- Paths identify pages. Deep links in collection history and results retain the URL scope. The browser and router manage initial URLs and Back and Forward.
- Explicit navigation focuses main and sets the page title by path. The skip link only moves focus. Opening narrow Operations navigation is temporary, and Escape returns focus to the toggle. Topic links carry a candidate topic ID. The form revalidates the active Category and Topic and the approved bindings.
- Theme is persisted locally. Overview data and API read errors belong to the current view. Submitted Jobs and their results persist independently in the backend.
- **M12** brings Back and draft restoration for eligible Topic, Category, and Source choices into the New Collection contract. Keep draft fields that can be restored safely and recheck Source and Profile Version eligibility upon return. Paths from a Request to a child Job, its error, and Evidence retain the original Request ID and useful fallback destinations for direct links.
- **M13** defines which Data Explorer filter, sort, selected-record, and scroll state belongs in the URL or a history entry. Returning from Record, Evidence, or the original Request should restore the same ledger scope and keyboard trigger. Article History returns to the original Article or Request with the selected version and list position. Verify the second and third record visits.
- **M14** aligns Operations forms and diagnostics and rechecks cross-page frontend workflows and accessibility.
