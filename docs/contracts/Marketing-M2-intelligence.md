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

## Frontend routes

Discover supported workspaces with `GET /api/v1/marketing/capabilities`. The `permission_status` field describes YouTube. The `customer_intelligence` and `demo_intelligence` fields describe the independent workspaces. The M1 research intake remains separate.

The routes below use `/api/v1/marketing/intelligence/{mode}`, where mode is `demo` or `partner`. The demo requires a deployment opt-in. Partner reads require the deployment's customer token over the existing loopback boundary. The customer token cannot import or withdraw data. Keep it in the application's trusted host or server layer.

| Method and path | Contract |
| --- | --- |
| `GET /creators` | Discover profiles with optional `query`, `platform`, `language`, and `market` filters. Returns `available` or `empty`. |
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

Granite and lexical retrieval score distinct normalized posts. A creator's weighted top-three evidence supports a relevance component. Ranking also uses comparable performance, consistency, quoted fee, independent market evidence, explicit content languages, and reviewed preferences when present. Weights are returned per result. Similarity and utility are relative ranking signals. A required market share, language, fact, relevant post, and eligible firm quote must pass before optimization. Mixed-language content must explicitly include the required language tag. A real zero quote can enter the plan. Prices are never inferred.

History uses the latest permitted observation per post at the same seven-day window. Interaction rate is total likes plus comments divided by total views over the same rows, requiring positive views and both interaction counts. Consistency uses median absolute deviation over at least five observations with a positive median. Quoted fee per thousand historical views or per historical interaction compares the current fee to an observed median and has no future performance label. Survey shares describe the surveyed respondents. Scenarios label their basis `assumption_based`. Unspecified inputs propagate as unavailable, and ROAS and ROI require positive spend. ROI uses attributed revenue less campaign spend divided by that spend. Trained forecasting and campaign outcome ingestion remain deferred.

## Local setup and verification

Apply migration `0012`. Enable `MARKETING_DEMO_ENABLED=1` for the demo. To serve authorized partner data, configure a private `MARKETING_PARTNER_WORKSPACE` and a `MARKETING_CUSTOMER_TOKEN` of at least 24 characters. Use a separate `MARKETING_OPERATOR_TOKEN` for `PUT`, `GET`, and `DELETE` on `/api/v1/marketing/intelligence/operator/{mode}/datasets/{dataset_id}`. The demo seed command produces the existing fictional research fixture as an operator import. The demo is independent of the Core's regular launcher data.

```text
python -m backend.experiments.marketing_m2.demo_dataset
python -m backend.intelligence.fetch_model .local/marketing-granite
```

Granite Embedding 97M Multilingual R2 uses IBM's Apache-2.0 ONNX INT8 CPU artifact at revision `835ad14087e140460703cf0fae09f97d469d65c2`. The download command checks the pinned sizes and SHA-256 digests before publishing the graph and tokenizer. Inference is local and requires no network. In a native deployment install `backend/requirements-marketing-onnx.txt` and set `MARKETING_MODEL_DIR` for the API, worker and dispatcher. For Compose set `MARKETING_ONNX=1` and `MARKETING_MODEL_HOST_DIR`, then include `compose.marketing-onnx.yaml` alongside `compose.yaml`. The model mount is read-only. The regular deployment uses character TF-IDF with no extra dependencies. [Pinned IBM model and license](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2/tree/835ad14087e140460703cf0fae09f97d469d65c2)

The lexical index is prepared during import. The dispatcher advances pending embeddings with durable lease claims, one active indexing job, bounded batches, and retry backoff. API and worker each load the graph on demand and reuse it within their process. The pilot bounds each dataset to 128 records and each workspace to 64 active datasets and 800 records. The engine uses the fictional multilingual fixture for engineering verification. Recommendation quality on partner data and physical acceptance on an 8 GB machine remain unverified.
