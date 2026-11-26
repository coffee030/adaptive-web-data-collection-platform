import re
from datetime import datetime, timedelta

from . import market_catalog
from .retrieval import SUBJECTS, query_topics


TRANSIT = {"transit", "mtr", "metro", "rail", "railway", "transport", "transitway"}
NATURE = {
    "nature",
    "outdoor",
    "birds",
    "plant",
    "plants",
    "botanical",
    "ecology",
    "flora",
    "fauna",
    "insects",
    "botany",
    "biodiversity",
    "wildlife",
}
SOCIAL = {"instagram", "youtube", "facebook", "tiktok"}
CHANNEL_NAMES = {
    "instagram": r"\b(?:instagram|ig)\b",
    "youtube": r"\byoutube\b",
    "facebook": r"\b(?:facebook|fb)\b",
    "tiktok": r"\btiktok\b|抖音",
}
SHORT_VIDEO = r"\b(?:shorts?|reels?|short[- ]form|short[- ]video)\b|短片|短視頻|短影音"


def evidence_intent(brief, focus):
    original = " ".join(
        (brief.campaign.description, brief.product, brief.discovery_focus or "")
    )
    low = original.casefold()
    named = {key for key, pattern in CHANNEL_NAMES.items() if re.search(pattern, low)}
    selected = {brief.campaign.platform, *brief.alternative_platforms}
    cap = brief.max_evidence_age_days
    if cap is None:
        number = re.search(
            r"(?:last|past|previous)\s+(\d{1,3})\s+(days?|weeks?|months?)\b", low
        )
        if number:
            factor = (
                30
                if number[2].startswith("month")
                else 7
                if number[2].startswith("week")
                else 1
            )
            cap = max(1, int(number[1]) * factor)
        elif re.search(r"\b(?:recent|current|latest|newly)\b|近期|最近|最新", low):
            cap = 90
    return {
        "topics": query_topics(original),
        "focus_words": set(market_catalog.pieces(focus)),
        "domain_words": set(market_catalog.pieces(original))
        | set(re.findall(r"[^\W_]+", low)),
        "channels": named
        or (
            set()
            if brief.discovery_scope == "all_sources"
            else {brief.campaign.platform, *brief.alternative_platforms}
        ),
        "channel_conflict": bool(
            named
            and named.isdisjoint(selected)
            and brief.discovery_scope == "campaign_channels"
        ),
        "days": cap,
        "needs_short": bool(re.search(SHORT_VIDEO, low))
        or brief.campaign.deliverable == "short_video",
        "needs_video": brief.campaign.deliverable
        in {"short_video", "dedicated_video", "video_integration"},
        "needs_review": bool(
            re.search(
                r"\breviews\b|\b(?:product|video|sunscreen|restaurant|skincare) review\b|\b(?:who review|review of)\b|評測|評價|食評",
                low,
            )
        ),
        "needs_cantonese": bool(
            re.search(r"\bcantonese\b|廣東話|粵語", low)
            or (brief.campaign.require_language and brief.campaign.language == "yue")
        ),
    }


def classify(record, intent, as_of, *, historical=False, identity=False):
    text = " ".join(
        str(part)
        for part in (
            record.get("title"),
            record.get("excerpt"),
            *record.get("topics", []),
        )
        if part
    )
    low = text.casefold()
    words = set(market_catalog.pieces(text[:200])) | set(re.findall(r"[^\W_]+", low))
    sought, found = intent["topics"], query_topics(text)
    if historical and record.get("basis") == "historical_cost":
        found = found | {"budget", "dining"}
    focus = intent["focus_words"]
    nature = (
        record.get("source_key") == "inaturalist"
        or record.get("platform") == "iNaturalist"
    )
    if (
        nature
        and sought
        & {
            "beauty",
            "sun_protection",
            "finance",
            "dining",
            "technology",
            "coffee",
            "vegetarian",
        }
        and not intent["domain_words"] & NATURE
    ):
        return None
    if (sought & set(SUBJECTS)) - found:
        return None
    reasons = []
    if sought:
        missing = sought - found
        if missing:
            if missing == {"budget"} and found & {"dining", "family", "outdoors"}:
                reasons.append("Affordability is unverified")
            else:
                return None
    elif focus:
        strict = focus & {"mtr", "birds", "insects", "plants", "railway"}
        if strict and not strict <= words:
            return None
        if not (
            focus & words
            or focus & TRANSIT
            and words & TRANSIT
            or focus & NATURE
            and words & NATURE
        ):
            return None
    if historical:
        reasons.append("Historical work")
    if identity:
        reasons.append("Directory identity only")
    platform = record.get("platform", "").casefold()
    channel = next((p for p in SOCIAL if p in platform), "other")
    if intent["channel_conflict"]:
        reasons.append("The brief and selected campaign channels differ")
    elif intent["channels"] and channel not in intent["channels"]:
        reasons.append("Outside the requested channel")
    if intent["days"] is not None:
        stamp = record.get("published_at")
        published = (
            datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).date()
            if stamp
            else None
        )
        if (
            published is None
            or published < (as_of - timedelta(days=intent["days"])).date()
        ):
            reasons.append("Outside the requested publication window")
    if intent["needs_short"] and not re.search(SHORT_VIDEO, low):
        reasons.append("Short-video format unverified")
    elif (
        intent["needs_video"]
        and "video" not in low
        and channel not in {"youtube", "tiktok"}
        and "peertube" not in platform
    ):
        reasons.append("Video format unverified")
    if intent["needs_review"] and not re.search(r"\breviews?\b|評測|評價|食評", low):
        reasons.append("Review format unverified")
    if (
        intent["needs_cantonese"]
        and "yue" not in record.get("languages", [])
        and not re.search(r"\bcantonese\b|廣東話|粵語", low)
    ):
        reasons.append("Cantonese unverified")
    return {"tier": "context" if reasons else "direct", "scope_notes": reasons}
