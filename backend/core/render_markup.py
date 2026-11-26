from html.parser import HTMLParser

from lxml import html

EMPTY_ICON = {"rel": "icon", "href": "data:,"}


class _IconTokens(HTMLParser):
    CDATA_CONTENT_ELEMENTS = (
        "script",
        "style",
        "title",
        "textarea",
        "noscript",
        "xmp",
        "iframe",
        "noembed",
        "noframes",
    )

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.tokens: list[tuple[int, int, str]] = []
        self.in_head = True
        self.templates = 0

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.in_head = False
        elif tag == "template":
            self.templates += 1
        elif (
            self.in_head
            and not self.templates
            and tag == "link"
            and len(attrs) == 2
            and dict(attrs) == EMPTY_ICON
        ):
            line, column = self.getpos()
            self.tokens.append((line, column, self.get_starttag_text()))

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False
        elif tag == "template" and self.templates:
            self.templates -= 1


def offline_document(text: str, document: html.HtmlElement) -> str:
    icons = [
        node
        for node in document.iterfind("head/link")
        if dict(node.attrib) == EMPTY_ICON
    ]
    if not icons:
        return text
    locator = _IconTokens()
    try:
        locator.feed(text)
        locator.close()
    except (AssertionError, ValueError):
        return text
    if len(locator.tokens) != len(icons):
        return text
    lines = [0]
    lines.extend(index + 1 for index, char in enumerate(text) if char == "\n")
    chunks = []
    previous = 0
    for icon, (line, column, token) in zip(icons, locator.tokens, strict=True):
        if icon.sourceline is None or not line <= icon.sourceline <= line + token.count(
            "\n"
        ):
            return text
        start = lines[line - 1] + column
        if text[start : start + len(token)] != token:
            return text
        chunks.append(text[previous:start])
        previous = start + len(token)
    chunks.append(text[previous:])
    return "".join(chunks)
