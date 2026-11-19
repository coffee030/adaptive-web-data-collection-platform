# M13 Data Explorer design decisions

## Review and implementation order

The local worktree was clean. The GitHub M12 branch and independently reviewed version both pointed to `432119acc2ec0860d316877577bf0efd4c2db9c1`. No remote branch used the M13 name. The design used project instructions, product and design documents, M11 and M12 decisions, M8 contracts, and vendored UI Slop 1.7.0 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`). The review covered results, Articles, Requests, the App shell, routing and pagination helpers, browser tests, and FastAPI, application, and persistence contracts.

1. Drive the ledger from existing REST scopes, sorting, and pagination, retaining dynamic columns and the Job quality link.
2. Open the Inspector on selection and reuse its record content in the standalone Detail view.
3. Use the real Evidence reference to link stored metadata, retaining context for Job search and detail captures.
4. Add shareable selection and pagination for versions and observations, and keep existing downloads.
5. Verify second and third visits, nested returns, isolated data, regressions, accessibility, and two browser review passes.

## APIs and relationships

Category → Topic → Collection Request → Child Job → Generic Record → Capture Evidence. A single-source Job can exist independently. The Record list returns only published, validated records and supports `job_id`, `request_id`, `limit`, `offset`, and `order=oldest|newest`. The backend orders by persistence time and Record UUID and intersects the scopes if both are supplied. An unknown Request returns 404. An unknown Job can return an empty list. The UI uses one scope and reports conflicts so clearing a condition cannot unexpectedly broaden the results. It displays 10 per page and uses the 11th to detect the next page.

The view leads with the Record title, type, Source, and field preview. The Inspector requests `include_lineage=true` for the Request and Article links. Foreign keys supply the Source, pinned approved Profile Version, Job, Evidence, and persistence time. Run ID, source position, configuration hash, and deduplication hash are available in the expanded details. Evidence returns capture type, page number, UTC time, location, safe HTTP status, and the stored SHA-256. URLs show origin and path, and CSV uses a dataset ID. Search and detail captures remain individually accessible from the Job.

When mapping succeeds, Generic Record → Observation links to Article, Content Version, and Detail Evidence. A version identifies the content, which may be observed more than once. Latest reflects the newest observation, including when it observes an older version again. The Article list's Request scope determines membership. Article Detail's latest view and version directory span collections. Only the Observation list accepts a Request filter, and a single observation must be checked against its returned `request_id`. An observation supplies the original extracted fields and its Record, Job, Evidence, Profile, Request, and version. Unmapped Generic Records remain usable throughout the workflow.

Downloads use existing Job- or Request-scoped CSV and JSON endpoints. All associated Jobs must finish, and the existing 5,000-record and 8 MiB limits, file names, and error feedback apply. The global ledger supports browsing. Download actions appear for eligible scopes. Open Quarantine from Job quality or a Request's child Job.

## Low-fidelity structures and selection

| Option | Browsing, actions, density, and relationships | Keyboard, mobile, performance, and integration |
| --- | --- | --- |
| A. `[Ledger] │ [Inspector after selection]` | Every row can be inspected. Wide views retain neighbouring records while the adjoining Inspector brings content and Evidence together. Closing it restores the full ledger width. | Uses native links and buttons and switches to one readable surface in narrow layouts. Fetches only the selected Detail and retains a standalone route. Requires URL selection and focus management. |
| B. `[Full-width ledger] → [Standalone Detail]` | Maximum ledger density. Each check leaves the browsing view, and repeated checks rely on Back. | Uses existing keyboard and mobile page navigation. Simple integration and low simultaneous data cost, with more effort to compare Records. |
| C. `[Row] ↓ [Expanded detail] ↓ [Row]` | Details and Evidence stay near the data. Long fields and lineage push subsequent rows away and shift the scroll position. | Intuitive DOM order and one column on mobile. Long content complicates reflow, focus restoration, and stable table columns. Keeping one Detail open bounds requests. |

The team selected A. The Cobalt and Slate workspace uses ledger relationships, selected-row alignment, and content hierarchy. Rows, status, controls, and provenance have appropriate semantics. The Inspector sits alongside the ledger on wide screens and uses the full width in narrow workspaces. It prioritises actual content and verification actions. The design uses Structural Direction, Information Relationships, Reactive Surfaces, Task Continuity, Semantic Diversity, Information Design, Responsive Layout, and Accessibility. Browser QA uses AI Fingerprint, Evidence, and Taste Gate.

## Navigation and state

- The URL holds shareable state. Records use `job_id` or `request_id`, `order`, `offset`, and `record_id`. A scope or sort change returns to page one. Verify the selected Record with the server and then check scope and current-page membership. Records outside the current page retain a standalone Detail link.
- Articles use `request_id`, `version_id`, `observation_id`, and offsets for both lists. Versions and observations refer to independently selected items. An observation links to its actual version.
- Explicit Return restores context through an internal URL. When history exists in the same page session, go to the original entry to restore scroll and focus. Direct Record and Evidence URLs fall back to Job Records or Data Explorer. React Router's ScrollRestoration manages global routes.
- Visible fields are scoped. A bounded cache in the same tab's JavaScript session retains field names and selections, with options accumulated from visited pages. The title prefers title, name, then headline. The default preview favours summary, description, price, and count, sorts remaining fields by name, and shows at most three. Missing, Null, (empty), 0, and false retain distinct representations. Field settings affect presentation only. Browser storage does not edit Record, Evidence, or Article payloads.
