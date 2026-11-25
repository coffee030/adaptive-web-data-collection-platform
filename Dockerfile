FROM python:3.12.14-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY backend/requirements-runtime.txt backend/requirements-runtime.txt
RUN python -m pip install --no-cache-dir pip==26.3 \
    && python -m pip install --no-cache-dir -r backend/requirements-runtime.txt \
    && python -m pip check \
    && groupadd --gid 10001 collection \
    && useradd --uid 10001 --gid 10001 --no-create-home collection \
    && install -d -o collection -g collection /data/evidence /data/demo-state
COPY alembic.ini ./
COPY backend/ backend/
USER collection
