"""Test-only worker that pauses immediately before acknowledging one task."""

import os
from pathlib import Path
from time import sleep

from celery.worker.request import Request

from backend.queue.celery_app import app

original_acknowledge = Request.acknowledge


def acknowledge(self):
    if self.id == os.environ["M3_TEST_ACK_TASK_ID"]:
        Path(os.environ["M3_TEST_ACK_MARKER"]).touch()
        sleep(60)
    return original_acknowledge(self)


Request.acknowledge = acknowledge
__all__ = ["app"]
