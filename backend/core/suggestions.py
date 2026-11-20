"""Run one bounded, read-only Source suggestion attempt."""

import os
from collections.abc import Callable, Iterable
from time import monotonic

from .contracts import ExtractionConfiguration, KeywordSearch, Source
from .ingestion import ingest
from .inputs import CapturedInput, InputError, WebInput
from .origin_rate import OriginRate
from .search import checked_keyword
from .suggestion_markup import (
    DEFAULT_SCHEMA,
    detail_mapping,
    display,
    example_target,
    form_target,
    listing_mapping,
    navigation,
    parse,
)
from .suggestion_models import (
    Examples,
    Outcome,
    RequestEntry,
    Stage,
    SuggestedMapping,
    SuggestionLimits,
    SuggestionRequest,
    SuggestionResult,
)
from .web_adapter import (
    RequestLimits,
    SearchRequests,
    capture_html,
    checked_url,
    html_candidates,
    url_key,
)

DENIED = {
    "access_blocked",
    "source_not_approved",
    "source_policy_changed",
    "destination_denied",
    "robots_denied",
    "redirect_denied",
    "unsafe_destination",
}
BUDGET = {
    "request_limit_reached",
    "collection_deadline",
    "input_too_large",
    "origin_rate_busy",
}
TRANSIENT = {
    "timeout",
    "transport_error",
    "origin_rate_unavailable",
    "robots_unavailable",
    "rate_limited",
    "dns_unavailable",
}
NEEDS_EXAMPLES = {
    "no_search_form",
    "unsupported_form",
    "ambiguous_form",
    "ambiguous_navigation",
    "ambiguous_results",
    "row_limit",
    "unsupported_search_path",
}


def limits_for(
    source: Source,
    origin: str,
    request: SuggestionRequest,
    reviewed: Iterable[KeywordSearch],
) -> SuggestionLimits:
    public = origin.startswith("https://")
    # Source has no reviewed onboarding cap. Unknown public permissions get the
    # three-request, 15-second ceiling from the reviewed publisher runs.
    applicable = tuple(cap for cap in reviewed if cap.origin == origin)
    requests = min(
        [
            3 if public or isinstance(request, Examples) else 5,
            *(cap.max_requests for cap in applicable),
        ]
    )
    body_bytes = min([512_000, *(cap.max_body_bytes for cap in applicable)])
    return SuggestionLimits(
        policy="public_conservative" if public else "controlled_defaults",
        reviewed_profile_limits=bool(applicable),
        max_requests=requests,
        max_body_bytes=body_bytes,
        max_total_body_bytes=requests * body_bytes,
        timeout_seconds=min([2, *(cap.timeout_seconds for cap in applicable)]),
        max_seconds=min(
            [15 if public else 20, *(cap.max_seconds for cap in applicable)]
        ),
        min_request_interval_ms=max(2000, source.min_request_interval_ms),
    )


class SuggestionAttempt:
    def __init__(
        self,
        source: Source,
        reload_source: Callable[[], Source],
        rate: OriginRate,
        reviewed: Iterable[KeywordSearch],
        *,
        started: float | None = None,
    ):
        self.source = source
        self.reload_source = reload_source
        self.rate = rate
        self.reviewed = reviewed
        self.stage: Stage = "entry"
        self.ledger: list[RequestEntry] = []
        self.limits: SuggestionLimits | None = None
        self.requests: SearchRequests | None = None
        self.origin: str | None = None
        self.visited: set[str] = set()
        self.completed_at: float | None = None
        self.started = monotonic() if started is None else started

    def _access(self):
        current = self.reload_source()
        if current.approval_status != "approved":
            raise InputError(
                "source_not_approved", "Source access is no longer authorised."
            )
        if current != self.source:
            raise InputError(
                "source_policy_changed",
                "The Source policy changed. Review it before a fresh attempt.",
            )

    def _observe(self, robots: bool, state: str):
        stage = "robots" if robots else self.stage
        entry = RequestEntry(stage=stage, state=state)
        if state == "transport_attempt":
            self.ledger[-1] = entry
        else:
            self.ledger.append(entry)

    def _preflight(self, mandatory: int):
        assert self.requests is not None
        if self.requests.remaining < mandatory:
            raise InputError(
                "request_limit_reached",
                "The effective request cap cannot cover the remaining stages. Start with permitted examples if they fit.",
            )
        interval = self.requests.interval_ms / 1000
        gaps = (mandatory - 1) * interval
        if self.completed_at is not None:
            gaps += max(0, self.completed_at + interval - monotonic())
        if monotonic() + gaps >= self.requests.deadline:
            raise InputError(
                "collection_deadline",
                "The remaining time cannot cover required Source pacing.",
            )

    def _fetch(self, stage: Stage, url: str, mandatory: int) -> CapturedInput:
        self.stage = stage
        url, origin = checked_url(self.source, url)
        if origin != self.origin:
            raise InputError(
                "destination_denied", "Every stage must use the same origin."
            )
        self._preflight(mandatory)
        assert self.requests is not None
        if self.requests.policy is None:
            self.stage = "robots"
            self._access()
            self.requests.robots(origin)
            self.completed_at = monotonic()
            self.stage = stage
            self._preflight(mandatory - 1)
        document = capture_html(
            self.source,
            WebInput(url),
            check_access=self._access,
            requests=self.requests,
            visited=self.visited,
        )
        self.completed_at = monotonic()
        return document

    def _result(
        self, outcome: Outcome, code: str, reason: str, **extra
    ) -> SuggestionResult:
        limits = self.limits
        if limits and self.requests:
            limits = limits.model_copy(
                update={"min_request_interval_ms": self.requests.interval_ms}
            )
        return SuggestionResult(
            outcome=outcome,
            stage=self.stage,
            code=code,
            reason=reason,
            limits=limits,
            reserved_requests=sum(
                row.state != "denied_before_send" for row in self.ledger
            ),
            actual_attempts=sum(
                row.state == "transport_attempt" for row in self.ledger
            ),
            requests=tuple(self.ledger),
            **extra,
        )

    def run(self, request: SuggestionRequest) -> SuggestionResult:
        try:
            return self._run(request)
        except InputError as error:
            code = error.error.code
            outcome: Outcome = "unsupported"
            if code in DENIED:
                outcome = "denied"
                if not self.ledger or self.ledger[-1].stage != self.stage:
                    self.ledger.append(
                        RequestEntry(stage=self.stage, state="denied_before_send")
                    )
            elif code in BUDGET or (
                code == "timeout"
                and self.requests
                and monotonic() >= self.requests.deadline
            ):
                outcome = "budget_exhausted"
            elif code in TRANSIENT or (
                code == "http_error" and (error.error.http_status or 0) >= 500
            ):
                outcome = "transient_failure"
            elif code in NEEDS_EXAMPLES and not isinstance(request, Examples):
                outcome = "needs_examples"
            return self._result(
                outcome,
                code,
                str(error),
                retry_after_seconds=error.error.retry_after_seconds,
            )

    def _run(self, request: SuggestionRequest) -> SuggestionResult:
        if self.source.adapter_type != "web":
            raise InputError(
                "unsupported_source", "Suggestions require an authorised web Source."
            )
        self._access()
        keyword = checked_keyword(request.keyword)
        examples = isinstance(request, Examples)
        entry, origin = checked_url(
            self.source, request.results_url if examples else request.homepage_url
        )
        self.origin = origin
        if (
            not origin.startswith("https://")
            and os.environ.get("M3_COMPOSE_FIXTURE") != "1"
        ):
            raise InputError(
                "destination_denied",
                "Controlled HTTP discovery requires the fixture environment.",
            )
        detail_url = None
        if examples:
            detail_url, detail_origin = checked_url(self.source, request.detail_url)
            if detail_origin != origin:
                raise InputError(
                    "destination_denied",
                    "The detail URL must use the same origin as the results.",
                )
            if url_key(detail_url) == url_key(entry):
                raise InputError(
                    "unsupported_examples",
                    "Supply a distinct detail URL on the results origin.",
                )
            target = example_target(entry, keyword)
        limits = self.limits = limits_for(self.source, origin, request, self.reviewed)
        self.requests = SearchRequests(
            self.source,
            RequestLimits(
                max_requests=limits.max_requests,
                max_redirects=0,
                max_body_bytes=limits.max_body_bytes,
                timeout_seconds=limits.timeout_seconds,
                max_seconds=limits.max_seconds,
                min_interval_ms=limits.min_request_interval_ms,
            ),
            self.rate,
            self._access,
            observe=self._observe,
        )
        self.requests.deadline = self.started + limits.max_seconds
        if not examples:
            homepage = self._fetch("homepage", entry, 4)
            self.stage = "results"
            page = parse(homepage)
            target = form_target(page, self.source, homepage.location)
            if target is None:
                self.stage = "navigation"
                hop = navigation(page, self.source, homepage.location)
                if hop and url_key(hop) not in self.visited:
                    document = self._fetch("navigation", hop, 3)
                    self.stage = "results"
                    target = form_target(
                        parse(document), self.source, document.location
                    )
            if target is None:
                raise InputError(
                    "no_search_form",
                    "No single supported static GET search was found. Supply permitted results and detail examples.",
                )

        self.stage = "results"
        results_url = target.entry(self.source, keyword).url
        listing_document = self._fetch("results", results_url, 3 if examples else 2)
        listing = listing_mapping(parse(listing_document), self.source, results_url)
        matches = [
            link
            for link in listing.links
            if detail_url is None or url_key(detail_url) == url_key(link.url)
        ]
        if not matches:
            raise InputError(
                "mismatched_example",
                "The supplied detail URL was not among the eligible keyword results.",
            )
        link = matches[0]
        self.stage = "detail"
        if url_key(link.url) in self.visited:
            raise InputError(
                "ambiguous_results", "The selected detail URL repeats an earlier stage."
            )
        # Use the listing's actual href, checked against the explicit example.
        detail = self._fetch("detail", link.url, 1)
        self.stage = "mapping"
        schema = request.record_schema or DEFAULT_SCHEMA
        item, fields = detail_mapping(parse(detail), schema, link)
        search = KeywordSearch(
            origin=target.origin,
            path=target.path,
            keyword_parameter=target.parameter,
            result_item_selector=listing.items,
            detail_link_selector=listing.anchor,
            max_detail_pages=1,
            max_requests=3,
            max_redirects=0,
            max_body_bytes=limits.max_body_bytes,
            timeout_seconds=limits.timeout_seconds,
            max_seconds=limits.max_seconds,
            max_attempts=1,
        )
        proposal = SuggestedMapping(
            search=search,
            record_schema=schema,
            item_selector=item,
            listing_sample=display(link.label),
            fields=fields,
        )
        self._access()
        if monotonic() >= self.requests.deadline:
            raise InputError(
                "collection_deadline",
                "The discovery deadline expired before local verification.",
            )
        if item and all(field.mapping is not None for field in fields):
            config = ExtractionConfiguration(
                config_schema_version="1",
                record_schema=schema,
                selector_type="xpath",
                item_selector=item,
                fields=tuple(field.mapping for field in fields if field.mapping),
                search=search,
            )
            verified = ingest(
                html_candidates(detail, config), schema, self.source.source_id
            )
            if monotonic() >= self.requests.deadline:
                raise InputError(
                    "collection_deadline",
                    "The discovery deadline expired during local verification.",
                )
            if len(verified.valid) == 1 and not verified.invalid:
                return self._result(
                    "usable",
                    "sample_mapped",
                    "Repeated rows and one detail sample support this provisional mapping. Review it before saving.",
                    proposal=proposal,
                )
        return self._result(
            "partial",
            "unresolved_mapping",
            "Review and complete the unresolved mappings in the editor.",
            proposal=proposal,
        )
