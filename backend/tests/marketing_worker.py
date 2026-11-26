"""Use an in-process provider fixture inside the separate Celery test worker."""

from types import SimpleNamespace

import httpx2

from backend.queue import tasks
from backend.queue.celery_app import app as app
from backend.tests.marketing_fixture import standard_response


def fixture_client(**kwargs):
    return httpx2.Client(transport=httpx2.MockTransport(standard_response), **kwargs)


tasks.httpx2 = SimpleNamespace(Client=fixture_client, Timeout=httpx2.Timeout)
