"""Public collection robots rules and bounded timing directives."""

import re
from dataclasses import dataclass
from fnmatch import fnmatchcase
from urllib.parse import quote, urlsplit

from .inputs import InputError

ESCAPE = re.compile(r"%([a-fA-F0-9]{2})")
UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"


def _normalized(value: str) -> str:
    def escape(match: re.Match[str]) -> str:
        char = chr(int(match[1], 16))
        return char if char in UNRESERVED else match[0].upper()

    return ESCAPE.sub(escape, quote(value, safe="/%!$&'()*+,-.:;=?@_~[]"))


@dataclass(frozen=True)
class RobotsPolicy:
    rules: tuple[tuple[str, bool], ...] = ()
    interval_ms: int = 0

    def can_fetch(self, user_agent: str, url: str) -> bool:
        parts = urlsplit(url)
        target = _normalized(
            (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        )
        matches = []
        for pattern, allow in self.rules:
            anchored = pattern.endswith("$")
            pattern = pattern.removesuffix("$")
            glob = "".join(
                {"?": "[?]", "[": "[[]", "]": "[]]"}.get(char, char) for char in pattern
            )
            if fnmatchcase(target, glob if anchored else glob + "*"):
                matches.append((len(pattern), allow))
        return max(matches, default=(0, True))[1]


def parse_policy(body: bytes, product: str) -> RobotsPolicy:
    try:
        lines = body.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as error:
        raise InputError("robots_unavailable", "robots.txt must be UTF-8") from error

    groups: list[tuple[set[str], list[tuple[str, str]]]] = []
    agents: set[str] = set()
    rules: list[tuple[str, str]] = []
    for line in lines:
        key, separator, value = line.partition("#")[0].partition(":")
        if not separator:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if rules:
                groups.append((agents, rules))
                agents, rules = set(), []
            agents.add(value.lower())
        elif agents and key in {"allow", "disallow", "crawl-delay", "request-rate"}:
            rules.append((key, value))
    groups.append((agents, rules))

    product = product.lower()
    match = product if any(product in agents for agents, _ in groups) else "*"
    timing = 0
    paths = []
    for agents, rules in groups:
        if match not in agents:
            continue
        for key, value in rules:
            if key in {"crawl-delay", "request-rate"}:
                timing = max(timing, _interval_ms(key, value))
            elif value.startswith("/"):
                if len(value) > 2048 or len(paths) >= 1000:
                    raise InputError(
                        "robots_unavailable", "robots rules exceed supported bounds"
                    )
                paths.append((_normalized(value), key == "allow"))
    return RobotsPolicy(tuple(paths), timing)


def _interval_ms(key: str, value: str) -> int:
    if key == "crawl-delay" and re.fullmatch(r"\d{1,3}(?:\.\d{1,3})?", value, re.ASCII):
        whole, _, fraction = value.partition(".")
        result = int(whole) * 1000 + int(fraction.ljust(3, "0"))
    elif key == "request-rate" and (
        match := re.fullmatch(r"([1-9][0-9]{0,5})\s*/\s*([1-9][0-9]{0,5})", value)
    ):
        requests, seconds = map(int, match.groups())
        result = (seconds * 1000 + requests - 1) // requests
    else:
        raise InputError("robots_unavailable", "Unsupported robots timing directive")
    if result > 10_000:
        raise InputError(
            "robots_unavailable", "Robots timing exceeds supported request budget"
        )
    return result
