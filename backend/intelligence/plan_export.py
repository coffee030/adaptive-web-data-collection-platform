from backend.marketing.store import MarketingError

from .catalog import Catalog
from .contracts import Campaign
from .recommend import recommend
from .store import IntelligenceStore, Scope


def allocation_rows(
    store: IntelligenceStore, company_id: str, evaluation: dict, receipt: str
):
    scope = Scope("partner", company_id)
    snapshot = store.snapshot(scope)
    result = recommend(
        Catalog(snapshot),
        Campaign.model_validate(evaluation),
        "partner",
        store.config.model_dir,
    )
    if not result.allocation_export_receipt:
        raise MarketingError(
            403, "plan_export_restricted", "Export the brief without creator data"
        )
    if result.allocation_export_receipt != receipt:
        raise MarketingError(409, "catalog_changed", "Review the latest allocation")
    rows = [
        ("Allocation", result.plan.status),
        ("Evidence checked at", result.as_of.isoformat()),
        (
            "Confirmed creator spend (HKD)",
            "Unavailable"
            if result.plan.total_minor is None
            else result.plan.total_minor / 100,
        ),
    ]
    for candidate in result.recommendations:
        if candidate.creator_id not in result.plan.selected:
            continue
        quote = candidate.quote
        rows.extend(
            [
                ("Selected creator", candidate.name),
                ("Profile source", candidate.profile_evidence.reference),
                ("Profile attribution", candidate.profile_evidence.attribution),
                ("Quoted fee (HKD)", quote.data.amount_minor / 100),
                ("Quote valid until", quote.data.valid_until.isoformat()),
                ("Quote source", quote.evidence.reference),
                ("Quote attribution", quote.evidence.attribution),
            ]
        )
        for post in candidate.evidence:
            rows.append(("Supporting post source", post.content.evidence.reference))
            rows.append(("Content attribution", post.content.evidence.attribution))
    store.assert_current(scope, snapshot.revision)
    return rows
