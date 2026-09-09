#!/usr/bin/env bash
#
# Applies the migrations to a throwaway Postgres and asserts the guarantees
# DESIGN.md relies on: send idempotency, no `send_failed` status, template
# sections carrying no generation metadata, the client-view function refusing
# to expose drafts, and per-section approval comments being permanent.
#
# Needs Docker. Run from the repository root:
#   bash supabase/tests/run.sh
#
# These are guarantees the DATABASE makes. The application's own rules — who may
# approve, who may send — are tested in the TypeScript suite, because that is
# where they are enforced and where the explanations live.

set -euo pipefail

# Git Bash on Windows mangles POSIX paths in arguments to native programs. Both
# halves of `docker cp host:path container:/tmp/x` are affected, in opposite
# directions — the host path must become C:\..., the container path must stay
# /tmp/... — so conversion is disabled and the host side is converted here.
# On Linux and macOS `cygpath` does not exist and the path is already correct.
export MSYS_NO_PATHCONV=1

host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

CONTAINER="proposal-schema-test"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "Starting Postgres..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=verify \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

# The shim stands in for Supabase's `auth` and `storage` schemas so the real
# migrations run unmodified. Verification only — never applied to a real project.
for f in "$HERE/00_supabase_shim.sql" \
         "$MIGRATIONS"/*.sql \
         "$HERE/schema_guarantees.sql" \
         "$HERE/fork_semantics.sql"; do
  name="$(basename "$f")"
  docker cp "$(host_path "$f")" "$CONTAINER:/tmp/$name"
  echo "--- $name"

  # Output and exit status are captured separately: piping psql into grep would
  # make the pipeline report grep's status and silently pass a failed assertion.
  output=""
  status=0
  output="$(docker exec "$CONTAINER" \
              psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$name" 2>&1)" || status=$?

  echo "$output" | grep -Ei "PASS|FAIL|ERROR" || true

  if [ "$status" -ne 0 ]; then
    echo
    echo "FAILED in $name (psql exit $status)"
    exit 1
  fi
done

echo
echo "Schema guarantees verified."
