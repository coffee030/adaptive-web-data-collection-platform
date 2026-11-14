FROM python:3.12.14-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
COPY backend/experiments/scrapling_spike/requirements.txt backend/experiments/scrapling_spike/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt && pip check \
    && groupadd --gid 10001 collection \
    && useradd --uid 10001 --gid 10001 --no-create-home collection \
    && install -d -o collection -g collection /data/evidence
COPY alembic.ini ./
COPY backend/ backend/
USER collection
