# M15 Job Operations design decisions

## M15-A audit

GitHub Compare showed `feature/M14-operator-configuration-workspace` at the reviewed commit `b7cc87d2305c57cd8e5e523efa4ac5f21182de17`. The local worktree was clean, and M15 started from that commit. Review covered AGENTS, PRODUCT, DESIGN, M3, M4-E, M4 Closure, the M10 Reliability Evaluation, M11–M14 decisions, and vendored UI Slop v1.7 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`).

| Existing contract | M15 use |
| --- | --- |
| `GET /collection-jobs` supports five states, oldest and newest ordering, limit 1–100, and offset 0–2147483647, with sorting by creation time and ID | Fetch 20+1. Keep filters, order, and offset in the URL. A settings change returns to page one. |
| Job DTO stores claim count, publish attempts, lease, earliest retry, dispatch deadline, last dispatch, errors, times, and result counts | Make the meaning of each field visible. A dispatched Job that stays Pending may have a dispatch deadline for re-dispatch if no worker has claimed it. |
| Events are ordered by database sequence. Older events may lack kind or attempt. | Display original sequence and disclose raw kind and ID on demand. The Dispatcher handles expired leases and re-dispatch automatically. HTTP provides no execution controls or worker metrics. |
| Source and pinned Profile Version have separate GET routes. Job provides neither display name nor Request ID. | The ledger resolves distinct Sources and Profiles only for the current page and bounds concurrent requests. Child Job navigation retains the parent Request. |
| Job-scoped Evidence and Quarantine, Record filters, and CSV and JSON exports already exist | Retain direct links between captures and Records. Quarantine lists persisted invalid candidates. Ordinary duplicates contribute only to the duplicate count. |
| POST accepts an approved Source, pinned Profile, and CSV or HTML input. It returns 201 for creation, 200 for replay, and 409 for conflict. | Review the intent, then submit one Job. Retain the original intent until creation, replay, or explicit rejection is confirmed. |

The existing ledger required horizontal scrolling on narrow screens. UUID and start and end times took up the main columns. Detail already had polling and inspection links but did not explain dispatch, retry, and lease state. A background read failure removed the last readable snapshot. Submission had input validation and UUID-based recovery, while explicit review before submission and unconfirmed intent across routes still needed work.

## Low-fidelity comparison

| Option | Layout | Use and implementation |
| --- | --- | --- |
| A. Ledger and diagnostic detail | `[Status · Order] → [Source/Job · Status · Results · Created] → [Outcome → Execution → Timeline → Results]` | Operators can find all states, and filters support investigating exceptions. The detail page has room for complete events and result context. Narrow rows reflow status and counts. Existing deep URLs, pagination, and list and detail APIs can be reused. |
| B. Exceptions first | `[Failed / Partial queue] ⇄ [Investigation]`, with a separate entry for other Jobs | Efficient for repeated failure triage. Waiting and successful Jobs require a workspace switch. Two columns compress long errors and results, and mobile needs another toggle. Consistent exception ordering would require multiple status queries or a new API. |
| C. Events first | `[Event sequence with job links] → [Selected execution] → [Outputs]` | Events are useful for analysing a claim, retry, or recovery. A global sequence requires cross-Job aggregation, more reads, and a different pagination contract. Event volume makes individual Jobs and outputs harder to find. |

The team selected A and gave exceptions priority on the detail page. It retained Cobalt and Slate typography, controls, and themes. Aligned columns and row separators keep related figures together. Detail groups outcome, execution fields, and ordered events by meaning. Technical information can be expanded. Submission review brings input policy and the proposed Job into the same workflow.

## Implementation and verification order

1. M15-B builds the ledger and URL pagination, preserving loading, error, empty, and deep-link states.
2. M15-C covers Job outcome, execution, dispatch, errors, and Events. Verify that reads can continue after failure and polling stops in terminal states.
3. M15-D adds return paths for Evidence, Records, Quarantine, and Request using existing M13 navigation.
4. M15-E covers review and submission for controlled Web and CSV input, retaining the original UUID and write recovery contract.
5. M15-F/G performs two rounds of browser review, accessibility, regression, and isolated backend verification. Record actual outcomes and gaps.
