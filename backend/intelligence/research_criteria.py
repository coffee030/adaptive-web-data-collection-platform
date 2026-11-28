"""Resolve a bounded research brief without invoking the operational research path."""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import get_args

from .contracts import Platform
from .research_criteria_contracts import (
    MAX_AGE_DAYS,
    MIN_AGE_DAYS,
    CriteriaCandidate,
    CriteriaField,
    CriteriaFieldResolution,
    CriteriaIssue,
    CriteriaReference,
    PlatformIntent,
    ResearchCriteriaInput,
    ResearchCriteriaResolution,
    ResearchTextField,
    ResolvedResearchCriteria,
    StructuredField,
)


# Latin aliases can border CJK text, but must stand apart from Latin words and IDs.
START = r"(?<![a-z0-9_])"
END = r"(?![a-z0-9_])"
AGE_NUMBER = r"[+\-−]?[0-9]+"
EN_AGE = r"(?:last|past|previous)"
ZH_AGE = r"(?:最近|過去|近)"
ZH_DAY = r"(?:天|日)"
ZH_WEEK = r"(?:個?\s*(?:星期|禮拜|週|周))"
EN_UNIT = r"(?:days?|weeks?|months?|years?|hours?)"
AGE_RESTRICTION_NAME = r"(?:publication[- ]age|date)\s+restriction"
MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
WEEKDAY = r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)"
AGE = re.compile(
    rf"(?P<english>{START}{EN_AGE}\s+(?P<en_number>{AGE_NUMBER})\s+"
    rf"(?P<en_unit>days?|weeks?){END}(?!\s+ago{END}|\s*[-–]\s*[0-9]))"
    rf"|(?P<chinese>{ZH_AGE}\s*(?P<zh_number>{AGE_NUMBER})\s*"
    rf"(?P<zh_unit>{ZH_WEEK}|{ZH_DAY}))"
    rf"|(?P<unrestricted>{START}no\s+{AGE_RESTRICTION_NAME}{END}"
    r"|不限(?:發布|發佈)?日期)"
    rf"|(?P<unsupported>{START}(?:(?:{EN_AGE}|next|this)\s+"
    rf"|(?:within|in)\s+(?!(?:the\s+)?{EN_AGE}{END}))"
    rf"(?:(?:[+\-−]?\d+(?:[.,/]\d+)?|[a-z]+)[\s-]+){{0,4}}{EN_UNIT}{END}"
    rf"|{START}[+\-−]?\d+(?:[.,/]\d+)?[\s-]+{EN_UNIT}{END}"
    rf"|{START}(?:{MONTH}\.?\s+(?:[0-9]{{4}}|[0-9]{{1,2}})"
    rf"|[0-9]{{1,2}}\s+{MONTH}){END}"
    r"|(?<!\d)\d{4}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{1,2})?(?!\d)"
    r"|(?<!\d)\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?!\d)"
    r"|\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*[日號]"
    r"|(?:上|今|本|下|這)\s*(?:個?\s*月|個?\s*(?:星期|禮拜)|[週周年])"
    rf"|{ZH_AGE}\s*(?:[+\-−]?\d+(?:[.,/]\d+)?|[零〇一二兩三四五六七八九十百千萬廿卅]+)"
    rf"\s*(?:{ZH_WEEK}|{ZH_DAY}|個?\s*月|年)"
    rf"|(?<![0-9])\d+\s*(?:{ZH_WEEK}|{ZH_DAY})"
    rf"|{START}(?:since|until|through|after|before|during|between|in)\s+(?:yesterday|today|\d{{4}}){END}"
    rf"|{START}(?:{EN_AGE}|this|since|before|after)\s+(?:{WEEKDAY}|{MONTH}){END}"
    r"|\d{4}\s*(?:to|[-–])\s*\d{4}"
    rf"|{START}(?:yesterday|today){END}|昨天|前天|今天)"
    rf"|(?P<vague>{START}(?:recent|current|latest|newly){END}|近期|最近|最新)",
    re.IGNORECASE,
)

PLATFORM = re.compile(
    rf"{START}(?:(?P<youtube>youtube)|(?P<instagram>instagram|ig)"
    rf"|(?P<facebook>facebook|fb)|(?P<tiktok>tiktok)){END}|(?P<douyin>抖音)",
    re.IGNORECASE,
)
NEGATES = re.compile(
    rf"{START}(?:not(?:\s+on)?|no|exclude|avoid|except|without(?:\s+using)?)\s+$"
    r"|(?:不要|排除|不用|不選|不是|不包括|不做|避免|除外)\s*$",
    re.IGNORECASE,
)
AGE_EXCLUSION_PREFIX = re.compile(
    rf"{START}(?:outside(?:\s+of)?|(?:older|earlier)\s+than|before|(?:not|never)\s+"
    r"(?:(?:just|only)\s+)?"
    r"(?:(?:published|posted|released|uploaded|created)\s+)?(?:in|within|during))"
    r"\s+(?:the\s+)?$"
    r"|(?:不需要|無需|毋須|不用|不必|不要)\s*(?:限制|限於|限于)\s*(?:在|於|于)?\s*$",
    re.IGNORECASE,
)
AGE_EXCLUSION_SUFFIX = re.compile(r"^\s*(?:以外|之外|以前|之前)")
PLATFORM_EXCLUSION_SUFFIX = re.compile(
    rf"^\s*(?:(?:is\s+)?(?:not\s+(?:allowed|wanted|permitted|included|"
    rf"(?:a|an|the)\s+(?:target|option|alternative))|"
    rf"excluded|disallowed|prohibited|off\s+limits){END}"
    r"|除外|例外|不要|禁止|不選|不用)",
    re.IGNORECASE,
)
PLATFORM_EXCEPTION_SUFFIX = re.compile(r"^\s*(?:以外|之外)(?:的(?:平台|渠道))?")
CONDITIONAL_SUFFIX = re.compile(
    rf"^\s*(?:(?:only\s+)?(?:if|when|where|unless|provided|subject\s+to){END}"
    r"|視乎|視情況|如果|若|如有).*$",
    re.IGNORECASE,
)
EXCLUSIVE_PREFIX = re.compile(
    rf"{START}only\s+$|(?:只(?:用|限|找|選)|僅限)\s*$", re.IGNORECASE
)
EXCLUSIVE_SUFFIX = re.compile(rf"^\s+only{END}", re.IGNORECASE)
COORDINATION = re.compile(
    r"(?:[\s,，、/&]+|(?:and|or|nor|vs\.?|versus)\s+|以及|和|與|或)+",
    re.IGNORECASE,
)
COMPARISON = re.compile(rf"{START}(?:compare|comparison){END}|比較|對比", re.IGNORECASE)
VERSUS = re.compile(r"\s+(?:vs\.?|versus)\s+", re.IGNORECASE)
COMPARISON_JOIN = re.compile(
    r"\s*(?:[,，、&]\s*(?:and\s+)?|and\s+|vs\.?\s+|versus\s+|以及|和|與)\s*",
    re.IGNORECASE,
)
ALTERNATIVE_JOIN = re.compile(
    r"\s*(?:(?:[,;，]\s*)?(?:or\b|alternatively\b|with\s+)|或者?|備選|備用)\s*",
    re.IGNORECASE,
)
MAIN_TO_ALTERNATIVE = re.compile(
    r"\s*(?:as\s+(?:the\s+)?(?:main|primary)(?:\s+(?:platform|channel))?|為主)"
    r"\s*[,;，、]\s*(?:with\s+)?",
    re.IGNORECASE,
)
ALTERNATIVE_SUFFIX = re.compile(
    r"^\s*(?:as\s+(?:an?\s+)?(?:alternative|backup)\b|為(?:備選|備用))",
    re.IGNORECASE,
)

DELIVERABLE = re.compile(
    rf"(?P<short_video>{START}(?:short(?:[- ]form)?\s+videos?|short-videos?"
    rf"|youtube\s+shorts|instagram\s+reels){END}|短片|短視頻|短影音)"
    rf"|(?P<dedicated_video>{START}dedicated\s+(?:sponsorship\s+)?videos?{END}|專題贊助影片)"
    rf"|(?P<video_integration>{START}(?:sponsored\s+)?video\s+integrations?{END}|影片置入)"
    rf"|(?P<social_post>{START}social(?:\s+media)?\s+posts?{END}|社交(?:媒體)?貼文)"
    rf"|(?P<generic>{START}videos?{END}|影片|視頻)",
    re.IGNORECASE,
)
DELIVERABLE_NEGATION_SUFFIX = re.compile(
    rf"^\s*(?:(?:(?:is|are)\s+)?(?:not\s+(?:wanted|required|needed|allowed|preferred|"
    rf"requested)|excluded|disallowed|prohibited){END}|除外|例外|不要|禁止|不選|不用)",
    re.IGNORECASE,
)
LANGUAGE = re.compile(
    rf"(?P<yue>{START}cantonese{END}|廣東話|粵語)"
    rf"|(?P<en>{START}english{END}|英文|英語)"
    rf"|(?P<traditional>{START}traditional\s+chinese{END}|繁體中文)"
    rf"|(?P<unsupported>{START}(?:chinese|mandarin){END}|中文|普通話|華語)",
    re.IGNORECASE,
)
LANGUAGE_PREFIX = re.compile(
    rf"(?P<mandatory>{START}(?:must\s+(?:be(?:\s+in)?|use|speak)|requires?|mandatory)"
    r"\s*[:：]?\s+|必須\s*(?:用|使用|講)?\s*|一定要\s*(?:用|使用|講)?\s*)$"
    rf"|(?P<preferred>{START}(?:prefer(?:red)?|ideally)\s*[:：]?\s+"
    r"|(?:偏好|優先(?:考慮|使用)?|最好(?:用|使用|講)?)\s*)$",
    re.IGNORECASE,
)
LANGUAGE_SUFFIX = re.compile(
    rf"^(?:(?P<mandatory>\s+(?:(?:is\s+)?(?:required|mandatory)|only){END}|\s*必須)"
    rf"|(?P<preferred>\s+(?:is\s+)?preferred{END}|\s*優先))",
    re.IGNORECASE,
)
LANGUAGE_QUALIFIER_PREFIX = re.compile(
    rf"{START}(?:not\s+(?:necessarily|required\s+to)|optional(?:ly)?)\s+"
    r"(?:(?:speak|be\s+in|use)\s+)?$"
    r"|(?:不一定(?:要)?|未必(?:要)?|無須|毋須|不必)\s*(?:用|使用|講)?\s*$",
    re.IGNORECASE,
)
LANGUAGE_NEGATION_PREFIX = re.compile(
    rf"{START}(?:not|don't|doesn't|never|without)\s+(?:speak(?:ing)?|use|using)\s+$"
    r"|(?:不要|不用|不需要|禁止|排除)\s*(?:用|使用|講)?\s*$",
    re.IGNORECASE,
)
LANGUAGE_NEGATION_SUFFIX = re.compile(
    rf"^\s*(?:(?:is\s+)?not{END}|非|並非|不(?:必|需|用)).*$", re.IGNORECASE
)
CLAUSE_BOUNDARY = re.compile(r"[,，。.;；!！?？\n]")
NEGATIVE_CUE = (
    rf"{START}(?:(?:(?:do|does|did|must|should|can|could|will|would)\s+)?not|"
    rf"(?:don|doesn|didn|mustn|shouldn|can|couldn|won|wouldn)['’]t|"
    rf"no(?!\s+{AGE_RESTRICTION_NAME}{END})|never|neither|nor|without|excluding|except|avoid|exclude|"
    rf"instead\s+of|rather\s+than){END}"
    r"|並非|不是|不要|不用|不做|不需要|不考慮|不必|毋須|無需|而非|除外|排除|避免|禁止"
)
LOCAL_NEGATION = re.compile(rf"(?:{NEGATIVE_CUE}).*$", re.IGNORECASE)
INSTRUCTION_RESTART = re.compile(
    rf"{START}(?:(?P<coordinated>and(?:\s+then)?|then|while)\s+|but\s+)"
    rf"(?=(?:find|look\s+for|focus\s+on|(?:in|ex)clude|avoid|compare|"
    rf"use|create|make|produce|request|require|prefer|choose|select){END})"
    r"|但(?:是)?|而是",
    re.IGNORECASE,
)


def _clause_prefix(text: str) -> str:
    return CLAUSE_BOUNDARY.split(text)[-1]


def _phrase_context(text: str, match: re.Match[str]) -> tuple[str, str]:
    """Bound scope checks to the clause surrounding the matched term."""
    return (
        _clause_prefix(text[: match.start()]),
        CLAUSE_BOUNDARY.split(text[match.end() :], maxsplit=1)[0],
    )


def _instruction_prefix(prefix: str, *other_criteria: re.Pattern[str]) -> str:
    """Keep a cue through unknown words up to a recognizable new instruction."""
    start = 0
    for restart in INSTRUCTION_RESTART.finditer(prefix):
        if restart["coordinated"]:
            earlier = prefix[start : restart.start()]
            negation = LOCAL_NEGATION.search(earlier)
            # A joined verb can share the negation unless a different criterion
            # already completes the negative instruction.
            if negation and not any(
                pattern.search(earlier, negation.start()) for pattern in other_criteria
            ):
                continue
        start = restart.end()
    return prefix[start:]


def _texts(source: ResearchCriteriaInput) -> Iterator[tuple[ResearchTextField, str]]:
    for field in ("research_text", "product", "discovery_focus"):
        if value := getattr(source, field):
            yield field, value


def _reference(
    field: ResearchTextField, text: str, match: re.Match[str]
) -> CriteriaReference:
    return CriteriaReference(
        field=field, matched_text=text[match.start() : match.end()]
    )


def _phrase_reference(
    field: ResearchTextField,
    term: str,
    leading: re.Match[str] | None = None,
    trailing: re.Match[str] | None = None,
) -> CriteriaReference:
    phrase = (leading[0] if leading else "") + term + (trailing[0] if trailing else "")
    return CriteriaReference(field=field, matched_text=phrase)


def _derived(value, *references):
    return CriteriaCandidate(value=value, origin="text", references=references)


def _distinct(candidates):
    """Keep first appearance and all references for agreeing text candidates."""
    by_value = {}
    for candidate in candidates:
        if previous := by_value.get(candidate.value):
            candidate = previous.model_copy(
                update={"references": previous.references + candidate.references}
            )
        by_value[candidate.value] = candidate
    return tuple(by_value.values())


class _Resolution:
    def __init__(self, source: ResearchCriteriaInput):
        self.source = source
        self.values = {}
        self.fields = {
            name: CriteriaFieldResolution(state="absent", origin="absent")
            for name in ResolvedResearchCriteria.model_fields
        }
        self.defaults = {}
        self.structured = {}
        self.issues = []
        self.assumptions = []
        for field in get_args(StructuredField):
            value = getattr(source, field)
            origin = source.provenance.get(
                field, "legacy" if value is not None else None
            )
            if origin is None:
                continue
            candidate = CriteriaCandidate(
                value=str(value) if isinstance(value, Decimal) else value,
                origin=origin,
                references=(CriteriaReference(field=field),),
            )
            if origin == "application_default":
                self.defaults[field] = candidate
            if value is not None or origin == "explicit":
                self.structured[field] = candidate

    def set(self, field: CriteriaField, candidate: CriteriaCandidate):
        self.values[field] = candidate.value
        self.fields[field] = CriteriaFieldResolution(
            state="resolved", origin=candidate.origin, references=candidate.references
        )

    def clear(self, field: CriteriaField, state="unresolved", references=()):
        self.values.pop(field, None)
        self.fields[field] = CriteriaFieldResolution(state=state, references=references)

    def issue(
        self,
        code,
        field,
        explanation,
        action,
        *,
        severity="review",
        candidates=(),
        references=(),
    ):
        self.issues.append(
            CriteriaIssue(
                code=code,
                field=field,
                explanation=explanation,
                action=action,
                severity=severity,
                candidates=tuple(c for c in candidates if c is not None),
                references=references,
            )
        )
        if severity != "notice":
            self.clear(
                field, "invalid" if severity == "invalid" else "unresolved", references
            )

    def displaced(self, field, supplied, textual):
        self.issue(
            "application_default_displaced",
            field,
            "The text displaces a known application default.",
            "Use the text-derived interpretation when reviewing the criteria.",
            severity="notice",
            candidates=(supplied, textual),
        )

    def choose(self, field: StructuredField, textual=()):
        textual = _distinct(textual)
        supplied = self.structured.get(field)
        if len(textual) > 1 or (
            supplied
            and supplied.origin != "application_default"
            and textual
            and supplied.value != textual[0].value
        ):
            self.issue(
                "conflicting_criteria",
                field,
                "The supplied requirements give competing interpretations for this field.",
                "Choose the intended value and make the text and structured input agree.",
                candidates=(supplied, *textual),
            )
            return None
        candidate = supplied
        if textual:
            if (
                supplied
                and supplied.value == textual[0].value
                and supplied.origin == "explicit"
            ):
                candidate = supplied.model_copy(
                    update={"references": supplied.references + textual[0].references}
                )
            else:
                candidate = textual[0]
                if (
                    supplied
                    and supplied.origin == "application_default"
                    and supplied.value != candidate.value
                ):
                    self.displaced(field, supplied, candidate)
        if candidate:
            self.set(field, candidate)
        return candidate

    def result(self):
        severity = {issue.severity for issue in self.issues}
        return ResearchCriteriaResolution(
            status="invalid"
            if "invalid" in severity
            else "needs_review"
            if "review" in severity
            else "ready",
            original_input=self.source.model_copy(deep=True),
            criteria=ResolvedResearchCriteria(**self.values),
            fields=self.fields,
            issues=self.issues,
            defaults=self.defaults,
            assumptions=self.assumptions,
        )


def _normalize_days(number: str, factor: int) -> int | str:
    digits = number.lstrip("+-−").lstrip("0") or "0"
    if len(digits) > 9:
        return number
    sign = -1 if number.startswith(("-", "−")) else 1
    return int(digits) * factor * sign


def _resolve_age(resolution: _Resolution):
    field = "max_evidence_age_days"
    supplied = resolution.structured.get(field)
    windows, invalid, vague, unsupported = [], [], [], []
    if (
        supplied
        and supplied.value is not None
        and not MIN_AGE_DAYS <= supplied.value <= MAX_AGE_DAYS
    ):
        invalid.append(supplied)
    for source, text in _texts(resolution.source):
        for match in AGE.finditer(text):
            ref = _reference(source, text, match)
            before, after = _phrase_context(text, match)
            leading = AGE_EXCLUSION_PREFIX.search(before) or NEGATES.search(before)
            trailing = AGE_EXCLUSION_SUFFIX.match(after)
            if leading or trailing:
                unsupported.append(
                    _phrase_reference(source, match[0], leading, trailing)
                )
            elif match.lastgroup == "unrestricted":
                windows.append(_derived(None, ref))
            elif match.lastgroup == "unsupported":
                unsupported.append(ref)
            elif match.lastgroup == "vague":
                vague.append(ref)
            else:
                number = match["en_number"] or match["zh_number"]
                unit = match["en_unit"] or match["zh_unit"]
                factor = (
                    1 if unit.lower().startswith("day") or unit in ("天", "日") else 7
                )
                days = _normalize_days(number, factor)
                candidate = _derived(days, ref)
                if isinstance(days, int) and MIN_AGE_DAYS <= days <= MAX_AGE_DAYS:
                    windows.append(candidate)
                else:
                    invalid.append(candidate)
    windows = _distinct(windows)
    if invalid:
        resolution.issue(
            "age_out_of_range",
            field,
            f"Publication age must be between {MIN_AGE_DAYS} and {MAX_AGE_DAYS} days.",
            "Supply a publication age within that range.",
            severity="invalid",
            candidates=(*invalid, supplied, *windows)
            if supplied not in invalid
            else (*invalid, *windows),
        )
    elif unsupported:
        resolution.issue(
            "unsupported_age",
            field,
            "The publication window is negated, excluded, or outside the supported grammar.",
            "Restate the window as a number of days or weeks, or remove it and supply an explicit limit.",
            candidates=(supplied, *windows),
            references=tuple(unsupported),
        )
    elif vague and not (
        supplied and supplied.origin == "explicit" and supplied.value is not None
    ):
        resolution.issue(
            "vague_age",
            field,
            "The recency wording leaves the intended publication window unclear.",
            "Supply an explicit day limit or revise the recency wording.",
            candidates=(supplied, *windows),
            references=tuple(vague),
        )
    else:
        candidate = resolution.choose(field, windows)
        if candidate and vague:
            resolution.set(
                field,
                candidate.model_copy(
                    update={"references": candidate.references + tuple(vague)}
                ),
            )


def _platform_mentions(resolution: _Resolution):
    positive, negative, uncertain = {}, {}, []
    for source, text in _texts(resolution.source):
        previous = None
        previous_negated = False
        for match in PLATFORM.finditer(text):
            value = "tiktok" if match.lastgroup == "douyin" else match.lastgroup
            ref = _reference(source, text, match)
            prefix, suffix = _phrase_context(text, match)
            prefix = _instruction_prefix(prefix, DELIVERABLE, LANGUAGE, AGE)
            negation = NEGATES.search(prefix)
            unclear_prefix = LOCAL_NEGATION.search(prefix)
            branded_deliverable = DELIVERABLE.match(text, match.start())
            if (
                (negation or unclear_prefix)
                and branded_deliverable
                and branded_deliverable.end() > match.end()
            ):
                # The alias is part of the negated format, such as Instagram Reels.
                # This phrase cannot establish the platform's inclusion or exclusion.
                continue
            unclear_suffix = (
                PLATFORM_EXCEPTION_SUFFIX.match(suffix)
                or PLATFORM_EXCLUSION_SUFFIX.match(suffix)
                or CONDITIONAL_SUFFIX.match(suffix)
            )
            gap = text[previous.end() : match.start()] if previous else ""
            negated_coordination = previous_negated and COORDINATION.fullmatch(gap)
            nested_negation = negation and (
                LOCAL_NEGATION.search(prefix[: negation.start()])
                or NEGATES.search(prefix[: negation.start()])
            )
            if nested_negation:
                uncertain.append(
                    CriteriaReference(
                        field=source,
                        matched_text=prefix[nested_negation.start() :]
                        + match[0]
                        + (unclear_suffix[0] if unclear_suffix else ""),
                    )
                )
            elif unclear_suffix:
                uncertain.append(
                    _phrase_reference(
                        source, match[0], unclear_prefix or negation, unclear_suffix
                    )
                )
            elif negation:
                negative.setdefault(value, []).append(
                    _phrase_reference(source, match[0], negation)
                )
            elif negated_coordination or unclear_prefix:
                uncertain.append(_phrase_reference(source, match[0], unclear_prefix))
            else:
                positive.setdefault(value, []).append((ref, match.start(), match.end()))
            previous, previous_negated = (
                match,
                bool(negation or unclear_prefix or negated_coordination),
            )
    return positive, negative, uncertain


@dataclass(frozen=True)
class _PlatformScope:
    mode: PlatformIntent
    platforms: tuple[Platform, ...]
    reference: CriteriaReference
    primary: Platform | None = None


def _platform_relationship(field: ResearchTextField, text: str, mentions):
    first, last = mentions[0], mentions[-1]
    gaps = [text[left[1] : right[0]] for left, right in zip(mentions, mentions[1:])]
    prefix = _clause_prefix(text[: first[0]])
    order = tuple(mention[2] for mention in mentions)
    comparison = COMPARISON.search(prefix)
    if comparison or any(VERSUS.fullmatch(gap) for gap in gaps):
        if all(COMPARISON_JOIN.fullmatch(gap) for gap in gaps):
            reference = CriteriaReference(
                field=field,
                matched_text=(prefix[comparison.start() :] if comparison else "")
                + text[first[0] : last[1]],
            )
            return _PlatformScope("comparison", order, reference)
        return None
    alternative = ALTERNATIVE_SUFFIX.match(text[last[1] :])
    if (
        len(gaps) == 1
        and alternative
        and (
            MAIN_TO_ALTERNATIVE.fullmatch(gaps[0])
            or ALTERNATIVE_JOIN.fullmatch(gaps[0])
        )
    ):
        reference = CriteriaReference(
            field=field, matched_text=text[first[0] : last[1] + alternative.end()]
        )
        return _PlatformScope("alternatives", order, reference, order[0])
    if all(ALTERNATIVE_JOIN.fullmatch(gap) for gap in gaps) and not any(
        re.search(r"\bwith\b", gap, re.IGNORECASE) for gap in gaps
    ):
        reference = CriteriaReference(
            field=field, matched_text=text[first[0] : last[1]]
        )
        return _PlatformScope("alternatives", order, reference)
    return None


def _text_platform_scopes(source: ResearchCriteriaInput, positive):
    scopes = []
    for field, text in _texts(source):
        mentions = sorted(
            (start, end, platform)
            for platform, appearances in positive.items()
            for ref, start, end in appearances
            if ref.field == field
        )
        groups = []
        for mention in mentions:
            gap = text[groups[-1][-1][1] : mention[0]] if groups else ""
            if gap and (
                COMPARISON_JOIN.fullmatch(gap)
                or ALTERNATIVE_JOIN.fullmatch(gap)
                or MAIN_TO_ALTERNATIVE.fullmatch(gap)
            ):
                groups[-1].append(mention)
            else:
                groups.append([mention])
        for group in groups:
            scope = (
                _platform_relationship(field, text, group) if len(group) > 1 else None
            )
            if scope:
                scopes.append(scope)
            for start, end, platform in group:
                prefix = _clause_prefix(text[:start])
                leading = EXCLUSIVE_PREFIX.search(prefix)
                trailing = EXCLUSIVE_SUFFIX.match(text[end:])
                # In "compare only A and B", only qualifies the comparison list.
                if (
                    leading
                    and scope
                    and scope.mode == "comparison"
                    and start == group[0][0]
                    and COMPARISON.search(prefix[: leading.start()])
                ):
                    leading = None
                if leading or trailing:
                    reference = _phrase_reference(
                        field, text[start:end], leading, trailing
                    )
                    scopes.append(
                        _PlatformScope("single", (platform,), reference, platform)
                    )
    return scopes


def _resolve_platforms(resolution: _Resolution):
    main, alternatives = "platform", "alternative_platforms"
    structured = resolution.structured
    positive, negative, uncertain = _platform_mentions(resolution)
    scopes = _text_platform_scopes(resolution.source, positive)
    scope_sets = {frozenset(scope.platforms) for scope in scopes}
    primaries = {scope.primary for scope in scopes if scope.primary is not None}
    exclusive = tuple(scope.reference for scope in scopes if scope.mode == "single")
    all_positive = frozenset(positive)
    conflict = (
        len(scope_sets) > 1
        or len(primaries) > 1
        or bool(exclusive and all_positive not in scope_sets)
    )
    ambiguous = len(positive) > 3 or (
        len(positive) > 1 and all_positive not in scope_sets
    )
    refs = tuple(ref for appearances in positive.values() for ref, _, _ in appearances)
    scope_refs = tuple(scope.reference for scope in scopes)
    excluded = _derived(
        tuple(negative), *(ref for evidence in negative.values() for ref in evidence)
    )
    if uncertain or conflict or ambiguous:
        offered = [_derived(scope.platforms, scope.reference) for scope in scopes]
        if positive and all_positive not in scope_sets:
            offered.append(_derived(tuple(positive), *refs))
        resolution.issue(
            "conflicting_criteria" if conflict else "ambiguous_platforms",
            main,
            "The platform declarations disagree about the main platform or the allowed scope."
            if conflict
            else "The platform roles or negation are unclear, or more than three platforms are named.",
            "Reconcile the declarations and specify one main platform and the allowed alternatives."
            if conflict
            else "Name one main platform, up to two alternatives, and any exclusions explicitly.",
            candidates=(
                structured.get(main),
                structured.get(alternatives),
                *_distinct(offered),
                excluded if negative else None,
            ),
            references=(*uncertain, *scope_refs),
        )
        resolution.clear(alternatives, references=scope_refs)
        resolution.clear("platform_intent", references=scope_refs)
        if uncertain:
            resolution.clear("excluded_platforms", references=tuple(uncertain))
        elif negative:
            resolution.set("excluded_platforms", excluded)
        return
    if negative:
        resolution.set("excluded_platforms", excluded)

    supplied_main = structured.get(main)
    supplied_alts = structured.get(alternatives)
    mode = None
    if positive:
        scope = next(
            (scope for scope in scopes if scope.mode == "comparison"),
            scopes[0] if scopes else None,
        )
        mode = scope.mode if scope else "single"
        order = scope.platforms if scope else tuple(positive)
        primary = next(iter(primaries)) if primaries else order[0]
        if mode != "single" and not primaries:
            if (
                supplied_main
                and supplied_main.origin != "application_default"
                and supplied_main.value in positive
            ):
                primary = supplied_main.value
            else:
                resolution.assumptions.append(
                    f"The first platform named occupies the main slot for the {mode}."
                )
        named_alts = tuple(platform for platform in order if platform != primary)
        if supplied_alts and set(supplied_alts.value) == set(named_alts):
            named_alts = supplied_alts.value
        resolution.choose(main, (_derived(primary, *(scope_refs or refs)),))
        if (
            mode != "single"
            or (supplied_alts and supplied_alts.origin != "explicit")
            or exclusive
        ):
            resolution.choose(
                alternatives, (_derived(named_alts, *(scope_refs or refs)),)
            )
        else:
            resolution.choose(alternatives)
    else:
        resolution.choose(main)
        resolution.choose(alternatives)

    for field in (main, alternatives):
        selected = resolution.values.get(field)
        selection = (selected,) if field == main else selected or ()
        contradictory_text = field == main and positive.keys() & negative.keys()
        if contradictory_text or any(value in negative for value in selection):
            supplied = structured.get(field)
            if not positive and supplied and supplied.origin == "application_default":
                resolution.displaced(field, supplied, excluded)
                resolution.values.pop(field)
                resolution.fields[field] = CriteriaFieldResolution(
                    state="absent", origin="absent"
                )
                continue
            resolution.issue(
                "excluded_platform_selected",
                field,
                "The same platform is requested and excluded.",
                "Remove the excluded platform from the requested scope or change the exclusion.",
                candidates=(
                    supplied,
                    _derived(tuple(positive), *refs) if positive else None,
                    excluded,
                ),
            )
    if any(
        resolution.fields[field].state == "unresolved" for field in (main, alternatives)
    ):
        resolution.clear(main)
        resolution.clear(alternatives)
        resolution.clear("platform_intent")
        return

    primary = resolution.values.get(main)
    other = resolution.values.get(alternatives) or ()
    if len(set(other)) != len(other) or primary in other:
        resolution.issue(
            "duplicate_platforms",
            alternatives,
            "The main platform and alternatives must be distinct.",
            "Remove duplicate platforms.",
            severity="invalid",
            candidates=(supplied_main, supplied_alts),
        )
        resolution.clear("platform_intent")
    elif other and not primary:
        resolution.issue(
            "main_platform_required",
            main,
            "Alternatives were supplied without a main platform.",
            "Choose a main platform.",
            candidates=(supplied_alts,),
        )
        resolution.clear("platform_intent")
    elif primary:
        origin = resolution.fields[alternatives if other else main]
        resolution.set(
            "platform_intent",
            _derived(mode, *scope_refs)
            if mode == "comparison"
            else CriteriaCandidate(
                value="alternatives" if other else "single",
                origin=origin.origin,
                references=origin.references,
            ),
        )


def _resolve_deliverable(resolution: _Resolution):
    field = "deliverable"
    supplied = resolution.structured.get(field)
    matches, generic, uncertain = [], [], []
    for source, text in _texts(resolution.source):
        for match in DELIVERABLE.finditer(text):
            ref = _reference(source, text, match)
            before, after = _phrase_context(text, match)
            before = _instruction_prefix(before, PLATFORM, LANGUAGE, AGE)
            leading = LOCAL_NEGATION.search(before) or NEGATES.search(before)
            trailing = DELIVERABLE_NEGATION_SUFFIX.match(after)
            if leading or trailing:
                uncertain.append(_phrase_reference(source, match[0], leading, trailing))
            elif match.lastgroup == "generic":
                generic.append(ref)
            else:
                matches.append(_derived(match.lastgroup, ref))
    if uncertain or (
        generic
        and not matches
        and not (
            supplied
            and supplied.origin == "explicit"
            and supplied.value != "social_post"
        )
    ):
        resolution.issue(
            "ambiguous_deliverable",
            field,
            "The wording leaves the deliverable type or its inclusion unclear.",
            "Select the intended deliverable and clarify any exclusions in the text.",
            candidates=(supplied, *_distinct(matches)),
            references=tuple(uncertain + generic),
        )
    else:
        resolution.choose(field, matches)


def _resolve_language(resolution: _Resolution):
    language, strength = "language", "require_language"
    supplied = resolution.structured.get(strength)
    names, strengths, uncertain, qualified = [], [], [], []
    for source, text in _texts(resolution.source):
        for match in LANGUAGE.finditer(text):
            before, after = _phrase_context(text, match)
            before = _instruction_prefix(before, PLATFORM, DELIVERABLE, AGE)
            negation = LANGUAGE_NEGATION_PREFIX.search(before) or NEGATES.search(before)
            exclusion = LANGUAGE_NEGATION_SUFFIX.match(after)
            if match.lastgroup == "unsupported" or negation or exclusion:
                uncertain.append(
                    _phrase_reference(source, match[0], negation, exclusion)
                )
                continue
            prefix, suffix = (
                LANGUAGE_PREFIX.search(before),
                LANGUAGE_SUFFIX.match(after),
            )
            value = "zh-Hant" if match.lastgroup == "traditional" else match.lastgroup
            ref = _reference(source, text, match)
            local_negation = LOCAL_NEGATION.search(before)
            qualifier = LANGUAGE_QUALIFIER_PREFIX.search(before)
            condition = CONDITIONAL_SUFFIX.match(after)
            if local_negation and not (prefix or suffix or qualifier or condition):
                uncertain.append(_phrase_reference(source, match[0], local_negation))
                continue
            names.append(_derived(value, ref))
            if local_negation or qualifier or condition:
                qualified.append(
                    _phrase_reference(
                        source,
                        match[0],
                        local_negation or qualifier,
                        condition or suffix,
                    )
                )
                continue
            if prefix:
                evidence = CriteriaReference(
                    field=source, matched_text=prefix[0] + match[0]
                )
                strengths.append(_derived(prefix.lastgroup == "mandatory", evidence))
            if suffix:
                evidence = CriteriaReference(
                    field=source, matched_text=match[0] + suffix[0]
                )
                strengths.append(_derived(suffix.lastgroup == "mandatory", evidence))
    if uncertain:
        resolution.issue(
            "ambiguous_language",
            language,
            "The language wording contains a negation, an unsupported language, or an unclear condition.",
            "Specify a supported language and whether it is mandatory.",
            candidates=(resolution.structured.get(language), *_distinct(names)),
            references=tuple(uncertain + qualified),
        )
        resolution.clear(strength, references=tuple(qualified))
        return
    resolution.choose(language, names)
    if qualified:
        resolution.issue(
            "ambiguous_language",
            strength,
            "The language requirement is qualified and its strength is unclear.",
            "Specify whether the named language is required, preferred, or unrestricted.",
            candidates=(supplied, *_distinct(strengths)),
            references=tuple(qualified),
        )
    elif names and not strengths and not (supplied and supplied.origin == "explicit"):
        resolution.issue(
            "language_strength_required",
            strength,
            "The text names a language without saying whether it is mandatory or preferred.",
            "Specify whether the language is required or preferred.",
            candidates=(supplied,),
            references=tuple(ref for name in names for ref in name.references),
        )
    else:
        resolution.choose(strength, strengths)
    if (
        resolution.fields[language].state == "unresolved"
        and resolution.fields[strength].state != "unresolved"
    ):
        resolution.clear(strength)
    elif resolution.values.get(strength) and not resolution.values.get(language):
        resolution.issue(
            "language_required",
            language,
            "A mandatory language constraint requires a language.",
            "Supply the required language or remove the mandatory setting.",
            severity="invalid",
            candidates=(supplied,),
        )
        resolution.clear(strength, "invalid")


def _copy_structured_criteria(resolution: _Resolution):
    for field in (
        "market",
        "minimum_market_share",
        "budget_minor",
        "currency",
        "minimum_creators",
        "maximum_creators",
        "required_facts",
        "preferred_facts",
    ):
        resolution.choose(field)
    for dependent, prerequisite, code, name in (
        (
            "minimum_market_share",
            "market",
            "market_required",
            "A minimum audience share",
        ),
        ("budget_minor", "currency", "currency_required", "A budget in minor units"),
    ):
        if (
            resolution.values.get(dependent) is not None
            and resolution.values.get(prerequisite) is None
        ):
            resolution.issue(
                code,
                dependent,
                f"{name} requires a {prerequisite}.",
                f"Supply the {prerequisite}.",
                severity="invalid",
                candidates=(resolution.structured[dependent],),
            )
    low, high = (
        resolution.values.get("minimum_creators"),
        resolution.values.get("maximum_creators"),
    )
    if low is not None and high is not None and low > high:
        resolution.issue(
            "creator_count_order",
            "minimum_creators",
            "The minimum creator count exceeds the maximum.",
            "Supply creator counts in ascending order.",
            severity="invalid",
            candidates=(
                resolution.structured["minimum_creators"],
                resolution.structured["maximum_creators"],
            ),
        )
        resolution.clear("maximum_creators", "invalid")


def resolve_research_criteria(
    source: ResearchCriteriaInput,
) -> ResearchCriteriaResolution:
    """Return a deterministic preview. A ready result represents unambiguous criteria."""
    resolution = _Resolution(source)
    _resolve_age(resolution)
    _resolve_platforms(resolution)
    _resolve_deliverable(resolution)
    _resolve_language(resolution)
    _copy_structured_criteria(resolution)
    return resolution.result()
