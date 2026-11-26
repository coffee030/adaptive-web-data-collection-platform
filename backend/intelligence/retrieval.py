"""Source-grounded multilingual retrieval for the eligible campaign catalog."""

import re
from pathlib import Path
from statistics import median

from .catalog import EligibleContent
from .semantic import character_grams, embed, normalized, tfidf_scores

TOPICS = {
    "beauty": "beauty cosmetics skincare makeup spf sunscreen moisturiser moisturizer creams fragrance-free 美容 保養 化妝 防曬 護膚 保濕 面霜",
    "budget": "affordable affordability budget cheap inexpensive low-cost low-budget budget-friendly bargains 慳錢 平價 便宜 實惠 抵食 經濟實惠",
    "dining": "dining restaurants restaurant cafés café cafe cafes food brunch lunch lunches dinner meals eateries noodle noodles eats dining-out 食店 飲食 美食 咖啡 espresso coffee pourover 茶記 茶餐廳 餐廳 咖啡 午餐 街坊粉麵 粉麵檔 食飯 快餐 用餐 點心",
    "family": "family children childcare parents pushchair stroller strollers highchairs 親子 家庭 小朋友 嬰兒車 兒童",
    "finance": "finance banking bank investments investing credit mortgage 理財 儲蓄 銀行 投資 股票",
    "lifestyle": "lifestyle routines homeware interiors 家居 生活 收納",
    "outdoors": "outdoors hiking hikes mountaineering ridge hiking camping trails trail nature 郊遊 戶外 行山 公園 露營",
    "sustainability": "sustainable sustainability reuse repair recycling secondhand 環保 回收 二手 維修",
    "technology": "technology tech software devices laptop keyboard computer computers 科技 軟件 電腦 設備",
}
SUBJECTS = {
    "sun_protection": "sunscreen spf sunblock 防曬 防晒",
    "coffee": "coffee espresso pourover 咖啡 手沖",
    "mountaineering": "mountaineering climbing scrambling 攀山 攀澗",
    "pushchair": "stroller strollers pushchair 推車 嬰兒車",
    "vegetarian": "vegetarian vegan plant-based 素食 全素",
}
_NOISE = frozenset(
    "a an the of in for around and or on to at with by from local hong kong hk find who posts post about creators creator cover covers campaign cantonese english traditional chinese video videos required hongkong dedicated hong-kong guide guides that will brand our your their we with would like want reach is are local target launch promote promotion looking features".split()
)
_WORD = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*|[\u3400-\u9fff]+")
_ALIAS = {
    label: re.compile(
        "|".join(
            re.escape(term)
            if not term.isascii()
            else rf"(?<![a-z]){re.escape(term)}(?![a-z])"
            for term in sorted(terms.split(), key=len, reverse=True)
        )
    )
    for label, terms in (TOPICS | SUBJECTS).items()
}


def query_topics(query: str) -> frozenset[str]:
    without_cap = re.sub(
        r"\b(?:campaign |total )?budget(?: cap)?(?: of| is| up to| under| at| around)?\s*(?:hk[d$]|hkd|[$])?\s*[0-9][\d,.]*",
        " ",
        normalized(query),
    )
    return topics(without_cap)


def topics(text: str) -> frozenset[str]:
    text = normalized(text.replace("_", " "))
    return frozenset(label for label, pattern in _ALIAS.items() if pattern.search(text))


def required_words(query: str) -> list[str]:
    text = normalized(query)
    for pattern in _ALIAS.values():
        text = pattern.sub(" ", text)
    for word in ("香港", "本地", "介紹", "想搵", "有關"):
        text = text.replace(word, " ")
    return [
        word for word in _WORD.findall(text) if len(word) >= 2 and word not in _NOISE
    ]


def contains_word(text: str, word: str) -> bool:
    return (
        word in text
        if not word.isascii()
        else bool(re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", text))
    )


def post_terms(post: EligibleContent) -> str:
    data = post.record.data
    return normalized(" ".join([data.text, *data.reviewed_facts]).replace("_", " "))


def scores(query: str, posts: list[EligibleContent], model_dir: Path | None):
    vectors = {post.key: post.vector for post in posts if post.vector is not None}
    if (
        vectors
        and len(vectors) == len({post.key for post in posts})
        and (encoded := embed(model_dir, [query]))
    ):
        return "granite_int8", {
            key: max(
                0.0,
                min(1.0, sum(a * b for a, b in zip(encoded[0], vector, strict=True))),
            )
            for key, vector in vectors.items()
        }
    grams = {
        post.key: character_grams(
            post_terms(post) + " " + " ".join(sorted(topics(post_terms(post))))
        )
        for post in posts
    }
    expanded = query + " " + " ".join(sorted(topics(query)))
    return "character_tfidf", tfidf_scores(expanded, grams)


def semantic_support(method: str, similarities: dict[str, float]) -> set[str]:
    if method != "granite_int8" or len(similarities) < 5:
        return set()
    cutoff = max(0.82, median(similarities.values()) + 0.13)
    return {key for key, similarity in similarities.items() if similarity >= cutoff}


def evidence_match(
    post: EligibleContent,
    query_topics: frozenset[str],
    words: list[str],
    *,
    all_terms: bool,
):
    text = post_terms(post)
    supported = topics(text)
    if all_terms:
        return (
            bool(query_topics or words)
            and query_topics <= supported
            and all(contains_word(text, word) for word in words)
        )
    if query_topics:
        return query_topics <= supported and (
            len(words) != 1 or contains_word(text, words[0])
        )
    return bool(words) and all(contains_word(text, word) for word in words)
