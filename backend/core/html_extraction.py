"""Configuration-driven Scrapling extraction shared by M0 and the Core."""

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin

from cssselect import SelectorSyntaxError
from scrapling import Selector


@dataclass(frozen=True)
class Query:
    kind: Literal["css", "xpath"]
    expression: str

    def select(self, node: Selector):
        if self.kind == "css":
            return node.css(self.expression, adaptive=False)
        if self.kind == "xpath":
            return node.xpath(self.expression, adaptive=False)
        raise ValueError(f"Unsupported selector kind: {self.kind}")


@dataclass(frozen=True)
class Field:
    query: Query
    attribute: str | None = None
    required: bool = True
    resolve_url: bool = False


@dataclass(frozen=True)
class ExtractionConfig:
    records: Query
    fields: dict[str, Field]


@dataclass(frozen=True)
class Candidate:
    payload: dict[str, str | None]
    missing_required: tuple[str, ...]


class ExtractionSizeLimit(ValueError):
    """Configured selectors generated too much text for one document."""


def extract(
    html: str,
    page_url: str,
    config: ExtractionConfig,
    *,
    max_records: int | None = None,
    max_value_bytes: int | None = None,
) -> list[Candidate]:
    page = Selector(html, url=page_url, adaptive=False, huge_tree=False)
    items = config.records.select(page)
    if max_records is not None and len(items) > max_records:
        raise OverflowError("HTML item limit exceeded")
    records = []
    value_bytes = 0
    for item in items:
        if item.tag == "#text":
            raise SelectorSyntaxError("Item selector must return HTML elements")
        payload = {}
        missing = []
        for name, field in config.fields.items():
            node = field.query.select(item).first
            value = None
            if node is not None:
                if field.attribute is None:
                    value = " ".join(node.get_all_text().split()) or None
                else:
                    raw = node.attrib.get(field.attribute)
                    if raw is not None:
                        value = raw.strip() or None
            if value is None and field.required:
                missing.append(name)
            if value is not None:
                if field.resolve_url:
                    value = urljoin(page_url, value)
                if max_value_bytes is not None:
                    value_bytes += len(value.encode("utf-8"))
                    if value_bytes > max_value_bytes:
                        raise ExtractionSizeLimit
            payload[name] = value
        records.append(Candidate(payload, tuple(missing)))
    return records
