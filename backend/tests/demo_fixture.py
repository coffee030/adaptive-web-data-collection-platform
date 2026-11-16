"""Deterministic content for the isolated M10 Synthetic Demo."""

from html import escape
from urllib.parse import parse_qs, urlencode, urlsplit

SYNTHETIC = "SYNTHETIC FIXTURE DATA"
SIMULATED = "SIMULATED DATA — NOT LIVE MARKET PRICES"
PAGE_SIZE = 2

MARKETING_FIELDS = ("headline", "creator", "brand", "platform", "disclosure", "summary")
MARKET_FIELDS = (
    "headline",
    "instrument",
    "market",
    "price",
    "price_change",
    "currency",
    "summary",
)

# Each tuple represents one editorial item. Names and market instruments are fictional.
MARKETING = {
    "creator-brief": (
        (
            "Orla Fen previews a foldable field light",
            "Orla Fen",
            "Juniper Quay",
            "ClipHarbor",
            "Paid partnership",
            "The creator discloses payment before demonstrating three lighting modes.",
        ),
        (
            "Neri Voss reviews a compact studio microphone",
            "Neri Voss",
            "Quiet Loom",
            "ClipHarbor",
            "Product supplied by brand",
            "The review specifies that the microphone was supplied and that the brand did not see the final cut.",
        ),
        (
            "Tamsin Vale publishes a sponsored trail kit guide",
            "Tamsin Vale",
            "Bracken Arc",
            "ViewNest",
            "Sponsored guide",
            "The disclosure appears before links to the trail kit and its accessories.",
        ),
        (
            "Idris Merrin posts a commuter bag comparison",
            "Idris Merrin",
            "Cinder Finch",
            "ViewNest",
            "Affiliate commission disclosed",
            "The comparison identifies the affiliate links that earn a commission.",
        ),
    ),
    "disclosure-desk": (
        (
            "Quiet Loom announces a short-form audio series",
            "Alba Rook",
            "Quiet Loom",
            "LoopFrame",
            "Paid series",
            "The joint announcement names the sponsor and explains the creator's editorial terms.",
        ),
        (
            "Mira Pell explains how gifted samples are disclosed",
            "Mira Pell",
            "Meadow Relay",
            "LoopFrame",
            "Gifted sample",
            "The guide includes a sample disclosure at the start of a fictional review.",
        ),
        (
            "Bracken Arc labels sponsored packing tips",
            "Perrin Lark",
            "Bracken Arc",
            "ViewNest",
            "Sponsored post",
            "The sponsor disclosure appears before the packing checklist.",
        ),
        (
            "Elin Firth shares an affiliate link policy",
            "Elin Firth",
            "Tern & Vale",
            "ClipHarbor",
            "Affiliate commission disclosed",
            "The policy explains which links generate commissions and where disclosures appear.",
        ),
    ),
}

MARKETS = {
    "market-wire": (
        (
            "Aster Grid rises after a revised earnings outlook",
            "ASTER.X",
            "Lumen Exchange",
            42.50,
            1.25,
            "USD",
            "The fictional utility increased its simulated operating margin forecast.",
        ),
        (
            "Cedar Transit retreats as operating costs climb",
            "CEDAR.X",
            "Lumen Exchange",
            18.75,
            -0.60,
            "USD",
            "A simulated fuel cost increase weighed on the transport operator.",
        ),
        (
            "Flint Storage holds steady after quarterly results",
            "FLINT.X",
            "Lumen Exchange",
            31.20,
            0.00,
            "USD",
            "The simulated company met its previously published revenue range.",
        ),
        (
            "Northcoil Systems rebounds after supply update",
            "COIL.X",
            "Lumen Exchange",
            27.45,
            0.35,
            "USD",
            "The fictional manufacturer reported improved component availability.",
        ),
    ),
    "economic-ledger": (
        (
            "Harbor 50 advances as rate expectations ease",
            "HARBOR50.X",
            "Meridian Exchange",
            813.40,
            4.10,
            "USD",
            "A simulated policy announcement lowered near-term borrowing expectations.",
        ),
        (
            "Meadow 30 slips after a softer demand survey",
            "MEADOW30.X",
            "Meridian Exchange",
            465.15,
            -2.70,
            "USD",
            "The fictional survey showed weaker orders across three sectors.",
        ),
        (
            "Meridian bond benchmark steadies after auction",
            "MBOND.X",
            "Meridian Exchange",
            101.05,
            0.15,
            "USD",
            "Simulated auction participation was close to its recent average.",
        ),
        (
            "Foundry 20 gains despite wider intraday moves",
            "FOUNDRY20.X",
            "Meridian Exchange",
            310.65,
            1.80,
            "USD",
            "A simulated manufacturing report contributed to early volatility.",
        ),
    ),
}


def demo_page(url: str, revision: int) -> tuple[int, bytes]:
    parts = urlsplit(url)
    _, _, layout, *route = parts.path.split("/")
    financial = layout in MARKETS
    entries = (MARKETS if financial else MARKETING).get(layout, ())
    fields = MARKET_FIELDS if financial else MARKETING_FIELDS
    label = SIMULATED if financial else SYNTHETIC
    xpath = layout in {"disclosure-desk", "economic-ledger"}
    prefix = f"/demo/{layout}"

    if route == ["search"]:
        params = parse_qs(parts.query)
        key = "term" if xpath else "q"
        keyword = params.get(key, [""])[0].casefold().strip()
        page = params.get("page", ["1"])[0]
        if page not in {"1", "2"}:
            return 404, b"Unknown page"
        tags = "market economic" if financial else "partnership sponsorship"
        matches = [
            (index, entry)
            for index, entry in enumerate(entries, 1)
            if keyword and keyword in " ".join([tags, *map(str, entry)]).casefold()
        ]
        start = (int(page) - 1) * PAGE_SIZE
        links = [
            f'<a href="{prefix}/detail/{index}">{escape(entry[0])}</a>'
            for index, entry in matches[start : start + PAGE_SIZE]
        ]
        if xpath:
            items = "".join(f"<tr><td>{link}</td></tr>" for link in links)
            markup = f"<table><tbody>{items}</tbody></table>"
        else:
            items = "".join(f'<li class="result">{link}</li>' for link in links)
            markup = f"<ul>{items}</ul>"
        if start + PAGE_SIZE < len(matches):
            url = "?" + urlencode({key: keyword, "page": "2"})
            markup += f'<footer><a class="next" href="{escape(url)}">Next</a></footer>'
        return 200, f"<h1>{label}</h1>{markup}".encode()

    if (
        len(route) == 2
        and route[0] == "detail"
        and route[1] in {"1", "2", "3", "4"}
        and entries
    ):
        index = int(route[1])
        data = dict(zip(fields, entries[index - 1], strict=True))
        if financial and revision == 2 and index == 1:
            data["price"] = f"{data['price'] + 0.5:.2f}"
            data["price_change"] = f"{data['price_change'] + 0.5:.2f}"
            data["summary"] += (
                " The second fixture revision includes an updated settlement."
            )
        data["published_at"] = f"2026-11-{8 + index:02d}T09:00:00Z"
        data["dataset"] = label
        if xpath:
            details = "".join(
                f'<dt>{name}</dt><dd data-field="{name}">{escape(str(value))}</dd>'
                for name, value in data.items()
            )
            article = f'<main><dl>{details}</dl><a class="permalink" href="{parts.path}">Source</a></main>'
        else:
            details = "".join(
                f'<p class="{name}">{escape(str(value))}</p>'
                for name, value in data.items()
            )
            article = f'<article>{details}<a class="permalink" href="{parts.path}">Source</a></article>'
        return 200, article.encode()
    return 404, b"Unknown fixture"
