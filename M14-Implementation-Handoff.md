# M14 operator configuration workspace handoff

M14 guides Source authorisation, extraction-rule approval, and Topic Binding from persisted state. An isolated test went from a pending Source to two successful child Jobs and traced their Records and Evidence.

| Git baseline | Version |
| --- | --- |
| Starting M13 SHA | `ff211bef68dec3e304b5fa253d89a50230e25255` |
| Final M14 implementation SHA | `425a8edc646672b940cb1b468e17dc27e2e036ea` |
| Delivery snapshot | [M14 configuration workspace](https://github.com/coffee030/adaptive-web-data-collection-platform/tree/b7cc87d2305c57cd8e5e523efa4ac5f21182de17) |

## Repository review and design

GitHub Compare verified the remote M13 HEAD, independently reviewed SHA, and clean local checkout matched. Reviewed AGENTS, PRODUCT, DESIGN, M11–M13 decisions, and M2, M4 Closure, M7, and M8 contracts before implementation. Checked React routes, API clients, FastAPI routes, Source and Profile services, PostgreSQL revision and idempotency, and Category, Topic, and Binding eligibility.

The low-fidelity options were A, Source-centred, B, eligibility matrix, and C, step-by-step configuration. The team chose A, placing access policy, version list, and next steps in Source detail and keeping rules and sample checks on one Profile route. B required more reads for accurate cross-object eligibility. C complicated direct links and revisiting existing versions.

Used the FYP frontend skill and vendored UI Slop v1.7 (`6f8a7d22aff293e0e92183df93cf5d53e886ba1a`). Structural Direction, Information Relationships, Reactive Surfaces, Semantic Diversity, Interaction Hierarchy, Task Continuity, Accessibility, and Responsive Layout guided layouts and states. The design decisions record two live browser reviews, fixes, and the state diagram. [M14 design decisions](docs/evaluation/M14-Operator-Workspace-Design-Decisions.md)

## Delivered behaviour

| Workspace | Operator actions and system contract |
| --- | --- |
| Source Catalog | Paginates the actual Source array locally at 20 per page. Shows adapter, access authorisation, Permission reference, and next steps based on Source state. Keeps links, loading, empty and Retry states, and pagination return focus. |
| Registration and authorisation | Register name, adapter, operator-supplied permission reference, origins or datasets, paths, and pacing. New registration starts pending. 201 shows created and 200 shows recovered. If outcome is uncertain, the same form retries original values and UUID. Resolve the uncertain registration before submitting different values. Authorisation and revocation each require confirmation and are followed by a Source reread. |
| Source Policy | Detail shows available inputs, Permission reference, status, and each origin's path prefixes. Source ID and interval expand on demand. Permission reference identifies the permission the operator should verify. Revoking affects future eligibility. |
| Profile Editor | Groups identity, collection mode, CSS and XPath, Keyword Search, paging and request limits, types and extraction fields, CSV headers, and Article mapping. Sections share one Draft. Errors link to their inputs. |
| Draft and concurrent save | Shows unsaved changes, saved Draft, revision, and request state separately. PUT carries `expected_revision`. When two editors receive 200 and 409, the later editor can retain input, compare server data, and explicitly select the server version. An unconfirmed write rereads the server first. Existing blocker protects navigation and reload. |
| Preview and Validate | Use saved versions. Preview displays candidates. Validation shows actual counts, sample, and per-item errors. Preflight and reread check revision. Sample changes or Draft saves require fresh validation. |
| Approval | Review binds the same Source, Profile Version, hash, and passing report. The operator supplies a label, checks confirmation, and submits. FastAPI decides current report, revision, Source state, and approval. Vite loopback mode continues to restrict Profile and Binding operator actions. |
| Version history | Source list shows Draft, Approved, Retired, approval time, and label. Approved and Retired settings are read-only with expandable ID, hash, and report ID. Changes use a new Draft. |
| Category and Topic | Browse pages, create, and update name and active. Category selection scopes Topic reads and creation. Existing Topics show their parent. Disabling affects future collections. Historical Requests retain their links. |
| Source Bindings | Review actual bindings, eligibility, labels, and UTC times before selecting an authorised Web Source and compatible approved Keyword Search Profile. Add, disable, and restore require separate confirmation. Each write attempt rereads current server state. Unavailable reflects API eligibility and loaded directory data. Source and Profile details support investigation. |
| M12 handoff | An eligible Topic opens New Collection with existing `topic_id`. M12 rereads eligible bindings, and the operator selects, enters a keyword, reviews, and submits. Return among Source, Profile, Topics, and New Collection preserves meaningful URLs, pagination, and focus. |

## Verification results

| Check | Status | Actual evidence |
| --- | --- | --- |
| TypeScript and Vite production build | PASS | `npm.cmd run build`. Profile, Category and Topic, and Bindings split into route chunks. Rechecked fast Back. |
| Full mocked Playwright regression | PASS | Microsoft Edge 157.0.4341.60 passed all 134. Last two focused runs rechecked all three Source states, paths, same UUID, touch at 320 px, leaving during save, and rejected samples. |
| Live Source, Profile, and Core | PASS | 11 Edge integration cases. Covered 201, 200 after lost reply, focused 409 for different payload with same key, and policy rejection for a mismatched origin. Live cases checked two browser editors, stale reports, local Origin 403, revoked Source, CSS and XPath, Web and CSV approval, Core Jobs, M6 pagination, and M7 Detail captures. |
| Live full M14 workflow | PASS | One isolated end-to-end scenario confirmed Web authorisation, Draft, Preview, Validate, Profile approval, Category and Topic creation, approval of two bindings, disable and restore, and eligibility display and recheck in M12. Both Jobs in Request `9bf8ead2-d52e-4ed7-8b30-3e0592e1988a` succeeded with two Records total. Recollection `7ea97588-9614-4557-9ba8-726efb34738e` retained lineage. Controlled 404 produced Partial Request `3f768752-6bb9-4093-ae08-6339c9030661`. Revoking one Source made its binding Unavailable and the other stayed Eligible. |
| Normal | PASS | Two tests on freshly migrated PostgreSQL before fixture writes. Sources, Categories, Topics, and history began empty, and M14 and M12 showed setup. A new Source was pending until separately authorised. |
| M10 Synthetic Demo | PASS | Two read cases on the existing isolated Demo. Fixture Listings, Influencer Advertising and Sponsorship, and Market News and Economic Updates each had two persisted eligible bindings with Source, Profile hash, and approval traceability. Existing Request reads and JSON and CSV export passed. |
| M11–M13 | PASS | Mocks passed Shell keyboard and themes, M12 selection, deep links, eligibility recheck and replay, and M13 return, scope, and history for Record, Evidence, and Article. Live M14 and Core traversed M12, Records, Evidence, Article, and Request history. |
| Browser and accessibility | PASS | Two visual passes in Edge at 1440, 900, 768, 390, and 320 CSS px and native 200%. Checked Light, Dark, System, reduced motion, keyboard, simulated touch, visible and restored focus, and long-content reflow. axe WCAG A/AA found zero violations. |
| Physical screen reader and optional database restart branch | NOT RUN | Checked DOM roles, accessible names, and live errors. Isolated database tests covered live API and controlled failures. The optional M4E PostgreSQL stop branch was disabled. |

## Browser and UI Slop gates

- **Pass A** found Source registration below the fold, narrow usable space in Profile, and Binding review away from the ledger. Full regression also found quick Back could use stale M12 eligibility.
- **Fix Batch and Pass B** grouped origin, path, and interval, bounded Profile layout width, added section links, moved disable and restore review into the ledger, and scoped loading to operator routes. Reran main workflow and M12 return. Corrected native zoom captures and rechecked visually. Representative Operator cases had no unexpected page errors. Deliberately blocked sessionStorage and unmocked requests can produce documented dev proxy messages.
- **AI Fingerprint Gate PASS**, **Evidence Gate PASS**, and **Taste Gate PASS**. Source Policy, Profile checks, and Topic and Binding relationships define layout. State, configuration, review, and return each have appropriate semantics. Narrow rows retain labels and actions with Cobalt and Slate.

The index lists 24 screenshots. Pass B compares the actual controlled workflow. Mobile, simulated 503, and viewport mock captures are identified. Native 200% Edge used DPR 2 and 708 CSS px, and all three pages matched the viewport width. [Screenshot index and sources](docs/evaluation/M14-screenshots/README.md)

## Changed files

| Path | Change |
| --- | --- |
| `frontend/src/app/App.tsx` and `frontend/src/main.tsx` | Operator route-level loading and style entry. |
| `frontend/src/features/sources/{SourceList,SourceCreate,SourceDetail}.tsx`, `api.ts`, and `sources.css` | Ledger, policy form, two-stage authorisation, reread, and version list. |
| `frontend/src/features/profiles/{ConfigurationEditor,ProfilePage,ProfileChecks,ProfileResults}.tsx` and `profiles.css` | Draft sections, revision and conflict comparison, sample and approval, and read-only settings. |
| `frontend/src/features/topic-collections/{TopicCatalog,TopicBindings,support}.tsx` | Category relationships, server pagination, Binding review, and M12 deep link. |
| `frontend/src/features/operator/{operator.ts,operator.css,navigation.tsx}` and `frontend/src/lib/api.ts` | Shared trigger return, local operator checks, responsive rows, and shared POST exposing HTTP status. |
| `frontend/tests/{operator,profiles,sources,topic-collections}.spec.ts` | Actions, invalidation, conflicts, replay, responsive layout, and axe. |
| `frontend/tests/{closure,core-workflow,operator,sources,topic-collections}.integration.ts` | Isolated PostgreSQL and Core, M10 and Normal, persisted data, and browser evidence. |
| `docs/evaluation/M14-Operator-Workspace-Design-Decisions.md`, `docs/evaluation/M14-screenshots/`, and this handoff | Review baseline, design comparison, verification, and evidence. |

## Reproduction and limits

- Run `npm.cmd run build` and `npm.cmd test` in `frontend/`. This run used `PLAYWRIGHT_CHANNEL=msedge`. Set `M14_CAPTURE_OPERATOR=1` to save representative captures.
- Live tests used `collection-m14-operator-qa`, separate PostgreSQL, Redis, and Evidence volumes, and the Compose controlled fixture. The same M13 Core image `122f278b04b6` ran. Use `M4_REAL_API=1`, `LOCAL_PROFILE_APPROVAL=1`, and isolated `API_PROXY_TARGET` for `closure`, `core-workflow`, `profiles`, and `sources` integration and `topic-collections.integration.ts --grep "operator configures"`. Set `M9_TEST_PYTHON` for CSV verification as needed.
- Fresh Normal uses `M14_EMPTY_NORMAL=1` and M12 uses `M12_EMPTY_NORMAL=1`. Existing Demo reads set `M10_SYNTHETIC_URL` to the isolated frontend and run only the two designated persisted-config and Request tests. All samples are controlled fixtures.
- Category and Topic PUT and Source authorisation retain current contracts. Rereads can show intervening changes, while writes without revision tokens still use last-write behaviour. The Binding API has no per-item ineligibility reason.
- Approval labels are operator-supplied local audit metadata. The loopback console assumes a trusted local operator. CSV Source authorisation uses the trusted local API. Draft edits exist in the current page and in saved server versions.
- M15 would address Collection Jobs, execution events, Worker Monitoring, Retry, and Quarantine views. M16 would cover cross-milestone integration and presentation preparation.

**Acceptance A–I passed. Recommended GO for independent M14 review.**
