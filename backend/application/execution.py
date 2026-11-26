"""Synchronous application entry point for a claimed collection job."""

import logging
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy.exc import DBAPIError, OperationalError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.orm import Session, sessionmaker

from backend.core.contracts import CollectionError, CollectionRunResult
from backend.core.evidence import EvidenceError, LocalEvidenceStore
from backend.core.profiles import ProfileError, ProfileRepository
from backend.core.runner import CollectionRunner
from backend.persistence.results import publish_results

from .inputs import Entry
from .jobs import Job, Jobs, job_from_row
from .profiles import Profiles
from .retry import retry_delay

LOGGER = logging.getLogger(__name__)
ENTRY = TypeAdapter(Entry)


class JobExecutor:
    def __init__(self, sessions: sessionmaker[Session], evidence: LocalEvidenceStore):
        self.sessions = sessions
        self.jobs = Jobs(sessions)
        self.profiles = Profiles(sessions)
        self.evidence = evidence

    def execute(self, job_id: UUID, *, worker_instance_id: UUID | None = None) -> Job:
        job, entry = self.jobs.claim(job_id, worker_instance_id=worker_instance_id)
        if worker_instance_id is not None:
            with self.jobs.maintain_worker_lease(job):
                return self._execute_claim(job, entry)
        return self._execute_claim(job, entry)

    def _execute_claim(self, job: Job, entry: dict) -> Job:
        try:
            result = self._run(job, entry)
        except ProfileError as error:
            return self._fail(job, CollectionError(code=error.code, message=str(error)))
        except (DBAPIError, PoolTimeoutError) as error:
            return self._fail(job, self._database_error(error))
        except Exception as error:  # noqa: BLE001 - persist an unexpected runner failure
            LOGGER.error(
                "Job %s runner failed with %s", job.job_id, type(error).__name__
            )
            return self._fail(
                job,
                CollectionError(
                    code="runner_failure", message="Collection execution failed"
                ),
            )
        try:
            return self._publish(job, result)
        except EvidenceError as error:
            return self._fail(job, CollectionError(code=error.code, message=str(error)))
        except SQLAlchemyError as error:
            LOGGER.error(
                "Job %s could not publish results (%s)",
                job.job_id,
                type(error).__name__,
            )
            return self._fail(job, self._database_error(error))

    def _run(self, job: Job, entry: dict) -> CollectionRunResult:
        source = self.profiles.get_source(job.source_id)
        version = self.profiles.get_version(job.source_id, job.profile_version_id)
        if version.config_hash != job.config_hash:
            raise ProfileError(
                "job_profile_changed", "Job profile hash no longer matches the pin"
            )
        repo = ProfileRepository.from_snapshot(
            source, version, check_source_access=self.profiles._check_source_access
        )
        return CollectionRunner(repo, self.evidence, rate=self.profiles.rate).run(
            version.profile_version_id, ENTRY.validate_python(entry).collection_input()
        )

    def _publish(self, job: Job, result: CollectionRunResult) -> Job:
        status = "succeeded" if result.status == "completed" else result.status
        with self.sessions.begin() as session:
            row = self.jobs._get_row(session, job.job_id, lock=True)
            if not self.jobs.owns_attempt(session, row, job.execution_attempt):
                return job_from_row(row)
            if (
                result.error
                and (delay := retry_delay(result.error, row.execution_attempt))
                is not None
            ):
                limit = self.jobs.attempt_limit(session, row)
                if row.execution_attempt < limit:
                    for evidence in result.all_evidence:
                        LOGGER.info(
                            "Job %s retry left unreferenced evidence %s",
                            row.id,
                            evidence.evidence_id,
                        )
                    return self.jobs.retry(
                        session, row, result.error, delay, attempt_limit=limit
                    )
            publish_results(session, row, result, self.evidence)
            return self.jobs._finish(
                session,
                row,
                status,
                counts=(
                    len(result.records),
                    len(result.invalid),
                    len(result.duplicates),
                ),
                error=result.error,
            )

    def _fail(self, job: Job, error: CollectionError) -> Job:
        with self.sessions.begin() as session:
            row = self.jobs._get_row(session, job.job_id, lock=True)
            if not self.jobs.owns_attempt(session, row, job.execution_attempt):
                return job_from_row(row)
            delay = retry_delay(error, row.execution_attempt)
            if delay is not None:
                return self.jobs.retry(session, row, error, delay)
            return self.jobs._finish(session, row, "failed", error=error)

    @staticmethod
    def _database_error(error: SQLAlchemyError) -> CollectionError:
        if isinstance(error, (OperationalError, PoolTimeoutError)) or (
            isinstance(error, DBAPIError) and error.connection_invalidated
        ):
            return CollectionError(
                code="database_unavailable",
                message="PostgreSQL temporarily unavailable",
            )
        return CollectionError(
            code="result_persistence_failed",
            message="Collection results could not be committed",
        )
