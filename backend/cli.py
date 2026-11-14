"""Execute a pending collection job in a separate local process."""

import argparse
import json
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from backend.application.execution import JobExecutor
from backend.core.evidence import LocalEvidenceStore
from backend.core.profiles import ProfileError
from backend.persistence.database import (
    database_url,
    evidence_path,
    make_engine,
    session_factory,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_id", type=UUID, help="Pending collection job UUID")
    args = parser.parse_args()

    try:
        engine = make_engine(database_url())
        try:
            job = JobExecutor(
                session_factory(engine), LocalEvidenceStore(evidence_path())
            ).execute(args.job_id)
        finally:
            engine.dispose()
    except ProfileError as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error)}}))
        return 1
    except (RuntimeError, ValueError):
        print(
            json.dumps(
                {
                    "error": {
                        "code": "invalid_configuration",
                        "message": "Check local database configuration",
                    }
                }
            )
        )
        return 1
    except SQLAlchemyError:
        print(
            json.dumps(
                {
                    "error": {
                        "code": "database_error",
                        "message": "Could not confirm job state in PostgreSQL",
                    }
                }
            )
        )
        return 1

    print(job.model_dump_json())
    return int(job.status not in {"succeeded", "partial"})


if __name__ == "__main__":
    raise SystemExit(main())
