#!/usr/bin/env bash
# Smoke do sistema em containers: sobe tudo, confere a saúde agregada, o que a
# imagem de execução leva, as portas publicadas e um segundo `up` sem apagar
# dados. Uso: scripts/smoke.sh (precisa do Docker; termina com `down`, sem -v).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FALHOU: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

echo "== subindo o sistema"
docker compose up -d --build --wait

echo "== saúde agregada"
health=$(curl -s -w '\n%{http_code}' localhost:18000/health)
[ "$(tail -n1 <<<"$health")" = 200 ] || fail "GET /health não respondeu 200: $health"
grep -q '"catalog":{[^}]*"status":"up"' <<<"$health" || fail "catalog não está up: $health"
ok "GET /health 200 com catalog up"

echo "== imagem de execução do catalog"
docker compose run --rm --no-deps --entrypoint sh catalog -c '
  ! test -e node_modules/.bin/prisma || { echo "binário prisma presente"; exit 1; }
  ! find . -name "*.ts" -not -path "./node_modules/*" | grep -q . || { echo "arquivos .ts presentes"; exit 1; }
  test "$(id -u)" != 0 || { echo "rodando como root"; exit 1; }
' || fail "imagem de execução do catalog"
ok "sem CLI do Prisma, sem .ts e sem root"

echo "== portas publicadas"
for port in 18101 18201; do
  if docker compose port catalog "$port" >/dev/null 2>&1; then
    fail "catalog publica a porta $port no host"
  fi
done
ok "catalog sem portas publicadas"

echo "== down e up sem apagar dados"
docker compose down
docker compose up -d --wait
docker compose logs catalog-migrate | grep -q 'No pending migrations to apply' \
  || fail "catalog-migrate não reportou 'No pending migrations to apply'"
ok "segundo up sem migrations pendentes"

docker compose down
echo "smoke ok"
