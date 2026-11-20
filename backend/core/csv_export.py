"""Text escaping shared by CSV export and its offline verifier."""

import re


_FORMULA_PREFIX = re.compile(
    r"^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]*[=+\-@＝＋－＠]|^[^\S\t\r\n]*[\t\r\n]"
)


def protect_csv_text(value: str) -> str:
    return "'" + value if _FORMULA_PREFIX.match(value) else value
