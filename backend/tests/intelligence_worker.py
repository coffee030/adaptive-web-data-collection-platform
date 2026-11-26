"""Deterministic encoder used inside the process-level Celery integration test."""

from backend.intelligence import indexing
from backend.queue.celery_app import app as app


def fixture_embeddings(directory, texts):
    return [[1.0] + [0.0] * 383 for _ in texts]


indexing.embed = fixture_embeddings
