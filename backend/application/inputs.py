"""Accept controlled fixture URLs, keywords, or bounded inline CSV datasets."""

from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from backend.core.contracts import (
    Configuration,
    Contract,
    ExtractionConfiguration,
    Name,
    Source,
)
from backend.core.csv_adapter import MAX_INPUT_BYTES, capture_csv
from backend.core.inputs import CsvInput, InputError, KeywordInput, WebInput
from backend.core.runner import CollectionInput
from backend.core.search import initial_input


class WebEntry(Contract):
    adapter_type: Literal["web"]
    url: Annotated[str, Field(min_length=1, max_length=2048)] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    keyword: Name | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def check_input(self):
        if (self.url is None) == (self.keyword is None):
            raise ValueError("Provide exactly one of url or keyword")
        if self.keyword is not None and not self.keyword.isprintable():
            raise ValueError("Keyword must contain only printable characters")
        return self

    def collection_input(self) -> CollectionInput:
        return (
            KeywordInput(self.keyword)
            if self.keyword is not None
            else WebInput(self.url)
        )


class CsvEntry(Contract):
    adapter_type: Literal["csv"]
    dataset_id: Name
    content: Annotated[str, Field(max_length=MAX_INPUT_BYTES)]

    @field_validator("content")
    @classmethod
    def bounded_utf8(cls, value: str):
        if "\x00" in value:
            raise ValueError("CSV text must not contain NUL")
        try:
            size = len(value.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise ValueError("CSV text must be valid UTF-8") from error
        if size > MAX_INPUT_BYTES:
            raise ValueError("CSV text exceeds the 1 MiB UTF-8 limit")
        return value

    def collection_input(self) -> CollectionInput:
        return CsvInput(self.dataset_id, self.content.encode("utf-8"))


Entry = Annotated[WebEntry | CsvEntry, Field(discriminator="adapter_type")]


def check_entry(source: Source, config: Configuration, entry: CollectionInput):
    if isinstance(config, ExtractionConfiguration) and isinstance(
        entry, (WebInput, KeywordInput)
    ):
        initial_input(source, config, entry)
    elif source.adapter_type == "csv" and isinstance(entry, CsvInput):
        capture_csv(source, entry)
    else:
        raise InputError(
            "input_adapter_mismatch", "Input type does not match the source adapter"
        )
