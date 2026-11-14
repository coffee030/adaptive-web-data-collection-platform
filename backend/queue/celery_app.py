"""Celery transport settings for the collection queue."""

from celery import Celery

from backend.persistence.database import settings

QUEUE = "collection"
TASK = "collection.execute_job"
TASK_TIME_LIMIT = 60
VISIBILITY_TIMEOUT = 180

app = Celery(
    "collection",
    broker=settings().get("CELERY_BROKER_URL") or "redis://127.0.0.1:6379/0",
    include=["backend.queue.tasks"],
)
app.conf.update(
    accept_content=["json"],
    task_serializer="json",
    task_default_queue=QUEUE,
    task_ignore_result=True,
    task_acks_late=True,
    task_acks_on_failure_or_timeout=True,
    task_reject_on_worker_lost=False,
    task_publish_retry=False,
    task_time_limit=TASK_TIME_LIMIT,
    worker_concurrency=1,
    worker_prefetch_multiplier=1,
    worker_cancel_long_running_tasks_on_connection_loss=True,
    broker_transport_options={
        "visibility_timeout": VISIBILITY_TIMEOUT,
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
        "retry_on_timeout": False,
        "max_retries": 0,
    },
)
