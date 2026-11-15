"""Follow an approved keyword search to bounded same-origin detail documents."""

from collections.abc import Callable, Iterator
from dataclasses import replace
from urllib.parse import urlencode

from cssselect import SelectorSyntaxError
from lxml.etree import XPathError
from scrapling import Selector

from .contracts import ExtractionConfiguration, Source
from .html_extraction import Query
from .inputs import CapturedInput, InputError, KeywordInput, WebInput
from .origin_rate import OriginRate
from .web_adapter import (
    MAX_ITEMS,
    SearchRequests,
    _decode_html,
    _same_origin_link,
    capture_html,
    checked_url,
    next_page,
    url_key,
)


def initial_input(
    source: Source, config: ExtractionConfiguration, entry: WebInput | KeywordInput
) -> WebInput:
    if config.search is None:
        if not isinstance(entry, WebInput):
            raise InputError(
                "keyword_not_supported", "Profile does not configure keyword search"
            )
        _, origin = checked_url(source, entry.url)
        if origin.startswith("https://"):
            raise InputError(
                "keyword_required", "Public HTTPS requires a keyword search profile"
            )
        return entry
    if not isinstance(entry, KeywordInput):
        raise InputError("keyword_required", "This profile requires a keyword input")
    keyword = entry.keyword.strip()
    if not 1 <= len(keyword) <= 128 or any(not char.isprintable() for char in keyword):
        raise InputError(
            "invalid_keyword", "Enter a keyword of 1–128 printable characters"
        )
    search = config.search
    url = (
        f"{search.origin}{search.path}?{urlencode({search.keyword_parameter: keyword})}"
    )
    return WebInput(checked_url(source, url)[0])


class SearchTraversal:
    def __init__(
        self,
        source: Source,
        config: ExtractionConfiguration,
        rate: OriginRate,
        check_access: Callable[[], object],
    ):
        assert config.search is not None
        self.source = source
        self.config = config
        self.search = config.search
        self.requests = SearchRequests(source, self.search, rate, check_access)
        self.failure: InputError | None = None

    def _links(self, document: CapturedInput) -> Iterator[WebInput]:
        page = Selector(
            _decode_html(document),
            url=document.location,
            adaptive=False,
            huge_tree=False,
        )
        query = Query(self.config.selector_type, self.search.detail_link_selector)
        try:
            items = Query(
                self.config.selector_type, self.search.result_item_selector
            ).select(page)
            if len(items) > MAX_ITEMS:
                raise InputError(
                    "row_limit", "Search results exceed the per-page item limit"
                )
            for item in items:
                if item.tag == "#text":
                    raise InputError(
                        "invalid_search_selector", "Result items must be HTML elements"
                    )
                links = query.select(item)
                if (
                    len(links) != 1
                    or links.first.tag != "a"
                    or not links.first.attrib.get("href")
                ):
                    raise InputError(
                        "invalid_detail_link",
                        "Each result must contain one matching anchor with href",
                    )
                try:
                    target = _same_origin_link(
                        self.source, document.location, links.first.attrib["href"]
                    )
                except ValueError as error:
                    raise InputError(
                        "invalid_detail_url",
                        "Detail link is malformed or outside the Source policy",
                    ) from error
                yield WebInput(target)
        except (SelectorSyntaxError, XPathError, TypeError) as error:
            raise InputError(
                "invalid_search_selector", "Search selectors must select HTML elements"
            ) from error

    def _capture(
        self,
        entry: WebInput,
        visited: set[str],
        *,
        search_pages: set[str] | None = None,
    ) -> CapturedInput:
        return capture_html(
            self.source,
            entry,
            visited=visited,
            requests=self.requests,
            duplicate_code="pagination_loop"
            if search_pages is None
            else "duplicate_detail_url",
            forbidden=search_pages,
        )

    def _next(self, document: CapturedInput, visited: set[str]) -> WebInput | None:
        return next_page(
            self.source,
            document,
            self.config,
            visited,
            search_pagination=self.search.pagination,
        )

    def sample(self, entry: WebInput) -> CapturedInput:
        visited: set[str] = set()
        search = self._capture(entry, visited)
        self._next(search, visited)
        detail = next(self._links(search), None)
        if detail is None:
            raise InputError(
                "empty_search_results",
                "The sample keyword returned no results",
                capture=search,
            )
        if url_key(detail.url) in visited:
            raise InputError(
                "invalid_detail_url",
                "A detail link points to a visited search page",
                capture=search,
            )
        return self._capture(detail, set(), search_pages=visited)

    def documents(self, entry: WebInput) -> Iterator[tuple[CapturedInput, bool]]:
        details: dict[str, WebInput] = {}
        search_visited: set[str] = set()
        max_pages = self.search.pagination.max_pages if self.search.pagination else 1
        for page_number in range(1, max_pages + 1):
            try:
                document = self._capture(entry, search_visited)
            except InputError as error:
                if error.capture:
                    yield replace(error.capture, capture_kind="search"), False
                raise
            yield replace(document, capture_kind="search"), False
            for target in self._links(document):
                key = url_key(target.url)
                if key in details:
                    continue
                if len(details) == self.search.max_detail_pages:
                    self.failure = InputError(
                        "detail_limit_reached",
                        "More results than the approved detail-page limit",
                    )
                    break
                details[key] = target

            try:
                following = self._next(document, search_visited)
            except InputError as error:
                self.failure = error
                break
            if following is None:
                break
            if page_number == max_pages:
                self.failure = InputError(
                    "page_limit_reached",
                    "Next search page exceeds the approved search-page limit",
                )
                break
            entry = following

        if not details:
            raise self.failure or InputError(
                "empty_search_results", "The keyword returned no search results"
            )

        if details.keys() & search_visited:
            raise InputError(
                "invalid_detail_url", "A detail link points to a visited search page"
            )
        detail_visited: set[str] = set()
        for key, target in details.items():
            if key in detail_visited:
                continue
            try:
                document = self._capture(
                    target, detail_visited, search_pages=search_visited
                )
            except InputError as error:
                if error.capture:
                    yield replace(error.capture, capture_kind="detail"), False
                if error.error.code == "duplicate_detail_url":
                    continue
                if (
                    error.error.http_status in (404, 410)
                    and error.error.code == "http_error"
                ):
                    self.failure = self.failure or error
                    continue
                raise
            yield replace(document, capture_kind="detail"), True
