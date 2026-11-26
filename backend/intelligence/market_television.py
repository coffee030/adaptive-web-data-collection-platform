"""Discover dated Hong Kong food programmes and separately verify each presenting credit."""

import re
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from .market_sources import CC, HK, PublisherError, owned_url, publication, text

API = "https://api.tvmaze.com"
LICENSE = CC + "licenses/by-sa/4.0/"
PRICE_WORDS = re.compile(
    r"\b(?:affordable|budget[- ]friendly|low[- ]cost|cheap eats|inexpensive)\b|平價|平价",
    re.I,
)
FOOD_TOPICS = {
    "street food": "Street food",
    "street eats": "Street food",
    "cha chaan teng": "Cha chaan teng",
    "claypot": "Claypot rice",
    "wonton": "Noodles",
    "noodle": "Noodles",
    "dumpling": "Dumplings",
    "congee": "Congee",
    "seafood": "Seafood",
    "cantonese": "Cantonese cooking",
}


def food_programmes(reader, now, since=None, sample=False):
    shows = {}
    for query in ("Hong Kong", "Hong Kong Kitchen", "Hong Kong Gourmet"):
        hits, _ = reader.json(API + "/search/shows", {"q": query})
        if not isinstance(hits, list) or len(hits) > 25:
            raise PublisherError("publisher_schema_changed")
        for hit in hits:
            show = hit.get("show") or {}
            if (
                type(show.get("id")) is int
                and HK.search(show.get("name", ""))
                and "Food" in (show.get("genres") or [])
                and show.get("type")
                in {"Documentary", "Reality", "Variety", "Talk Show", "Magazine"}
            ):
                shows[show["id"]] = show
        if sample and shows:
            break
    if len(shows) > 12:
        raise PublisherError("publisher_scope_exceeds_limit")
    for show in shows.values():
        base = API + "/shows/" + str(show["id"])
        cast, _ = reader.json(base + "/cast", {})
        episodes, _ = reader.json(base + "/episodes", {"specials": 0})
        if (
            not isinstance(cast, list)
            or not isinstance(episodes, list)
            or len(episodes) > 250
        ):
            raise PublisherError("publisher_schema_changed")
        summary = text(show.get("summary"), 440)
        series = show["name"]
        for credit in cast:
            person, character = (
                credit.get("person") or {},
                credit.get("character") or {},
            )
            name = text(person.get("name"), 110)
            profile = owned_url(person.get("url"), "www.tvmaze.com", "/people/")
            role = text(character.get("name")).casefold()
            if (
                not profile
                or not name
                or type(person.get("id")) is not int
                or (
                    role not in {"presenter", "host", "co-host", "co-presenter"}
                    and not (
                        role == name.casefold()
                        and name.casefold() in (series + " " + summary).casefold()
                    )
                )
            ):
                continue
            for episode in episodes:
                date = episode.get("airdate")
                if not date or not (
                    now.date() - timedelta(days=365 * 3)
                    <= datetime.fromisoformat(date).date()
                    <= now.date()
                ):
                    continue
                eid = episode.get("id")
                if type(eid) is not int:
                    continue
                url = owned_url(episode.get("url"), "www.tvmaze.com", "/episodes/")
                credit_url = owned_url(show.get("url"), "www.tvmaze.com", "/shows/")
                if not url or not credit_url:
                    continue
                desc = text(episode.get("summary"), 440)
                source_copy = desc or summary
                topics = ["Food", "Dining", "Television"] + [
                    v for k, v in FOOD_TOPICS.items() if k in source_copy.casefold()
                ]
                if PRICE_WORDS.search(desc):
                    topics.append("Described as affordable")
                title = (
                    series
                    + " · "
                    + (
                        text(episode.get("name"))
                        or "Episode " + str(episode.get("number") or "")
                    )
                )
                row = publication(
                    "tvm",
                    f"{eid}-{person['id']}",
                    name,
                    profile,
                    title,
                    episode.get("airstamp") or date,
                    url,
                    topics,
                    LICENSE,
                    [],
                    excerpt=source_copy,
                )
                if row:
                    official = show.get("officialSite") or ""
                    row.update(
                        credit_role="Series presenter",
                        series_title=series,
                        credit_url=credit_url + "/cast",
                        broadcaster_url=official
                        if urlsplit(official).scheme == "https"
                        else None,
                        excerpt_scope="Episode synopsis"
                        if desc
                        else "Series description",
                        date_precision="instant" if episode.get("airstamp") else "day",
                        attribution="TVmaze episode and cast data, CC BY-SA 4.0. Titles formatted and summaries excerpted.",
                        affordability_evidence=text(desc, 440)
                        if PRICE_WORDS.search(desc)
                        else None,
                    )
                    yield row
                    if sample:
                        return
