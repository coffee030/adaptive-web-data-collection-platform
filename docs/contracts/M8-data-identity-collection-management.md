# M8 data identity and collection management

## Console workflow

1. In **Sources**, register and authorise the website, then validate and approve a Keyword Search Profile. To keep Article History, enable **Store article history** in the Profile's **Article mapping**, map its fields to declared outputs, and use the existing Profile review workflow.
2. In **Sources → Categories and topics**, create a Category and Topic. Open **Manage approved bindings** from the Topic. Select an authorised Source and approved Keyword Search Profile Version, enter an operator label, and choose **Approve binding**.
3. In **New Collection → Collect by topic**, select a Category and then its Topic. Lists load a page at a time and **Load more** continues. Enter 1–128 printable characters and choose up to four eligible bindings. Each starts one existing Collection Job. Single-source HTML and CSV remain under **New Collection** at this milestone.
4. In Request Detail, inspect child Jobs, individual failure reasons, and Articles observed in this run. **Refresh collection** adds a run linked to the original Request. **Data Explorer → Browse articles** opens latest content, historical versions, original extracted values, and Evidence.

The local console uses the existing Vite loopback mode with `LOCAL_PROFILE_APPROVAL=1` for binding changes. The API uses the existing loopback Host and Origin boundary and verifies Source authorisation, Profile and binding status, and input paths. Operator labels are audit data in the trusted local deployment.

## API

All paths are prefixed by `/api/v1`. Paginated lists accept `limit` with default 50 and maximum 100, and `offset`.

| Path | Operation and input |
| --- | --- |
| `/categories`, `/categories/{id}` | GET list or detail, with `active_only` on the list. POST creates and PUT edits `name` and `active`. |
| `/topics`, `/topics/{id}` | Same operations. Create with `category_id` and filter the list by `active_only` or `category_id`. |
| `/topics/{id}/bindings` | GET list with `eligible_only=true` to limit it to eligible bindings. POST `source_id`, `profile_version_id`, and `approved_by` to explicitly approve that version. |
| `/topics/{id}/bindings/{binding_id}/disable` | POST disables the binding. |
| `/topics/{id}/bindings/{binding_id}/approve` | POST with `approved_by` reapproves a disabled binding. |
| `/collection-requests` | GET recent runs. POST `topic_id`, `keyword`, `binding_ids`, and UUID `request_key` to submit. |
| `/collection-requests/{id}` | GET run details, child Jobs, bindings, and approval snapshot. |
| `/collection-requests/{id}/refresh` | POST UUID `request_key` to create a run linked to the earlier one by `refresh_of`. |
| `/articles`, `/articles/{id}` | GET latest Article list or detail. The list filters by `request_id` for Articles observed in that run. Content shows each Article's latest observation across runs. |
| `/articles/{id}/versions`, `/articles/{id}/versions/{version_id}` | GET version history directory or shared fields for one version. |
| `/articles/{id}/observations`, `/articles/{id}/observations/{record_id}` | GET observation directory or an observation's lineage and `raw_payload`. |

The first successful Request or Refresh returns HTTP 201. Replay of the same UUID and content returns 200. Reusing the UUID for a different intent returns 409. Binding order can change. A disabled Category, Topic, or existing binding must regain eligibility before running. Revoked Source returns 403 and retired Profile returns 409. Ineligibility rolls back the whole submission. Existing Jobs follow M7 execution and revocation rules.

A new Request saves Topic ID, its name at submission, and a fixed keyword. Each child Job saves Source, Profile Version, and config hash. Its association saves binding ID, approval label, and time. Refresh reuses the execution and approval snapshot and rechecks current eligibility. Original Requests remain readable after renaming a Topic or changing a binding. The parent is `pending` before any Job starts and `running` once started while Jobs remain nonterminal, including retry wait. Once all Jobs finish, all success gives `succeeded`, all failure gives `failed`, and the remaining outcomes give `partial`.

## Article mapping, identity, and versions

`configuration.article` applies to an approved Keyword Search Profile. `title` must map to required text. Optional `canonical_url`, `author`, `published_at`, `summary`, and `body` map to text. `stable_id` can map to text or integer. Omitting article config preserves the M7 Profile hash and Generic Record behaviour.

- URL identity uses the approved mapped canonical URL or actual detail URL when the canonical field is omitted. It follows Source origin and path rules, normalises percent encoding, removes fragments, and keeps query content and order. URL identity applies to detail pages with one candidate. Conflicting canonical URLs within a Job skip Article projection.
- Multiple items per page can use an explicit stable key. It takes priority and comes from the Source. It must be unique across the Source. A missing value skips Article projection for this run. Source ID, identity kind (URL or stable key), and value form the identity. Different Sources have distinct Articles. Changing identity strategy may create a new Article while retaining earlier history.
- Observations require successful Detail Evidence and a validated Generic Record. They include Source, Profile and hash, Job, Record, Evidence, collection time, and version link. `raw_payload` contains fields after adapter extraction and before Generic Record type conversion, capped at 1 MiB UTF-8 JSON. The Evidence store retains HTML. Generic Records without an eligible Article projection still publish.
- Content hash covers title, author, published_at, summary, and body. Text uses NFC and collapsed whitespace. Timezone-aware ISO timestamps convert to UTC. Missing optional fields are null, and an unparseable published time skips Article projection. Job, Evidence, collection time, URL, and unmapped fields are excluded. Observing identical content reuses its version, including a return to earlier content.
- Article, Content Version, and Observation publish with the locked terminal Job transaction. SQL uniqueness and per-Article locks handle concurrency. Each Generic Record can have one Observation. Latest uses the newest Evidence capture time, with Record UUID as tie-breaker. Versions are numbered in order of new content commits. Earlier observations remain available after empty results or fetch failure.

## Database

Alembic `0009` adds eight tables on top of `0008`. Existing Source, Profile, Job, Record, Evidence, and Quarantine data need no conversion. DB uniqueness covers case-insensitive Category names, Topic names within Category, bindings, Request keys, Article identity, and Content Version hash. Observation uses a Record FK to trace Evidence and a composite FK to pin Article and Content Version. Back up PostgreSQL and the Evidence volume if production must retain M8 history before a downgrade that removes its tables.
