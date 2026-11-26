# Marketing M2 campaign intelligence

The Adaptive Scalable and Observable Web Data Collection Platform supplies the local runtime. Campaign intelligence uses a separate downstream schema and the existing PostgreSQL, Redis, dispatcher, and Celery worker. This is a local pilot backend and a synthetic demo. The M1 research endpoints retain their existing permission behavior. PR #15 is the base for this milestone while its teammate review is pending.

## Data and rights

The import contract follows the commercial readiness package's stable creator references, dataset receipts, dated quotes, aggregate survey basis, and purpose-specific rights. Operators submit JSON with `grant` and `records` to one workspace. A partner dataset must have a written independent grant for internal pilot analytics and customer-facing commercial display. Its declared origin controls the allowed record type and the owner must match the creator reference. The demo workspace accepts only synthetic records with `academic_demo`. Each workstream has separate identifiers, reads, embeddings, and retention.

| Import record | Evidence and behavior |
| --- | --- |
| `profile` | Creator ID, display name, optional bio, and one or more stable platform accounts. |
| `content` | Stable post ID for the platform, creator account ID, publication time, creator-authored text, explicit languages, and separately reviewed content facts. |
| `performance` | Independently authorized, distinct per-post observation from the seven days starting at publication. Views, likes, and comments are nullable counts. |
| `quote` | Platform, deliverable, currency, fee in minor units, firm or indicative status, issue and end timestamps, and terms. |
| `audience` | Independently run opt-in survey, country or market bucket, period, denominator, and share on a 0–1 scale. Only aggregate observations from 30 or more respondents provide a usable share. |

Each row contains `id`, `creator_id`, `evidence_ref`, and `observed_at`. The grant contains `origin`, `owner_ref`, `authorization_ref`, `attribution`, `expires_at`, and explicit uses. Imports are authorized attestations. Restrict the operator token to staff who can verify the source and written grant. The service rejects M1 research payloads and any `youtube_data_api` origin. A platform name such as `youtube` can appear in independently authored partner records. It never authorizes use of API-derived data.

An identical import is idempotent. Replacing a dataset invalidates its active lease and reuses unchanged normalized text representations. A missing eligible profile or platform account keeps related content and observations outside the customer projection. Expiration immediately removes the dataset from reads. Withdrawal deletes payloads, lexical terms, and vectors, retaining the local dataset identifier to prevent accidental reimport. The dispatcher clears expired payloads on minute-based maintenance. Configure equivalent deletion for backups before an operational pilot.

## Automatic partner refresh

For an authorized partner delivering recurring JSON snapshots, first import the original dataset and verify its written grant in Data Operations. A private pilot may mount the delivery directory on the dispatcher using `compose.marketing-refresh.yaml` and `MARKETING_PARTNER_REFRESH_HOST_DIR`. The directory must be readable by the container user. Limit write access to the operator and the approved delivery process.

The dispatcher checks once per minute while running and resumes after restart. Publish a regular file atomically at `<directory>/<workspace>/<dataset_id>.json`. The following PowerShell example prepares a delivery from an approved import file. Replace the example timestamp with the precise `imported_at` for this dataset, available under **Refresh version** in Data Operations.

```powershell
$updatedDataset = Get-Content -Raw -Encoding UTF8 -LiteralPath 'updated-partner-data.json' | ConvertFrom-Json
$delivery = @{
    expected_imported_at = '2026-11-26T08:20:00.123456Z'
    dataset = $updatedDataset
}
$json = $delivery | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText('delivery.tmp', $json, [Text.UTF8Encoding]::new($false))
```

Place the temporary file in the target directory before renaming it to the dataset filename. When updating an existing delivery, use the producer's atomic file-replacement operation on the same volume.

Each accepted update replaces that dataset under its existing grant. Use the new receipt for the next changed snapshot. The service ignores an identical replay and rejects a stale receipt or changed grant while retaining the last accepted dataset. An operator reviews changes to permitted uses or expiry through the normal import. Only active previously onboarded dataset IDs in this partner workspace are read. Withdrawal stops refresh and indexing and clears the stored dataset. The read-only delivery directory remains under the operator’s retention and deletion policy. Inspect the dataset in Data Operations for a rejected delivery reason and the precise refresh version. A successful update clears the error. Files are limited to 1 MiB each.

## Frontend routes

Discover supported workspaces with `GET /api/v1/marketing/capabilities`. The `permission_status` field describes YouTube. The `customer_intelligence` and `demo_intelligence` fields describe the independent workspaces. The M1 research intake remains separate.

The routes below use `/api/v1/marketing/intelligence/{mode}`. Demo reads require deployment opt-in. Company reads use the current member’s expiring HttpOnly session. Company membership determines the scope on each request. The legacy Basic or bearer credential reads only the configured earlier shared pilot until an operator claims it for a company. Core operations require the operator credential on the pilot. Health and capabilities remain public on loopback.

| Method and path | Contract |
| --- | --- |
| `GET /creators` | Discover profiles with optional `query`, `platform`, `language`, and `market` filters. Returns `available` or `empty`, the retrieval method, and the strongest scoped preview with its match basis. |
| `GET /brief-options` | Platform coverage counts eligible profiles, historical posts, posts with seven-day views and current firm HKD quotes. Supply a platform to list reviewed facts and quoted deliverables. |
| `GET /creators/{creator_id}` | Profile, up to 20 recent content items, seven-day history by platform, current firm quotes, and eligible survey evidence. A single-platform profile also includes its history in `historical`. Unavailable creators return `404 creator_unavailable`. |
| `POST /creators/compare` | Submit up to 12 `creator_ids`. Returns profiles in request order and `unavailable_ids` for missing or ineligible entries. |
| `POST /campaign-briefs` | Submit a natural-language description plus objective, budget, currency, platform, deliverable, optional market and language constraints, and reviewed fact requirements. Returns ranked candidates, cited posts, factor weights, limitations, current pricing, and a budget plan in one response. |
| `POST /scenarios` | Calculate clicks, conversions, attributed revenue, ROAS, and ROI from supplied assumptions. |
| `GET /processing` | Poll for `empty`, `preparing`, `ready`, or `fallback`. Lexical results remain usable while embeddings are preparing. |

The frontend owns the editable shortlist and category labels. Pass creator IDs as `shortlist` to restrict a new brief or budget recalculation. Pass edited labels as `category_labels`. Suggested labels are advisory. A plan is `optimal`, `infeasible`, or `search_limit`. Show ineligible candidates as alternatives with their blockers and keep them out of the allocation. Return `409 catalog_changed` to the frontend as a transient retry state. Disabled or unauthorized workspaces return `403 workspace_restricted`. Validation failures use the Core's `422 invalid_request` envelope.

A representative campaign request follows.

```json
{
  "description": "Find creators who cover affordable family dining.",
  "objective": "awareness",
  "platform": "youtube",
  "deliverable": "video_integration",
  "budget_minor": 400000,
  "currency": "HKD",
  "market": "HK",
  "minimum_market_share": "0.50",
  "language": "yue",
  "require_language": true,
  "required_facts": ["stroller_access"],
  "minimum_creators": 1,
  "maximum_creators": 3
}
```

Amounts are integer minor units. Decimal measures and rates serialize as strings. An infeasible result has `state: "incomplete"`, an empty `plan.selected` list, and `plan.total_minor: null`. A missing rate looks like `{"status":"unavailable","value":null,"observations":0}`. Use the OpenAPI schema for complete response types.

## Ranking and calculations

Granite and lexical retrieval score distinct normalized posts. Search uses the creator name, description or a scoped historical post. Reviewed content facts and a bilingual topic vocabulary can support a related match. For a query outside that vocabulary, embedding-only matches must exceed both an absolute similarity floor and the catalog median by a margin. A query can return zero candidates. Suggested categories come from concepts present in the campaign description. A creator's weighted top-three evidence supports a relevance component. Ranking also uses comparable performance, consistency, quoted fee, independent market evidence, explicit content languages, and reviewed preferences when present. Weights are returned per result. Similarity and utility are relative ranking signals. A required market share, language, fact, relevant post, and eligible firm quote must pass before optimization. Mixed-language content must explicitly include the required language tag. A real zero quote can enter the plan. Prices are never inferred.

History uses the latest permitted observation per post at the same seven-day window. Interaction rate is total likes plus comments divided by total views over the same rows, requiring positive views and both interaction counts. Consistency uses median absolute deviation over at least five observations with a positive median. Quoted fee per thousand historical views or per historical interaction compares the current fee to an observed median and has no future performance label. Survey shares describe the surveyed respondents. Scenarios label their basis `assumption_based`. Unspecified inputs propagate as unavailable, and ROAS is attributed revenue divided by explicitly supplied positive advertising spend. Contribution-based ROI requires an explicit contribution margin and positive total campaign cost. It subtracts total campaign cost from attributed revenue multiplied by margin, then divides by total campaign cost. The deprecated input `spend_minor` remains a compatibility alias for campaign cost. It supplies neither ad spend nor margin. Attributed revenue alone cannot establish contribution or incremental return. Trained forecasting and campaign outcome ingestion remain deferred.

## Local setup and verification

Apply all migrations with `alembic upgrade head`. Enable `MARKETING_DEMO_ENABLED=1` for the demo. To serve authorized partner data, configure a private `MARKETING_PARTNER_WORKSPACE` and a `MARKETING_CUSTOMER_TOKEN` of at least 24 characters. Use a separate `MARKETING_OPERATOR_TOKEN` for `PUT`, `GET`, and `DELETE` on `/api/v1/marketing/intelligence/operator/{mode}/datasets/{dataset_id}`. The demo seed command produces the existing fictional research fixture as an operator import. The demo is independent of the Core's regular launcher data.

```text
python -m backend.experiments.marketing_m2.demo_dataset
python -m backend.intelligence.fetch_model .local/marketing-granite
```

Granite Embedding 97M Multilingual R2 uses IBM's Apache-2.0 ONNX INT8 CPU artifact at revision `835ad14087e140460703cf0fae09f97d469d65c2`. The download command checks the pinned sizes and SHA-256 digests before publishing the graph and tokenizer. Inference is local and requires no network. In a native deployment install `backend/requirements-marketing-onnx.txt` and set `MARKETING_MODEL_DIR` for the API, worker and dispatcher. For Compose set `MARKETING_ONNX=1` and `MARKETING_MODEL_HOST_DIR`, then include `compose.marketing-onnx.yaml` alongside `compose.yaml`. The model mount is read-only. The regular deployment uses character TF-IDF with no extra dependencies. [Pinned IBM model and license](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2/tree/835ad14087e140460703cf0fae09f97d469d65c2)

The lexical index is prepared during import. The dispatcher advances pending embeddings with durable lease claims, one active indexing job, bounded batches, and retry backoff. API and worker each load the graph on demand and reuse it within their process. The pilot bounds each dataset to 128 records and each workspace to 64 active datasets and 800 records. The engine uses the fictional multilingual fixture for engineering verification. Recommendation quality on partner data and physical acceptance on an 8 GB machine remain unverified.

## Company accounts and campaign records

Start the private pilot on loopback. Choose Operator setup on the Company pilot screen, unlock Data Operations with the workstation credential and create the company and its first administrator. Each account belongs to one company. Administrators can create and remove members in that company. Removing membership deletes its sessions. Passwords use salted PBKDF2-HMAC-SHA256 with 600,000 iterations. Random session identifiers are stored as SHA-256 digests and expire after twelve hours. Core and dataset operations retain separate operator permissions.

Under `/api/v1/marketing/companies`, operators use `GET/POST /registry`, account holders use `POST/GET/DELETE /session`, and administrators use `GET/POST /members` and `DELETE /members/{username}`. Company campaigns use `GET /campaigns`, `PUT /campaigns/{id}` with the previously read version (zero for a new campaign), and `GET /campaigns/{id}/export?version=…`. A stale write or stale export returns 409. CSV contains customer-authored campaign data and assumptions. Catalog evidence is fetched again under the current grant. A source owner may expressly authorize a company to export a derived plan, creator names, confirmed fees, attribution and evidence references. The operator records this in each applicable dataset grant as `company_plan_export: true`. Existing grants default to workspace display. If the evaluated sources allow it, the result supplies an allocation receipt. Passing it as `allocation` with the saved revision exports the plan after recalculation and a current rights check. An obsolete receipt requires a fresh review. Company exports omit raw post text and individual audience records.

Select the destination company in Data Operations for private intake. Its identifier is also the inbox subdirectory under `.local-pilot/partner-refresh` for versioned deliveries. Operators create the private subdirectory before arranging delivery. To assign the earlier pilot to one company and disable its shared credentials, select **Assign the earlier shared pilot to this company** when creating that company. Verify the existing grant covers these participants. Existing browser drafts are never automatically copied into a company.
