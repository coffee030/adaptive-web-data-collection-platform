"""Infer a small static search and extraction mapping from captured markup."""

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

from scrapling import Selector

from .contracts import ExtractionField, RecordField, RecordSchema, Source, path_segments
from .html_extraction import Query
from .ingestion import _normalize
from .inputs import CapturedInput, InputError, WebInput
from .search import keyword_input
from .suggestion_models import FieldSuggestion
from .web_adapter import _decode_html, _same_origin_link, url_key

MAX_INSPECTED = 20
PARAMETER = re.compile(r"[A-Za-z0-9_.-]{1,64}")
TOKEN = re.compile(r"[a-zA-Z_][a-zA-Z0-9_-]{0,63}")
CHROME = "not(ancestor::nav or ancestor::header or ancestor::footer or ancestor::aside)"
TITLE_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "dt"}
TITLE_ROLES = {"title", "name", "headline"}
DEFAULT_SCHEMA = RecordSchema(
    record_type="publication",
    schema_version="1",
    identity_field="title",
    fields=(RecordField(name="title"), RecordField(name="count", value_type="integer")),
)


@dataclass(frozen=True)
class SearchTarget:
    origin: str
    path: str
    parameter: str

    def entry(self, source: Source, keyword: str) -> WebInput:
        try:
            path_segments(self.path)
        except ValueError as error:
            raise InputError(
                "unsupported_search_path",
                "The search path cannot be represented by a keyword Profile.",
            ) from error
        return keyword_input(source, self.origin, self.path, self.parameter, keyword)


@dataclass(frozen=True)
class ResultLink:
    url: str
    label: str


@dataclass(frozen=True)
class Listing:
    items: str
    anchor: str
    links: tuple[ResultLink, ...]


def parse(document: CapturedInput) -> Selector:
    return Selector(
        _decode_html(document), url=document.location, adaptive=False, huge_tree=False
    )


def node_text(node: Selector) -> str:
    return " ".join(node.get_all_text().split())


def display(value: str) -> str:
    return "".join(char for char in value if char.isprintable())[:160]


def destination(source: Source, current: str, reference: str) -> str:
    try:
        return _same_origin_link(source, current, reference)
    except ValueError as error:
        raise InputError(
            "destination_denied",
            "A discovered URL is outside the Source policy or malformed",
        ) from error


def example_target(url: str, keyword: str) -> SearchTarget:
    parts = urlsplit(url)
    try:
        fields = parse_qsl(
            parts.query, strict_parsing=True, errors="strict", max_num_fields=2
        )
    except ValueError:
        fields = []
    if (
        len(fields) != 1
        or not PARAMETER.fullmatch(fields[0][0])
        or fields[0][1] != keyword
    ):
        raise InputError(
            "unsupported_examples",
            "Supply a results URL with a single query parameter containing the same keyword.",
        )
    if len(parts.path) > 512:
        raise InputError(
            "unsupported_examples", "The results path exceeds the Profile limit."
        )
    return SearchTarget(
        f"{parts.scheme}://{parts.netloc}", parts.path or "/", fields[0][0]
    )


def _form_parameter(form: Selector) -> str | None:
    attrs = form.attrib
    # The valid non-GET methods are POST and dialog. A missing or invalid value defaults to GET.
    if attrs.get("method", "").lower() in {"post", "dialog"}:
        return None
    if form.css(
        "fieldset[disabled], [formaction], [formmethod], [formenctype], [form]"
    ):
        return None
    keyword = None
    for control in form.css("input, button, select, textarea, object"):
        attrs = control.attrib
        if "disabled" in attrs:
            continue
        kind = attrs.get("type", "").lower()
        name = attrs.get("name")
        if "dirname" in attrs or (control.tag == "input" and kind == "image"):
            return None
        if not name or kind in {"button", "reset"}:
            continue
        if control.tag != "input" or kind not in {"", "text", "search"} or keyword:
            return None
        if "readonly" in attrs or "pattern" in attrs or not PARAMETER.fullmatch(name):
            return None
        keyword = name
    return keyword


def form_target(page: Selector, source: Source, url: str) -> SearchTarget | None:
    if page.css("base[href], [form]"):
        return None
    forms = page.css("form")
    if len(forms) > MAX_INSPECTED:
        raise InputError(
            "ambiguous_form", "Too many forms to identify a single keyword search."
        )
    possible = [(form, key) for form in forms if (key := _form_parameter(form))]
    if len(possible) > 1:
        raise InputError(
            "ambiguous_form",
            "Multiple static GET forms could accept the keyword. Supply examples.",
        )
    if not possible:
        return None
    form, parameter = possible[0]
    action = form.attrib.get("action", "").strip() or url
    target = destination(source, url, action)
    parts = urlsplit(target)
    if parts.query or len(parts.path) > 512:
        raise InputError(
            "unsupported_form",
            "The form action cannot be represented by a bare Profile search path.",
        )
    return SearchTarget(
        f"{parts.scheme}://{parts.netloc}", parts.path or "/", parameter
    )


def navigation(page: Selector, source: Source, url: str) -> str | None:
    if page.css("base[href]"):
        return None
    links = page.css("a[href]")
    if len(links) > MAX_INSPECTED:
        raise InputError(
            "ambiguous_navigation",
            "The homepage exceeds the 20-link inspection limit. Supply examples.",
        )
    candidates = [
        link.attrib["href"]
        for link in links
        if re.match(
            r"^(?:search|find)(?:\b|$)",
            (link.attrib.get("aria-label") or node_text(link)).lower(),
        )
    ]
    if len(candidates) > 1:
        raise InputError(
            "ambiguous_navigation", "Multiple search links were found. Supply examples."
        )
    return destination(source, url, candidates[0]) if candidates else None


def _tag(node: Selector) -> str:
    tag = node.tag
    return tag if TOKEN.fullmatch(tag) else "*"


def _class(token: str) -> str:
    return f"[contains(concat(' ', normalize-space(@class), ' '), ' {token} ')]"


def _relative(node: Selector, parent: Selector) -> str:
    distance = len(node.path) - len(parent.path)
    return "./" + "/".join(
        _tag(part) for part in [*reversed(node.path[: distance - 1]), node]
    )


def _selectors(node: Selector, parent: Selector) -> set[str]:
    base = _relative(node, parent)
    return {base} | {
        base + _class(token)
        for token in node.attrib.get("class", "").split()[:8]
        if TOKEN.fullmatch(token)
    }


def listing_mapping(page: Selector, source: Source, url: str) -> Listing:
    row = (
        "(self::li or self::tr or self::article or self::section or self::div[@class])"
    )
    rows = page.xpath(
        f"//*[{row}][{CHROME}][.//a[@href]][not(.//*[{row}][.//a[@href]])]"
    )
    if len(rows) > MAX_INSPECTED:
        raise InputError(
            "row_limit", "The listing exceeds the 20-row inspection limit."
        )
    groups: dict[str, list[Selector]] = {}
    for item in rows:
        # A structural path ending in the row tag generalizes across sibling rows.
        path = "/" + "/".join(_tag(node) for node in [*reversed(item.path), item])
        groups.setdefault(path, []).append(item)
    verified: dict[tuple[str, ...], Listing] = {}
    denied = False
    for path, items in groups.items():
        if len(items) < 2 or len(path) > 1024 or len(page.xpath(path)) != len(items):
            continue
        first = items[0].css("a[href]")
        if len(first) > MAX_INSPECTED:
            continue
        selectors = {
            expression for link in first for expression in _selectors(link, items[0])
        }
        for expression in sorted(selectors, key=lambda value: (len(value), value)):
            if len(expression) > 1024:
                continue
            selected = [Query("xpath", expression).select(item) for item in items]
            if any(
                len(matches) != 1 or not matches.first.attrib.get("href")
                for matches in selected
            ):
                continue
            labels = tuple(node_text(matches.first) for matches in selected)
            if not all(labels) or len({label.casefold() for label in labels}) != len(
                items
            ):
                continue
            try:
                targets = tuple(
                    destination(source, url, matches.first.attrib["href"])
                    for matches in selected
                )
            except InputError:
                denied = True
                continue
            keys = tuple(url_key(target) for target in targets)
            if len(set(keys)) == len(items) and url_key(url) not in keys:
                verified.setdefault(
                    keys,
                    Listing(
                        path,
                        expression,
                        tuple(
                            ResultLink(*pair)
                            for pair in zip(targets, labels, strict=True)
                        ),
                    ),
                )
    if denied:
        raise InputError(
            "destination_denied",
            "A plausible listing link would leave the authorised scope.",
        )
    if len(verified) != 1:
        raise InputError(
            "ambiguous_results",
            "Could not identify a unique set of repeated result rows with one publication link each.",
        )
    return next(iter(verified.values()))


def detail_mapping(
    page: Selector, schema: RecordSchema, link: ResultLink
) -> tuple[str | None, tuple[FieldSuggestion, ...]]:
    headings = page.xpath(
        f"//*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6 or self::dt][{CHROME}]"
    )
    matches = [
        node for node in headings if node_text(node).casefold() == link.label.casefold()
    ]
    item_selector = None
    item = None
    if len(matches) == 1:
        # Choose the nearest semantic content container, keeping page chrome outside it.
        container = next(
            (
                node
                for node in matches[0].path
                if node.tag in {"article", "main", "section"}
            ),
            None,
        )
        if container is not None:
            path = "/" + "/".join(
                _tag(node) for node in [*reversed(container.path), container]
            )
            if len(path) <= 1024 and len(page.xpath(path)) == 1:
                item_selector, item = path, container
    if item is None:
        return None, tuple(
            FieldSuggestion(
                name=field.name,
                reason="No unique content heading matched the selected listing text.",
            )
            for field in schema.fields
        )
    return item_selector, tuple(
        _field_mapping(item, matches[0], field) for field in schema.fields
    )


def _field_mapping(
    item: Selector, heading: Selector, field: RecordField
) -> FieldSuggestion:
    key = re.sub(r"[^a-z0-9]+", "-", field.name.casefold()).strip("-")
    candidates: dict[str, tuple[str, str]] = {}
    if field.value_type == "string" and key in TITLE_ROLES:
        candidates[_relative(heading, item)] = (
            node_text(heading),
            "The detail heading matches the selected listing text.",
        )
    elif TOKEN.fullmatch(key):
        for node in item.xpath(
            ".//*" + _class(key) + f" | .//*[@id='{key}' or @itemprop='{key}']"
        ):
            path = _relative(node, item)
            candidates[path] = (
                node_text(node),
                "The element names the requested field and supplies a value of the requested type.",
            )
        for node in item.css("dt"):
            if re.sub(r"[^a-z0-9]+", "-", node_text(node).casefold()).strip("-") == key:
                companion = node.xpath("following-sibling::*[1][self::dd]").first
                if companion is not None:
                    path = _relative(companion, item)
                    candidates[path] = (
                        node_text(companion),
                        "A definition label names the requested field.",
                    )
        if (
            not candidates
            and key == "count"
            and field.value_type == "integer"
            and heading.tag == "dt"
        ):
            companion = heading.xpath("following-sibling::*[1][self::dd]").first
            if companion is not None:
                path = _relative(companion, item)
                candidates[path] = (
                    node_text(companion),
                    "The matching title's adjacent definition contains one integer. Review its meaning.",
                )

    usable = []
    for selector, (value, reason) in candidates.items():
        if len(selector) > 1024 or not value or len(item.xpath(selector)) != 1:
            continue
        try:
            typed = _normalize(value, field.value_type)
        except (ValueError, OverflowError):
            continue
        usable.append((selector, typed, reason))
    if len(usable) != 1:
        return FieldSuggestion(
            name=field.name,
            reason="No unique typed element was supported by the sample. Choose a field selector in the editor.",
        )
    selector, value, reason = usable[0]
    return FieldSuggestion(
        name=field.name,
        mapping=ExtractionField(name=field.name, selector=selector),
        sample=display(value) if isinstance(value, str) else value,
        reason=reason,
    )
