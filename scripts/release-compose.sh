#!/usr/bin/env bash
# Run from a clean checkout on a Linux Docker host with the CI test dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

id="$(python -c 'from uuid import uuid4; print(uuid4().hex[:12])')"
project="collection-m3-test-rc-$id"
output="$(mktemp -d)"
export POSTGRES_USER=collection POSTGRES_DB=collection_release_check
export POSTGRES_PASSWORD="$(python -c 'from secrets import token_hex; print(token_hex(24))')"
export POSTGRES_PORT=0 API_PORT=0 FRONTEND_PORT=0 LOCAL_PROFILE_APPROVAL=1
export COLLECTION_BACKEND_IMAGE="$project-backend:local"
export LAUNCHER_OWNER="$id"
base=(--env-file /dev/null -f compose.yaml -f compose.fixture.yaml)
demo=("${base[@]}" -p "$project" -f scripts/windows/compose.demo.yaml)
reference=("${base[@]}" -p "$project-reference" -f backend/experiments/m22b.compose.yaml)
export M22B_BACKEND_IMAGE="$COLLECTION_BACKEND_IMAGE"

dc() { docker compose "${demo[@]}" "$@"; }
ref() { docker compose "${reference[@]}" "$@"; }
cleanup() {
    rc=$?
    if (( rc != 0 )); then
        dc ps -a || true
        ref ps -a || true
    fi
    ref down --volumes --timeout 75 || rc=1
    dc down --volumes --timeout 75 || rc=1
    rm -f "$output/stats.jsonl" "$output/stage"
    rmdir "$output"
    exit "$rc"
}
for candidate in "$project" "$project-reference"; do
    filter="label=com.docker.compose.project=$candidate"
    for kind in container network volume; do
        args=()
        if [[ "$kind" == container ]]; then args+=(--all); fi
        occupied="$(docker "$kind" ls "${args[@]}" --filter "$filter" --quiet)"
        [[ -z "$occupied" ]] || { echo "Existing project $candidate"; exit 1; }
    done
done
trap cleanup EXIT

echo "Isolated release project $project"
dc config --quiet
ref config --quiet
SECONDS=0
dc build --no-cache api frontend
echo "No-cache application build: ${SECONDS}s"
SECONDS=0
dc up -d --wait --wait-timeout 90 postgres redis
dc run --rm -T --no-deps api python -m alembic upgrade head
dc run --rm -T --no-deps api python -m alembic current --check-heads
dc up -d --no-build --wait --wait-timeout 90
echo "First startup after build including migration: ${SECONDS}s"
frontend="$(dc port frontend 8080)"
api="$(dc port api 8000)"
[[ "$frontend" == 127.0.0.1:* && "$api" == 127.0.0.1:* ]]
url="http://$frontend"
api_url="http://$api/api/v1"
curl --fail --silent --show-error --max-time 10 "$url/overview" | grep -q 'id="root"'
curl --fail --silent --show-error --max-time 10 "$url/api/v1/health"
status() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
[[ "$(status -H 'Host: external.invalid' "$url/")" == 403 ]]
[[ "$(status -H 'Origin: https://external.invalid' "$url/api/v1/sources")" == 403 ]]
[[ "$(status -X POST "$url/api/v1/sources/test/versions/test/approve")" == 403 ]]
[[ "$(status "$url/assets/missing.js")" == 404 ]]
echo "Production frontend, API forwarding and local boundary checks passed."

sample() {
    mapfile -t containers < <(dc ps -q)
    if (( ${#containers[@]} )); then
        docker stats --no-stream --format '{{json .}}' "${containers[@]}" |
            sed "s/^/$1 /" | tee -a "$output/stats.jsonl"
    fi
}
sample idle
SECONDS=0
dc exec -T api python -m backend.experiments.demo_provision &
seed_pid=$!
while kill -0 "$seed_pid" 2>/dev/null; do
    sample demo
    sleep 2
done
wait "$seed_pid"
echo "Demo seed and verify: ${SECONDS}s"
sample demo-ready
dc exec -T api du -sk /data/evidence /data/demo-state
dc exec -T postgres du -sk /var/lib/postgresql/data
docker image inspect "$COLLECTION_BACKEND_IMAGE" "$project-frontend" --format '{{join .RepoTags ","}} {{.Size}} bytes'

FYP_MCP_API_BASE="$api_url" .venv/mcp/bin/python -m scripts.release_mcp_smoke

export M4_REAL_API=1 M4_DEPLOYED_FRONTEND=1
export M4_FRONTEND_PORT="${frontend##*:}" API_PROXY_TARGET="http://$api"
export M10_SYNTHETIC_URL="$url" M15_DEMO_READ=1 M9_TEST_PYTHON=python
export M4D_COMPOSE_PROJECT="$project" M4E_COMPOSE_PROJECT="$project"
export M4_COMPOSE_OVERLAYS="scripts/windows/compose.demo.yaml"
export M3_TEST_COMPOSE_PROJECT="$project" M3_TEST_COMPOSE_API_URL="http://$api"
export M3_TEST_COMPOSE_EXTRA_ARGS="-f scripts/windows/compose.demo.yaml"
export M2_TEST_COMPOSE_PROJECT="$project"

SECONDS=0
dc stop
[[ -z "$(dc ps -q)" ]]
dc up -d --no-build --wait --wait-timeout 90
echo "Stop and restart: ${SECONDS}s"
dc exec -T api python -m backend.experiments.demo_provision --check
SECONDS=0
dc up -d --no-build --wait --wait-timeout 90
echo "Repeated startup: ${SECONDS}s"
sample restart
export M2_TEST_DATABASE_URL="postgresql+psycopg://$POSTGRES_USER:$POSTGRES_PASSWORD@$(dc port postgres 5432)/$POSTGRES_DB"
python -m pytest -p scripts.require_pytest_pass -q backend/tests/m2/test_m3_compose.py -k 'not m20_worker_attempt_identity'
(
    cd frontend
    npm test -- closure.integration.ts core-workflow.integration.ts jobs.integration.ts \
        operator.integration.ts profiles.integration.ts results.integration.ts sources.integration.ts \
        topic-collections.integration.ts --workers=1
)

ref build frontend
ref up -d --wait --wait-timeout 90 postgres redis
ref run --rm -T --no-deps api python -m alembic upgrade head
ref up -d --no-build --wait --wait-timeout 90 frontend
ref_frontend="$(ref port frontend 8080)"
export M4_FRONTEND_PORT="${ref_frontend##*:}"
(
    cd frontend
    npm test -- profile-suggestion.integration.ts --workers=1
)
