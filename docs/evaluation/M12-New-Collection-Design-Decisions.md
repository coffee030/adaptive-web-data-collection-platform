# M12 New Collection workspace design decisions

## Baseline and scope

The GitHub M11 branch, local HEAD, and independently reviewed commit all matched `875c94c8f0c358904813fe1c41e1018034713049`. The local M11 worktree was clean before M12, and no remote branch used the M12 name. Review covered project conventions, product and design documents, M8 contracts, M11 decisions, React routing, collection APIs, pagination, submission, and Playwright. Scope covered New Collection, the transition to Request Detail, and return links from existing Source and Profile details. The M11 shell, colours, and three theme modes were retained.

## Low-fidelity comparison

| Structure and outline | First use and repeated use | Density, space, and context | Keyboard, narrow screens, and M11 shell |
| --- | --- | --- | --- |
| A. Progressive vertical workspace `Topic directory ↓ approved sources ↓ keyword and review ↓ start` | Each step follows its prerequisites. The selected Topic contracts to one row so repeat operators can go directly to source selection. | Category and Topic align within the directory. Sources appear in a list, and the final review shows the whole intent. Each section uses the space its content needs. | DOM order follows the task. On narrow screens, selecting a Category collapses the Category list and leaves a way to change the selection. Keeps the M11 navigation and normal scrolling. |
| B. Side-by-side directory and setup `[Categories and Topics] ｜ [Sources, keyword, review]` | Fast for frequently switching Topics on desktop. Until a Topic is selected, the right side has no action to complete. First-time users must find their next step between the regions. | Wide layouts allow comparison, but long Source names and approval details compete with the directory for width. | DOM order crosses columns. Mobile falls back to a long list. A permanent second index next to the M11 sidebar takes too much space. |
| C. Expandable collection workspace `[Topic ▾] [Sources ▾] [Keyword ▾] → [summary]` | Direct for experienced operators. Showing toggles, completion, and configuration validity in the same row takes more time to understand initially. | The most compact desktop option. Closed sections hide Source version details needed for decisions, and errors need fresh navigation. | Mobile wraps the row or adds more disclosures. Focus must return when a section closes, making continuous comparison harder. |

The team selected A. It uses existing Cobalt and Slate styling for the operator workspace. The Topic selection is a directory, Sources are checkboxes with approved versions, and review summarizes the complete submission. Collapsing the directory after a Topic selection preserves its Category. A Source change updates the selected count and invalidates the previous review. The workflow fits in one page and uses the sections themselves to show progress.

## Data and navigation rules

- Load Categories and Topics from the existing active-only lists with offset and limit. Query Topics only for the selected Category and bindings only for the selected Topic. Topic links use the existing `topic_id`. Verify it against Topic detail and the current Category detail. Treat an unloaded directory page as unknown.
- Sources and approved Profile Versions come from eligible-only bindings. Each explicit binding creates one child Job, with up to four selections. Compare binding IDs and pinned fields before and after review. Before sending, recheck the current Category, Topic, and bindings in the browsed scope. The existing endpoint lacks a binding-ID filter, so a pin outside reloaded pages requires continued pagination. The existing submission transaction still checks authorisation and approval.
- Match backend keyword rules by trimming and checking Unicode character count and printability. Operators can still edit overlong input. The review shows only the string that will be sent.
- The unsent keyword, selections, and review live in the same JavaScript page session. Route history carries only a draft ID, and the URL carries only the shareable Topic. A context switch retains the keyword and updates Sources and review. Returning from detail rechecks eligibility. Reload resolves the Topic again.
- Check the latest data on the first submission. To recover an unconfirmed POST, use the original body and UUID. The backend first determines whether it can replay an existing Request and checks full eligibility if it needs to create one. Success replaces the active history entry with persisted Request Detail. An earlier draft entry offers the Request or a new collection.
- Request Detail uses persisted Job statuses and valid record counts to show the next action. It retains polling, Refresh, Article History, and downloads.

## UI Slop v1.7

Structural Direction guided the comparison. Category → Topic → binding → Job drives Information Relationships and Reactive Surfaces. Task Continuity covers return, invalidated selections, and the lifecycle after submission. The directory, checkboxes, status, and review use semantics appropriate to each, following Semantic Diversity. The M12 handoff records Browser QA, AI Fingerprint, Evidence Gate, and Taste Gate results.
