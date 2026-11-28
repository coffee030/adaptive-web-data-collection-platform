import socket
from copy import deepcopy
from decimal import Decimal

import pytest
from celery.app.task import Task
from pydantic import ValidationError
from sqlalchemy.engine import Engine

from backend.intelligence.research_contracts import BusinessBrief
from backend.intelligence.research_criteria import resolve_research_criteria
from backend.intelligence.research_criteria_contracts import (
    ResearchCriteriaInput,
    ResearchCriteriaResolution,
)
from backend.intelligence.research_match import evidence_intent


AGE = "max_evidence_age_days"


def resolve(text="", **fields):
    return resolve_research_criteria(
        ResearchCriteriaInput(research_text=text, **fields)
    )


@pytest.mark.parametrize(
    ("text", "days"),
    [
        ("past 30 days", 30),
        ("last 30 days", 30),
        ("previous 30 days", 30),
        ("最近30日", 30),
        ("過去30日", 30),
        ("近30天", 30),
        ("最近 30 天", 30),
        ("Find creators in the LAST\t30  DAYS.", 30),
        ("Within the last 30 days", 30),
        ("找過去　30　日發布的作品", 30),
        ("past 2 weeks", 14),
        ("最近2星期", 14),
        ("過去2週", 14),
        ("Last 1 Week", 7),
        ("過去 2 個星期", 14),
        ("last 1 day", 1),
        ("past 3650 days", 3650),
        ("past 521 weeks", 3647),
    ],
)
def test_numeric_publication_windows(text, days):
    result = resolve(text)
    assert result.status == "ready" and result.issues == ()
    assert result.criteria.max_evidence_age_days == days
    assert result.fields[AGE].origin == "text"
    assert result.fields[AGE].references[0].matched_text in text
    assert result.original_input.research_text == text


def test_duplicate_textual_windows_keep_their_input_references():
    result = resolve("past 2 weeks", discovery_focus="過去14日")
    assert result.status == "ready"
    assert result.criteria.max_evidence_age_days == 14
    assert [
        (reference.field, reference.matched_text)
        for reference in result.fields[AGE].references
    ] == [("research_text", "past 2 weeks"), ("discovery_focus", "過去14日")]


def test_absent_age_is_distinct_from_deliberate_unrestricted_scope():
    absent = resolve("Find creators", max_evidence_age_days=None)
    assert absent.status == "ready"
    assert absent.criteria.max_evidence_age_days is None
    assert (
        absent.fields[AGE].state == "absent" and absent.fields[AGE].origin == "absent"
    )

    unrestricted = resolve(max_evidence_age_days=None, provenance={AGE: "explicit"})
    assert unrestricted.status == "ready"
    assert unrestricted.criteria.max_evidence_age_days is None
    assert unrestricted.fields[AGE].state == "resolved"
    assert unrestricted.fields[AGE].origin == "explicit"

    textual = resolve("不限發布日期")
    assert textual.status == "ready"
    assert textual.criteria.max_evidence_age_days is None
    assert (
        textual.fields[AGE].state == "resolved" and textual.fields[AGE].origin == "text"
    )


@pytest.mark.parametrize("text", ["recent creators", "current posts", "近期", "最近"])
def test_vague_recency_requires_review(text):
    result = resolve(text)
    assert result.status == "needs_review"
    assert result.fields[AGE].state == "unresolved"
    assert result.criteria.max_evidence_age_days is None and result.defaults == {}
    assert [(issue.field, issue.code) for issue in result.issues] == [
        (AGE, "vague_age")
    ]


@pytest.mark.parametrize(
    "text",
    [
        "上個月",
        "last month",
        "since Monday",
        "past two weeks",
        "past 2 months",
        "from 2026-01-01 to 2026-01-31",
        "1 January through 31 January",
        "January 2026",
        "最近三十日",
        "過去兩週",
        "最近３０日",
        "past 1.5 weeks",
        "within thirty days",
        "older than 30 days",
        "past 30 days ago",
        "not past 30 days",
    ],
)
def test_unsupported_windows_are_reviewable(text):
    result = resolve(text, max_evidence_age_days=90, provenance={AGE: "explicit"})
    assert result.status == "needs_review"
    assert result.criteria.max_evidence_age_days is None
    assert result.fields[AGE].state == "unresolved"
    assert result.issues[0].code == "unsupported_age"
    assert result.issues[0].references[0].matched_text in text


@pytest.mark.parametrize(
    ("text", "evidence"),
    [
        (
            "Find posts not published in the last 30 days",
            "not published in the last 30 days",
        ),
        ("Find posts outside the last 30 days", "outside the last 30 days"),
        ("Find posts older than the last 30 days", "older than the last 30 days"),
        ("找最近30日以外的貼文", "最近30日以外"),
        ("不需要限制在最近30日", "不需要限制在最近30日"),
        ("不要不限發布日期", "不要不限發布日期"),
    ],
)
@pytest.mark.parametrize("supplied", [False, True], ids=["text-only", "explicit-age"])
def test_negated_publication_windows_leave_no_effective_age(text, evidence, supplied):
    fields = (
        {"max_evidence_age_days": 30, "provenance": {AGE: "explicit"}}
        if supplied
        else {}
    )
    result = resolve(text, **fields)
    assert result.status == "needs_review"
    assert result.criteria.max_evidence_age_days is None
    field = result.fields[AGE]
    assert field.state == "unresolved" and field.origin is None
    (issue,) = result.issues
    assert (issue.code, issue.field, issue.severity) == (
        "unsupported_age",
        AGE,
        "review",
    )
    assert "Restate the window" in issue.action
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", evidence)
    assert field.references == issue.references
    assert [(candidate.value, candidate.origin) for candidate in issue.candidates] == (
        [(30, "explicit")] if supplied else []
    )
    restored = ResearchCriteriaResolution.model_validate_json(result.model_dump_json())
    assert restored == result


@pytest.mark.parametrize("text", ["no date restriction", "不限發布日期"])
def test_affirmative_unrestricted_wording_is_still_deliberate(text):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.max_evidence_age_days is None
    field = result.fields[AGE]
    assert (field.state, field.origin) == ("resolved", "text")
    assert field.references[0].matched_text == text


@pytest.mark.parametrize(
    ("text", "normalized"),
    [
        ("past 0 days", 0),
        ("last -5 days", -5),
        ("最近−2日", -2),
        ("previous 3651 days", 3651),
        ("past 522 weeks", 3654),
        ("過去522週", 3654),
        ("past 12345678901234567890 days", "12345678901234567890"),
    ],
)
def test_invalid_textual_windows_preserve_the_candidate(text, normalized):
    result = resolve(text)
    assert result.status == "invalid"
    assert result.criteria.max_evidence_age_days is None
    assert result.fields[AGE].state == "invalid"
    (issue,) = result.issues
    assert issue.code == "age_out_of_range"
    assert issue.candidates[0].value == normalized


@pytest.mark.parametrize("days", [0, -1, 3651])
def test_invalid_structured_windows_are_never_displaced_by_text(days):
    result = resolve(
        "past 30 days", max_evidence_age_days=days, provenance={AGE: "explicit"}
    )
    assert result.status == "invalid"
    assert result.criteria.max_evidence_age_days is None
    assert [candidate.value for candidate in result.issues[0].candidates] == [days, 30]


@pytest.mark.parametrize("supplied", [90, None])
def test_structured_and_textual_windows_cannot_override_each_other(supplied):
    result = resolve(
        "past 30 days", max_evidence_age_days=supplied, provenance={AGE: "explicit"}
    )
    assert (
        result.status == "needs_review"
        and result.criteria.max_evidence_age_days is None
    )
    assert result.fields[AGE].state == "unresolved"
    (issue,) = result.issues
    assert issue.code == "conflicting_criteria"
    assert [(item.value, item.origin) for item in issue.candidates] == [
        (supplied, "explicit"),
        (30, "text"),
    ]


def test_two_different_textual_windows_require_review():
    result = resolve("past 30 days or last 2 weeks")
    assert result.status == "needs_review"
    assert result.criteria.max_evidence_age_days is None
    assert [candidate.value for candidate in result.issues[0].candidates] == [30, 14]


def test_explicit_age_settles_vague_recency_but_default_and_legacy_do_not():
    for origin in ("application_default", "legacy", "explicit"):
        result = resolve("近期", max_evidence_age_days=30, provenance={AGE: origin})
        if origin == "explicit":
            assert result.status == "ready"
            assert result.criteria.max_evidence_age_days == 30
            assert result.fields[AGE].origin == "explicit"
            assert result.fields[AGE].references[-1].matched_text == "近期"
        else:
            assert result.status == "needs_review"
            assert result.criteria.max_evidence_age_days is None
            assert result.issues[0].candidates[0].origin == origin


def test_explicit_platform_conflict_preserves_both_candidates():
    result = resolve(
        "Find YouTube creators",
        platform="instagram",
        provenance={"platform": "explicit"},
    )
    assert result.status == "needs_review"
    assert result.criteria.platform is None and result.criteria.platform_intent is None
    assert result.fields["platform"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("conflicting_criteria", "platform")
    assert [(item.value, item.origin) for item in issue.candidates] == [
        ("instagram", "explicit"),
        ("youtube", "text"),
    ]


@pytest.mark.parametrize(
    ("main", "alt"), [("youtube", "instagram"), ("instagram", "youtube")]
)
def test_compatible_explicit_comparison_is_independent_of_text_order(main, alt):
    result = resolve(
        "Compare YouTube and Instagram",
        platform=main,
        alternative_platforms=[alt],
        provenance={"platform": "explicit", "alternative_platforms": "explicit"},
    )
    assert result.status == "ready" and result.assumptions == ()
    assert result.criteria.platform_intent == "comparison"
    assert (
        result.criteria.platform == main
        and result.criteria.alternative_platforms == (alt,)
    )
    assert result.fields["platform"].origin == "explicit"
    assert result.fields["alternative_platforms"].origin == "explicit"


def test_comparison_uses_phrase_order_and_does_not_invent_channels():
    result = resolve("Focus on IG", discovery_focus="比較YouTube和IG")
    assert result.status == "ready" and result.criteria.platform_intent == "comparison"
    assert result.criteria.platform == "youtube"
    assert result.criteria.alternative_platforms == ("instagram",)
    assert result.assumptions

    result = resolve("Find YouTube creators")
    assert result.status == "ready" and result.criteria.platform_intent == "single"
    assert result.criteria.alternative_platforms is None


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        (
            "YouTube as the main platform, with Instagram as an alternative",
            "Instagram as the main platform, with YouTube as an alternative",
            (("youtube", "instagram"), ("instagram", "youtube")),
        ),
        (
            "Only YouTube",
            "Compare YouTube and Instagram",
            (("youtube",), ("youtube", "instagram")),
        ),
    ],
    ids=["contradictory-roles", "exclusive-versus-comparison"],
)
@pytest.mark.parametrize(
    ("left_field", "right_field"),
    [
        ("research_text", "discovery_focus"),
        ("discovery_focus", "research_text"),
        ("product", "discovery_focus"),
        ("discovery_focus", "product"),
    ],
)
def test_platform_scope_conflicts_are_reconciled_across_fields(
    left, right, expected, left_field, right_field
):
    source = ResearchCriteriaInput(**{left_field: left, right_field: right})
    result = resolve_research_criteria(source)
    assert result.status == "needs_review" and result.assumptions == ()
    for name in ("platform", "alternative_platforms", "platform_intent"):
        assert getattr(result.criteria, name) is None
        assert result.fields[name].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field, issue.severity) == (
        "conflicting_criteria",
        "platform",
        "review",
    )
    assert "Reconcile the declarations" in issue.action
    assert {(ref.field, ref.matched_text) for ref in issue.references} == {
        (left_field, left),
        (right_field, right),
    }
    assert {(candidate.value, candidate.origin) for candidate in issue.candidates} == {
        (value, "text") for value in expected
    }
    for candidate in issue.candidates:
        (reference,) = candidate.references
        assert (reference.field, reference.matched_text) == (
            (left_field, left)
            if candidate.value == expected[0]
            else (right_field, right)
        )
    assert (
        ResearchCriteriaResolution.model_validate_json(result.model_dump_json())
        == result
    )
    assert (
        resolve_research_criteria(source).model_dump_json() == result.model_dump_json()
    )


def test_conflicting_main_roles_in_separate_clauses_are_both_retained():
    first = "YouTube as the main platform, with Instagram as an alternative"
    second = "Instagram as the main platform, with YouTube as an alternative"
    result = resolve(f"{first}. {second}.")
    assert result.status == "needs_review" and result.criteria.platform is None
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("conflicting_criteria", "platform")
    assert [ref.matched_text for ref in issue.references] == [first, second]


def test_compatible_comparison_uses_the_declared_main_without_an_ordering_assumption():
    result = resolve(
        "Compare only YouTube and Instagram",
        discovery_focus="Instagram as the main platform, with YouTube as an alternative",
    )
    assert result.status == "ready" and result.assumptions == ()
    assert result.criteria.platform == "instagram"
    assert result.criteria.alternative_platforms == ("youtube",)
    assert result.criteria.platform_intent == "comparison"
    assert result.fields["platform"].origin == "text"
    assert {ref.field for ref in result.fields["platform"].references} == {
        "research_text",
        "discovery_focus",
    }


@pytest.mark.parametrize(
    "text",
    [
        "YouTube or Instagram",
        "YouTube as the main platform, with Instagram as an alternative",
        "YouTube為主，IG為備選",
    ],
)
def test_clear_alternatives_are_distinct_from_a_comparison(text):
    result = resolve(text)
    assert result.status == "ready"
    assert result.criteria.platform_intent == "alternatives"
    assert result.criteria.platform == "youtube"
    assert result.criteria.alternative_platforms == ("instagram",)


def test_an_explicit_alternative_can_accompany_one_affirmative_mention():
    result = resolve(
        "Find YouTube creators",
        alternative_platforms=["instagram"],
        provenance={"alternative_platforms": "explicit"},
    )
    assert result.status == "ready"
    assert result.criteria.platform_intent == "alternatives"
    assert result.criteria.alternative_platforms == ("instagram",)


@pytest.mark.parametrize("text", ["Only YouTube", "YouTube only", "只限YouTube"])
def test_exclusive_platform_wording_conflicts_with_structured_alternatives(text):
    result = resolve(
        text,
        alternative_platforms=["instagram"],
        provenance={"alternative_platforms": "explicit"},
    )
    assert result.status == "needs_review"
    assert (
        result.criteria.platform is None
        and result.criteria.alternative_platforms is None
    )
    (issue,) = result.issues
    assert (
        issue.field == "alternative_platforms" and issue.code == "conflicting_criteria"
    )
    assert [candidate.value for candidate in issue.candidates] == [("instagram",), ()]


def test_defaults_displace_with_evidence_and_legacy_is_never_explicit():
    result = resolve(
        "Find YouTube creators making short videos",
        platform="instagram",
        deliverable="social_post",
        provenance={
            "platform": "application_default",
            "deliverable": "application_default",
        },
    )
    assert result.status == "ready"
    assert (
        result.criteria.platform == "youtube"
        and result.criteria.deliverable == "short_video"
    )
    assert (
        result.fields["platform"].origin
        == result.fields["deliverable"].origin
        == "text"
    )
    assert {field: candidate.value for field, candidate in result.defaults.items()} == {
        "platform": "instagram",
        "deliverable": "social_post",
    }
    assert {issue.code for issue in result.issues} == {"application_default_displaced"}
    assert all(issue.severity == "notice" for issue in result.issues)

    unused = resolve(
        platform="instagram", provenance={"platform": "application_default"}
    )
    assert unused.criteria.platform == "instagram"
    assert unused.fields["platform"].origin == "application_default"
    legacy = resolve(platform="instagram")
    assert (
        legacy.criteria.platform == "instagram"
        and legacy.fields["platform"].origin == "legacy"
    )
    conflict = resolve("Find YouTube creators", platform="instagram")
    assert conflict.status == "needs_review"
    assert [item.origin for item in conflict.issues[0].candidates] == ["legacy", "text"]


@pytest.mark.parametrize(
    "text",
    [
        "Find YouTube creators, not Instagram.",
        "找 YouTube 創作者，不要 IG。",
        "找YouTube創作者，不要IG。",
    ],
)
def test_platform_negation_is_not_an_affirmative_target(text):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.platform == "youtube"
    assert result.criteria.platform_intent == "single"
    assert result.criteria.alternative_platforms is None
    assert result.criteria.excluded_platforms == ("instagram",)
    assert result.fields["excluded_platforms"].references[0].matched_text in text


def test_chinese_platform_exception_does_not_exclude_the_named_platform():
    text = "不要 IG 以外的平台"
    result = resolve(text)
    assert result.status == "needs_review"
    for name in (
        "platform",
        "alternative_platforms",
        "platform_intent",
        "excluded_platforms",
    ):
        assert getattr(result.criteria, name) is None
        assert result.fields[name].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_platforms", "platform")
    assert "exclusions explicitly" in issue.action and issue.candidates == ()
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)
    assert result.fields["excluded_platforms"].references == issue.references


def test_excluding_an_explicit_alternative_requires_review():
    result = resolve(
        "Find YouTube creators, not Instagram.",
        platform="youtube",
        alternative_platforms=["instagram"],
        provenance={"platform": "explicit", "alternative_platforms": "explicit"},
    )
    assert result.status == "needs_review"
    assert (
        result.criteria.platform is None
        and result.criteria.alternative_platforms is None
    )
    assert result.criteria.excluded_platforms == ("instagram",)
    assert result.issues[0].code == "excluded_platform_selected"


@pytest.mark.parametrize(
    "text",
    [
        "Find YouTube creators on Instagram",
        "Not only YouTube but also Instagram",
        "Find creators, not Instagram or TikTok",
        "Find creators, don't exclude Instagram",
        "Instagram is not allowed",
        "Instagram not an alternative",
        "IG除外",
        "Compare YouTube or Instagram",
        "Compare YouTube, Instagram, Facebook and TikTok",
    ],
)
def test_unclear_platform_scope_requires_review(text):
    result = resolve(text)
    assert result.status == "needs_review"
    assert result.criteria.platform is None
    assert result.issues[0].code == "ambiguous_platforms"


def test_platform_aliases_respect_latin_word_boundaries():
    assert resolve("Find big Facebookish creators").fields["platform"].state == "absent"
    assert resolve("Find creators on FB").criteria.platform == "facebook"
    assert resolve("找抖音創作者").criteria.platform == "tiktok"


@pytest.mark.parametrize(
    "text",
    [
        "Do not include Instagram",
        "Don't include Instagram",
        "Don’t automatically recommend Instagram",
        "Do not include or recommend Instagram",
        "Do not instead promote Instagram",
    ],
)
def test_negative_platform_instruction_does_not_select_its_named_platform(text):
    result = resolve(text)
    assert result.status == "needs_review"
    for name in (
        "platform",
        "alternative_platforms",
        "platform_intent",
        "excluded_platforms",
    ):
        assert getattr(result.criteria, name) is None
        assert result.fields[name].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field, issue.severity) == (
        "ambiguous_platforms",
        "platform",
        "review",
    )
    assert "exclusions explicitly" in issue.action and issue.candidates == ()
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)


@pytest.mark.parametrize("origin", ["explicit", "application_default"])
def test_negative_platform_instruction_keeps_structured_selection_in_review(origin):
    text = "Do not include Instagram"
    result = resolve(text, platform="instagram", provenance={"platform": origin})
    assert result.status == "needs_review" and result.criteria.platform is None
    assert result.criteria.excluded_platforms is None
    assert result.fields["platform"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_platforms", "platform")
    assert issue.references[0].matched_text == text
    (candidate,) = issue.candidates
    assert (candidate.value, candidate.origin) == ("instagram", origin)
    assert candidate.references[0].field == "platform"
    assert result.defaults == (
        {"platform": candidate} if origin == "application_default" else {}
    )


def test_affirmative_platform_instruction_resolves_with_text_provenance():
    result = resolve("Include Instagram")
    assert result.status == "ready" and result.criteria.platform == "instagram"
    assert result.criteria.platform_intent == "single"
    assert result.criteria.excluded_platforms is None
    assert result.fields["platform"].origin == "text" and result.issues == ()


@pytest.mark.parametrize(
    ("text", "deliverable"),
    [
        ("Find short-form videos", "short_video"),
        ("研究短影音", "short_video"),
        ("Plan a dedicated sponsorship video", "dedicated_video"),
        ("Plan a video integration", "video_integration"),
        ("Plan a social media post", "social_post"),
    ],
)
def test_clear_deliverables(text, deliverable):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.deliverable == deliverable
    assert result.fields["deliverable"].origin == "text"


def test_generic_and_conflicting_deliverables_do_not_imply_dedicated_video():
    generic = resolve("Find video creators")
    assert generic.status == "needs_review" and generic.criteria.deliverable is None
    assert generic.issues[0].code == "ambiguous_deliverable"
    supplied = resolve(
        "Find video creators",
        deliverable="short_video",
        provenance={"deliverable": "explicit"},
    )
    assert supplied.status == "ready" and supplied.criteria.deliverable == "short_video"
    conflict = resolve(
        "Find a short video",
        deliverable="social_post",
        provenance={"deliverable": "explicit"},
    )
    assert conflict.status == "needs_review" and conflict.criteria.deliverable is None
    assert [candidate.value for candidate in conflict.issues[0].candidates] == [
        "social_post",
        "short_video",
    ]


@pytest.mark.parametrize("text", ["不用短片", "不做短片", "Rather than a short video"])
@pytest.mark.parametrize(
    "supplied", [False, True], ids=["text-only", "explicit-deliverable"]
)
def test_negated_short_video_does_not_agree_with_an_affirmative_deliverable(
    text, supplied
):
    fields = (
        {"deliverable": "short_video", "provenance": {"deliverable": "explicit"}}
        if supplied
        else {}
    )
    result = resolve(text, **fields)
    assert result.status == "needs_review" and result.criteria.deliverable is None
    assert result.fields["deliverable"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_deliverable", "deliverable")
    assert "clarify any exclusions" in issue.action
    assert [(candidate.value, candidate.origin) for candidate in issue.candidates] == (
        [("short_video", "explicit")] if supplied else []
    )
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)


@pytest.mark.parametrize(
    "text",
    [
        "Do not create short videos",
        "Do not commission polished short videos",
        "Don't plan to create and then produce short videos",
    ],
)
def test_negative_deliverable_instruction_keeps_negation_through_unknown_words(text):
    result = resolve(text)
    assert result.status == "needs_review" and result.criteria.deliverable is None
    assert result.fields["deliverable"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field, issue.severity) == (
        "ambiguous_deliverable",
        "deliverable",
        "review",
    )
    assert "clarify any exclusions" in issue.action and issue.candidates == ()
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)


def test_negative_delivery_instruction_preserves_explicit_deliverable_as_candidate():
    text = "Do not create short videos"
    result = resolve(
        text, deliverable="short_video", provenance={"deliverable": "explicit"}
    )
    assert result.status == "needs_review" and result.criteria.deliverable is None
    assert result.fields["deliverable"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_deliverable", "deliverable")
    assert issue.references[0].matched_text == text
    (candidate,) = issue.candidates
    assert (candidate.value, candidate.origin) == ("short_video", "explicit")
    assert candidate.references[0].field == "deliverable"


@pytest.mark.parametrize(
    "text", ["Create short videos", "Commission polished short videos"]
)
def test_affirmative_deliverable_instruction_resolves_with_text_provenance(text):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.deliverable == "short_video"
    assert result.fields["deliverable"].origin == "text" and result.issues == ()


@pytest.mark.parametrize(
    ("text", "language", "mandatory"),
    [
        ("Creators must speak Cantonese", "yue", True),
        ("必須使用粵語", "yue", True),
        ("Cantonese is required", "yue", True),
        ("Prefer Cantonese creators", "yue", False),
        ("廣東話優先", "yue", False),
        ("偏好粵語", "yue", False),
        ("Traditional Chinese preferred", "zh-Hant", False),
        ("English only", "en", True),
    ],
)
def test_mandatory_and_preferred_language(text, language, mandatory):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.language == language
    assert result.criteria.require_language is mandatory
    assert result.fields["require_language"].origin == "text"


def test_uncertain_language_strength_does_not_become_mandatory_or_preferred():
    result = resolve(
        "Find Cantonese creators",
        require_language=False,
        provenance={"require_language": "application_default"},
    )
    assert result.status == "needs_review"
    assert (
        result.criteria.language == "yue" and result.criteria.require_language is None
    )
    assert result.issues[0].code == "language_strength_required"
    for text in ("Cantonese is not required", "Prefer Mandarin"):
        result = resolve(text)
        assert result.status == "needs_review"
        assert (
            result.criteria.language is None
            and result.criteria.require_language is None
        )
        assert result.issues[0].code == "ambiguous_language"


@pytest.mark.parametrize("text", ["不一定要講粵語", "Cantonese only if available"])
@pytest.mark.parametrize(
    "supplied", [False, True], ids=["text-only", "explicit-strength"]
)
def test_qualified_language_keeps_identity_and_leaves_strength_unresolved(
    text, supplied
):
    fields = (
        {"require_language": True, "provenance": {"require_language": "explicit"}}
        if supplied
        else {}
    )
    result = resolve(text, **fields)
    assert result.status == "needs_review" and result.criteria.language == "yue"
    assert result.fields["language"].origin == "text"
    assert result.criteria.require_language is None
    assert result.fields["require_language"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_language", "require_language")
    assert "required, preferred, or unrestricted" in issue.action
    assert [(candidate.value, candidate.origin) for candidate in issue.candidates] == (
        [(True, "explicit")] if supplied else []
    )
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)
    assert result.fields["require_language"].references == issue.references


@pytest.mark.parametrize(
    "text",
    [
        "Do not require Cantonese",
        "Not mandatory Cantonese",
        "Do not prefer Cantonese",
        "Do not automatically require Cantonese",
        "Don't make Cantonese mandatory",
    ],
)
def test_negated_language_strength_preserves_the_name_without_settling_strength(text):
    result = resolve(text)
    assert result.status == "needs_review" and result.criteria.language == "yue"
    assert result.fields["language"].origin == "text"
    assert result.criteria.require_language is None
    assert result.fields["require_language"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field, issue.severity) == (
        "ambiguous_language",
        "require_language",
        "review",
    )
    assert (
        "required, preferred, or unrestricted" in issue.action
        and issue.candidates == ()
    )
    (reference,) = issue.references
    assert (reference.field, reference.matched_text) == ("research_text", text)


def test_negated_language_strength_preserves_explicit_requirement_as_candidate():
    text = "Do not require Cantonese"
    result = resolve(
        text,
        language="yue",
        require_language=True,
        provenance={"language": "explicit", "require_language": "explicit"},
    )
    assert result.status == "needs_review" and result.criteria.language == "yue"
    assert result.fields["language"].origin == "explicit"
    assert result.criteria.require_language is None
    assert result.fields["require_language"].state == "unresolved"
    (issue,) = result.issues
    assert (issue.code, issue.field) == ("ambiguous_language", "require_language")
    assert issue.references[0].matched_text == text
    (candidate,) = issue.candidates
    assert (candidate.value, candidate.origin) == (True, "explicit")
    assert candidate.references[0].field == "require_language"
    assert (
        ResearchCriteriaResolution.model_validate_json(result.model_dump_json())
        == result
    )


@pytest.mark.parametrize(
    ("text", "required"),
    [
        ("Require Cantonese", True),
        ("Mandatory Cantonese", True),
        ("Prefer Cantonese", False),
    ],
)
def test_affirmative_language_strength_resolves_with_text_provenance(text, required):
    result = resolve(text)
    assert result.status == "ready" and result.criteria.language == "yue"
    assert result.criteria.require_language is required
    assert result.fields["require_language"].origin == "text" and result.issues == ()


@pytest.mark.parametrize(
    ("text", "unresolved", "unaffected", "value"),
    [
        (
            "Do not include Instagram and create short videos",
            "platform",
            "deliverable",
            "short_video",
        ),
        (
            "Do not create short videos and require Cantonese",
            "deliverable",
            "require_language",
            True,
        ),
        (
            "Do not require Cantonese and include Instagram",
            "require_language",
            "platform",
            "instagram",
        ),
        (
            "Include Instagram but do not create Instagram Reels",
            "deliverable",
            "platform",
            "instagram",
        ),
    ],
)
def test_local_negation_preserves_a_separate_affirmative_instruction(
    text, unresolved, unaffected, value
):
    result = resolve(text)
    assert result.status == "needs_review"
    assert getattr(result.criteria, unresolved) is None
    assert result.fields[unresolved].state == "unresolved"
    assert getattr(result.criteria, unaffected) == value
    assert result.fields[unaffected].origin == "text"
    assert [issue.field for issue in result.issues] == [unresolved]


def test_unrestricted_age_phrase_is_not_a_platform_negation():
    result = resolve("No date restriction for Instagram")
    assert result.status == "ready" and result.criteria.platform == "instagram"
    assert result.criteria.max_evidence_age_days is None
    assert (result.fields[AGE].state, result.fields[AGE].origin) == ("resolved", "text")


def test_negated_window_leaves_local_platform_and_deliverable_intact():
    result = resolve("Find YouTube short videos not published in the last 30 days")
    assert result.status == "needs_review"
    assert result.criteria.platform == "youtube"
    assert result.criteria.deliverable == "short_video"
    assert result.criteria.max_evidence_age_days is None
    assert [(issue.code, issue.field) for issue in result.issues] == [
        ("unsupported_age", AGE)
    ]


def test_local_platform_exclusion_leaves_age_and_deliverable_intact():
    result = resolve(
        "Find creators on YouTube, not on Instagram and look for short videos from the last 30 days."
    )
    assert result.status == "ready"
    assert result.criteria.platform == "youtube"
    assert result.criteria.excluded_platforms == ("instagram",)
    assert result.criteria.deliverable == "short_video"
    assert result.criteria.max_evidence_age_days == 30


def test_language_and_strength_conflicts_are_visible():
    result = resolve(
        "Must use Cantonese", language="en", provenance={"language": "explicit"}
    )
    assert result.criteria.language is None and result.criteria.require_language is None
    assert result.status == "needs_review" and result.issues[0].field == "language"

    result = resolve(
        "Prefer Cantonese",
        language="yue",
        require_language=True,
        provenance={"language": "explicit", "require_language": "explicit"},
    )
    assert result.status == "needs_review" and result.criteria.language == "yue"
    assert (
        result.criteria.require_language is None
        and result.issues[0].field == "require_language"
    )


def test_structured_business_constraints_are_preserved_without_text_extraction():
    source = {
        "language": "zh-Hant",
        "require_language": True,
        "market": "HK",
        "minimum_market_share": "0.25",
        "budget_minor": 0,
        "currency": "HKD",
        "minimum_creators": 2,
        "maximum_creators": 5,
        "required_facts": ["approved_fact"],
        "preferred_facts": ["extra_fact"],
    }
    result = resolve(
        "HKD 50000 for 20 creators and 30% Hong Kong audience",
        **source,
        provenance={key: "explicit" for key in source},
    )
    assert result.status == "ready"
    assert result.criteria.model_dump(mode="json", exclude_none=True) == source
    assert result.criteria.minimum_market_share == Decimal("0.25")
    assert all(result.fields[key].origin == "explicit" for key in source)

    result = resolve("HKD 50000 for 20 creators and 30% Hong Kong audience")
    assert result.criteria.model_dump(exclude_none=True) == {}

    default = resolve(
        market="HK",
        minimum_market_share="0.25",
        provenance={"minimum_market_share": "application_default"},
    )
    assert default.criteria.minimum_market_share == Decimal("0.25")
    assert default.defaults["minimum_market_share"].value == "0.25"
    assert (
        ResearchCriteriaResolution.model_validate_json(default.model_dump_json())
        == default
    )


@pytest.mark.parametrize(
    ("fields", "code"),
    [
        ({"minimum_market_share": "0.5"}, "market_required"),
        ({"budget_minor": 10000}, "currency_required"),
        ({"require_language": True}, "language_required"),
        ({"minimum_creators": 3, "maximum_creators": 2}, "creator_count_order"),
        (
            {"platform": "youtube", "alternative_platforms": ["youtube"]},
            "duplicate_platforms",
        ),
    ],
)
def test_structured_cross_field_validation(fields, code):
    result = resolve(**fields)
    assert result.status == "invalid"
    assert result.issues[0].code == code
    assert result.fields[result.issues[0].field].state == "invalid"


@pytest.mark.parametrize(
    "fields",
    [
        {"platform": "peertube"},
        {"budget_minor": -1},
        {"currency": "hkd"},
        {"minimum_creators": 9},
        {"minimum_market_share": "1.1"},
        {"required_facts": ["unknown fact id"]},
        {"max_evidence_age_days": "30"},
        {"provenance": {AGE: "explicit"}},
    ],
)
def test_malformed_structured_input_is_rejected_at_validation(fields):
    with pytest.raises(ValidationError):
        ResearchCriteriaInput.model_validate(fields)


def test_determinism_serialization_no_input_mutation_or_external_calls(monkeypatch):
    raw = {
        "research_text": "  Find YouTube creators from the past 30 days. ",
        "max_evidence_age_days": 90,
        "required_facts": ["first_party"],
        "provenance": {AGE: "explicit"},
    }
    saved = deepcopy(raw)
    source = ResearchCriteriaInput.model_validate(raw)
    snapshot = source.model_dump_json()

    def unexpected(*args, **kwargs):
        pytest.fail("Criteria resolution attempted external I/O")

    with monkeypatch.context() as patch:
        patch.setattr(socket, "socket", unexpected)
        patch.setattr(Engine, "connect", unexpected)
        patch.setattr(Task, "apply_async", unexpected)
        first = resolve_research_criteria(source)
        second = resolve_research_criteria(source)
    assert first.status == "needs_review"
    assert first.criteria.platform == "youtube"
    assert first.criteria.max_evidence_age_days is None
    assert first.model_dump_json() == second.model_dump_json()
    assert (
        ResearchCriteriaResolution.model_validate_json(first.model_dump_json()) == first
    )
    assert first.model_dump(mode="json")["issues"][0]["candidates"][0]["value"] == 90
    assert raw == saved and source.model_dump_json() == snapshot
    first.original_input.provenance.clear()
    assert source.provenance == {AGE: "explicit"}


@pytest.mark.parametrize(
    ("text", "legacy_days", "new_days"),
    [
        ("past 30 days", 30, 30),
        ("最近30日", 90, 30),
        ("過去30日", None, 30),
        ("past 2 months", 60, None),
    ],
)
def test_legacy_age_and_brief_serialization_remain_compatible(
    text, legacy_days, new_days
):
    brief = BusinessBrief.model_validate(
        {
            "campaign": {
                "description": text,
                "objective": "awareness",
                "budget_minor": 120000,
                "currency": "HKD",
                "platform": "instagram",
                "deliverable": "social_post",
            },
            "product": "Neighbourhood café lunch",
            "audience": "Hong Kong weekday diners",
        }
    )
    assert evidence_intent(brief, "")["days"] == legacy_days
    assert resolve(text).criteria.max_evidence_age_days == new_days
    assert brief.model_dump(mode="json") == {
        "campaign": {
            "description": text,
            "objective": "awareness",
            "budget_minor": 120000,
            "currency": "HKD",
            "platform": "instagram",
            "deliverable": "social_post",
            "market": None,
            "minimum_market_share": None,
            "language": None,
            "require_language": False,
            "required_facts": [],
            "preferred_facts": [],
            "minimum_creators": 1,
            "maximum_creators": 4,
            "shortlist": None,
            "category_labels": None,
        },
        "product": "Neighbourhood café lunch",
        "audience": "Hong Kong weekday diners",
        "discovery_focus": None,
        "test_share": 60,
        "alternative_platforms": [],
        "scenario": None,
        "discovery_scope": "campaign_channels",
        "max_evidence_age_days": None,
    }
    with pytest.raises(ValidationError):
        BusinessBrief.model_validate({**brief.model_dump(), "provenance": {}})
