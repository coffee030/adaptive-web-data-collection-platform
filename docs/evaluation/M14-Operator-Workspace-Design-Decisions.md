# M14 operator configuration workspace design decisions

## M14-A repository review

GitHub Compare confirmed that `feature/M13-evidence-first-data-explorer` and the clean local worktree both pointed to `ff211bef68dec3e304b5fa253d89a50230e25255`. No remote branch used the M14 name. The local M14 branch started at that commit.

The review covered AGENTS, PRODUCT, DESIGN, the M11–M13 decisions, the M2, M4 Closure, M7, and M8 contracts, and existing React routes and tests. It used the FYP frontend skill and vendored UI Slop v1.7 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`). Source and Profile already supported the main actions. IDs and hashes dominated the reading order, authorisation lacked confirmation, and operators could resubmit after a failure. Long Category and Topic dropdowns served both selection and editing. Binding forms appeared above existing eligibility and approval details.

| Contract | Implementation review |
| --- | --- |
| Source | The list returns a complete array. The unique UUID request key is checked against the normalised payload. First submission returns 201, identical replay 200, and a different payload 409. The registration UI explicitly sends pending. Policy checks remain in the Core. Source updates lock the Source in a database transaction. |
| Profile | A saved Draft updates with `expected_revision`. A Source lock and version check protect editing and approval. Preview reads the current version. Validation rechecks revision, Draft status, and Source before writing. Under lock, approval checks the current configuration hash, latest passing report for that revision, Source, and version number. |
| Catalog | Category and Topic lists support pagination. Creating a Topic supplies a Category. Updates accept only name and active. The database locks updates and rejects duplicate names. Concurrent updates can still overwrite an earlier write because there is no revision. |
| Binding | Approval pins a Source, Profile Version, and hash. Approval and restoration require valid Source and Profile states and compliance with the keyword-search contract. The API can save a Binding for an inactive directory. Eligibility is computed from Topic, Category, Source, Profile, and disabled state. The API provides no per-item reason. |
| Local operator | FastAPI checks loopback Host and same-origin Origin. Vite also restricts Profile approval and Binding mutations. Source authorisation uses the same local flag and the existing UI action is for web Sources. The operator supplies the approval label. |
| Navigation | Retains `/sources`, `/sources/:id/profiles/:version`, `/topics`, `/topics/:topicId`, and `/collection-requests/new?topic_id=…`. M12 rechecks the directory, Binding, and pinned version. Keeps Back to collection and the M13 history and scroll contract. |

## Low-fidelity structures

| Structure sketch | Comprehension, density, and safety | Routes, mobile, continuity, and cost |
| --- | --- | --- |
| A. `Source ledger → Source [access policy] ↓ [version history] → draft` | The Source identity stays visible. Access, versions, and bindings belong to separate objects. Operators can review and confirm beside relevant data and open existing versions directly. | Reuses Source and Profile deep links. Narrow ledgers become labelled data rows. Preserves the previous location. Changes are concentrated on operator views. |
| B. `[Source + Topic selector] ｜ [requirements matrix] ↓ [exceptions]` | Missing items are visible in a matrix. Relationships are abstract until selected. Reporting global eligibility costs more reads and can incorrectly suggest that separate approvals form one state. | Selected Source and Topic both need new context controls. A narrow matrix needs separate navigation. Highest maintenance and request cost. |
| C. `[Register] ↓ [Authorize] ↓ [Configure] ↓ [Check] ↓ [Bind]` | Easy to learn and progressively disclosed. Revisiting historical entries or correcting earlier settings requires moving back and forth between stages. | Clear order on narrow screens. Existing deep links need wizard synchronisation. Cross-page drafts and Back add work. |

The team selected A and added next actions based on the current object and progressively disclosed settings. The ledger uses scannable rows. Policies and immutable configuration use definition lists, and approval and disabling are reviewed in place. It reuses Cobalt and Slate tokens. The URL stores shareable pagination and the selected Topic. Back does not reconstruct temporary reviews, reports, or unsaved Drafts. On mobile, prioritise Source names, states, and related actions.

## State and implementation order

1. **M14-B** Register as pending → show the saved Source → review restrictions → explicitly authorise or revoke → GET the current state. If the outcome is unconfirmed, read the saved state before offering another action.
2. **M14-C** Create a Draft → edit unsaved content → save with the revision. If a write is stale or unconfirmed, retain local values for comparison and read the server before choosing how to proceed.
3. **M14-D** Preview and Validate the saved Draft → review the passing report → supply an operator label and explicitly confirm → show the approved version as read-only. Invalidate the old report if the content or sample changes.
4. **M14-E** Open Category and Topic and review existing Bindings → select an authorised Source and a compatible approved version → reread the latest state after approval, disabling, or restoration.
5. **M14-F** An available Topic passes `topic_id` to M12 so M12 can recheck eligibility. Retain CSV and single-source links and the M12 return path.
6. **M14-G/H** Run existing Playwright and isolated Core tests, two rounds of browser review, and axe. Record actual commands, results, screenshots, and gaps in the handoff.

## Implementation decisions and browser review

- The Source ledger paginates the complete API result locally. Row guidance depends on that Source's authorisation. Source detail shows allowed origins, paths, or datasets, a version list, and next actions on one page. Existing deep links still work.
- The Profile workspace retains the existing Draft format. Collapsible pagination and Article mapping use the same React Draft. Sample checks correspond to a saved revision. The UI withdraws an earlier report after sample or saved configuration changes. Approval is enabled only when the current hash and version match the passing report.
- The selected Category scopes the Topic list. Topic bindings reads only the selected Topic, its Category, the current Binding page, and one eligible-only result. Profile Versions load after selecting their Source. On narrow screens, labels follow the row reading order. The view uses native forms and buttons.
- In Pass A, Chromium showed registration below the initial viewport, unused space in a wide Profile panel, and review for disabling or restoring Bindings outside the affected row. A selector required by tests was also folded into a secondary section. The fix split website inputs into columns, shortened the Profile work panel and added section links, moved Binding reviews into the ledger, and opened the required selector.
- Pass B repeated the controlled flow through registration, Profile and approval, Category and Topic, Binding, and New Collection. When quickly returning from Profile to M12, route-level loading was limited to the active operator page so the M12 draft and server-side eligibility refresh resumed correctly. The native Edge 200% screenshots capture the full viewport and show long values, outlines, and reflow.
