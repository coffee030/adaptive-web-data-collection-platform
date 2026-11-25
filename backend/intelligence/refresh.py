"""Apply explicitly versioned local partner updates under their existing grant."""

import logging
import os
import stat
from pathlib import Path

from pydantic import AwareDatetime, ValidationError
from sqlalchemy import update

from backend.application.jobs import database_now
from backend.marketing.store import MarketingError

from .contracts import ImportDataset, StrictModel
from .models import DatasetRow
from .store import IntelligenceStore, Scope, active, valid_workspace

LOGGER = logging.getLogger(__name__)
MAX_FILE_BYTES = 1024 * 1024


class PartnerUpdate(StrictModel):
    expected_imported_at: AwareDatetime
    dataset: ImportDataset


def refresh_partner_files(store: IntelligenceStore, directory: Path) -> None:
    if not valid_workspace(store.config):
        return
    scope = Scope("partner", store.config.workspace)
    folder = directory / scope.workspace
    try:
        if not stat.S_ISDIR(folder.lstat().st_mode):
            return
    except FileNotFoundError:
        return
    except OSError as error:
        LOGGER.warning(
            "Partner refresh directory unreadable (%s)", type(error).__name__
        )
        return
    with store.sessions() as session:
        receipts = list(
            session.execute(
                active(scope, database_now(session)).with_only_columns(
                    DatasetRow.dataset_id, DatasetRow.imported_at
                )
            )
        )
    for dataset_id, imported_at in receipts:
        path = folder / (dataset_id + ".json")
        try:
            if not stat.S_ISREG(path.lstat().st_mode):
                raise MarketingError(
                    422, "refresh_file_type", "Expected a regular file"
                )
            flags = (
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_NONBLOCK", 0)
            )
            with os.fdopen(os.open(path, flags), "rb") as handle:
                if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                    raise MarketingError(
                        422, "refresh_file_type", "Expected a regular file"
                    )
                raw = handle.read(MAX_FILE_BYTES + 1)
            if len(raw) > MAX_FILE_BYTES:
                raise MarketingError(422, "refresh_too_large", "File exceeds 1 MiB")
            delivery = PartnerUpdate.model_validate_json(raw)
            store.ingest(
                scope,
                dataset_id,
                delivery.dataset,
                expected_imported_at=delivery.expected_imported_at,
            )
        except FileNotFoundError:
            continue
        except MarketingError as error:
            reason = error.code
        except ValidationError:
            reason = "refresh_invalid_dataset"
        except OSError:
            reason = "refresh_unreadable"
        else:
            continue
        LOGGER.warning("Partner refresh %s rejected (%s)", dataset_id, reason)
        with store.sessions.begin() as session:
            session.execute(
                update(DatasetRow)
                .where(
                    DatasetRow.mode == scope.mode,
                    DatasetRow.workspace == scope.workspace,
                    DatasetRow.dataset_id == dataset_id,
                    DatasetRow.imported_at == imported_at,
                    DatasetRow.expires_at > database_now(session),
                    DatasetRow.refresh_error.is_distinct_from(reason),
                )
                .values(refresh_error=reason)
            )
