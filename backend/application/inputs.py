"""Accept explicit loopback URLs or bounded inline UTF-8 CSV datasets."""

from typing import Annotated, Literal

from pydantic import Field, field_validator

from backend.core.contracts import Contract, Name
from backend.core.csv_adapter import MAX_INPUT_BYTES, capture_csv
from backend.core.inputs import CsvInput, InputError, WebInput
from backend.core.runner import CollectionInput
from backend.core.web_adapter import checked_url


class WebEntry(Contract):
    adapter_type: Literal["web"]
    url: Annotated[str, Field(min_length=1, max_length=2048)]

    def collection_input(self) -> CollectionInput:
        return WebInput(self.url)


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


def check_entry(source, entry: CollectionInput):
    if source.adapter_type == "web" and isinstance(entry, WebInput):
        checked_url(source, entry.url)
    elif source.adapter_type == "csv" and isinstance(entry, CsvInput):
        capture_csv(source, entry)
    else:
        raise InputError(
            "input_adapter_mismatch", "Input type does not match the source adapter"
        )
