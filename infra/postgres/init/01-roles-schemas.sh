#!/usr/bin/env bash
# Database per service no mesmo Postgres: um role e um schema por serviço.
# Cada role é dono só do próprio schema e não enxerga os outros nem o public.
# Roda uma vez, no primeiro start com volume vazio (docker-entrypoint-initdb.d).
set -euo pipefail

: "${CATALOG_DB_PASSWORD:?defina CATALOG_DB_PASSWORD}"
: "${ORDERS_DB_PASSWORD:?defina ORDERS_DB_PASSWORD}"
: "${INTEGRATION_DB_PASSWORD:?defina INTEGRATION_DB_PASSWORD}"

run_sql() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

# O public não serve a nenhum serviço: ninguém além do superusuário usa.
run_sql -v db="$POSTGRES_DB" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL

create_service() {
  local role=$1 schema=$2 password=$3
  run_sql -v db="$POSTGRES_DB" -v role="$role" -v schema="$schema" -v password="$password" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'password';
GRANT CONNECT ON DATABASE :"db" TO :"role";
CREATE SCHEMA :"schema" AUTHORIZATION :"role";
ALTER ROLE :"role" SET search_path = :"schema";
SQL
}

create_service catalog_svc catalog "$CATALOG_DB_PASSWORD"
create_service orders_svc orders "$ORDERS_DB_PASSWORD"
create_service integration_svc integration "$INTEGRATION_DB_PASSWORD"
