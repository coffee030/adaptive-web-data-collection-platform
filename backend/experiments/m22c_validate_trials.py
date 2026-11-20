"""Validate a private copy of the four frozen M22C pilot trial rows."""

import argparse
import csv
import re
from datetime import datetime
from math import isfinite
from pathlib import Path

TEMPLATE = (
    Path(__file__).resolve().parents[2] / "docs/evaluation/m22c-onboarding-results.csv"
)
STATUSES = {"planned", "completed", "failed", "incomplete"}


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        return reader.fieldnames, list(reader)


def validate_trial(row):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    def number(field, low, high, parser=float):
        value = parser(row[field])
        require(isfinite(value) and low <= value <= high, f"Invalid {field}")
        return value

    status = row["status"]
    require(status in STATUSES, "Unknown status")
    if status == "planned":
        require(not any(list(row.values())[9:]), "Planned trial has measurements")
        return
    require(
        bool(row["operator_id"] and row["evidence_reference"]),
        "Missing operator or evidence reference",
    )
    require(
        datetime.fromisoformat(row["started_at"]).utcoffset() is not None,
        "Timestamp needs an offset",
    )
    if status != "completed":
        require(bool(row["stop_reason"]), "Non-completion needs a recorded reason")
    if not row["elapsed_seconds"]:
        require(status == "incomplete", "Required elapsed time is missing")
    else:
        elapsed = number("elapsed_seconds", 0, 900)
        for field in (
            "waiting_seconds",
            "seconds_to_fallback",
            "seconds_to_abandonment",
        ):
            if row[field]:
                number(field, 0, elapsed)
    if row["fallback_used"] == "yes":
        require(
            bool(row["fallback_reason"] and row["seconds_to_fallback"]),
            "Fallback needs a reason and time",
        )
    if status != "completed":
        return
    require(row["fallback_used"] in {"yes", "no"}, "Record whether fallback was used")
    require(
        bool(re.fullmatch(r"[a-f0-9]{64}", row["config_hash"])),
        "Missing configuration SHA-256",
    )
    require(
        bool(row["profile_version"] and row["validation_report_id"]),
        "Missing approval references",
    )
    correct = number("correct_detail_links", 0, 2, int)
    missing = number("missing_detail_links", 0, 2, int)
    require(correct + missing == 2, "Link scores must cover the two expected links")
    number("correct_required_fields", 0, 4, int)
    for field in (
        "wrong_detail_links",
        "saved_config_edits",
        "retries",
        "unauthorized_requests",
    ):
        number(field, 0, float("inf"), int)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trial_records", type=Path)
    args = parser.parse_args()
    fields, template_rows = read_rows(TEMPLATE)
    submitted_fields, submitted_rows = read_rows(args.trial_records)
    if fields != submitted_fields or len(template_rows) != len(submitted_rows):
        parser.error("Expected the original columns and four trial rows.")
    for template, row in zip(template_rows, submitted_rows, strict=True):
        trial_id = template["trial_id"]
        if (
            None in row
            or None in row.values()
            or any(row[key] != template[key] for key in fields[:8])
        ):
            parser.error(f"{trial_id}: assignment or column count changed.")
        try:
            validate_trial(row)
        except ValueError as error:
            parser.error(f"{trial_id}: {error}")
    counts = {
        status: sum(row["status"] == status for row in submitted_rows)
        for status in sorted(STATUSES)
    }
    print("CSV structure and trial fields verified.", counts)


if __name__ == "__main__":
    main()
