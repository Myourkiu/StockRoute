#!/usr/bin/env bash
# Smoke do sistema em containers: sobe os 5 serviços, confere a saúde agregada,
# o CRUD de produtos pelo gateway, a falha de um serviço, o que a imagem de execução leva, as portas publicadas e
# um segundo `up` sem apagar dados.
# Uso: scripts/smoke.sh (precisa do Docker; termina com `down`, sem -v).
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICES=(catalog orders integration erp-mock)

fail() { echo "FALHOU: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

# Status de um serviço na resposta do /health, ex.: service_status "$body" orders
service_status() {
  node -e 'const b = JSON.parse(process.argv[1]); console.log(b.details?.[process.argv[2]]?.status ?? "ausente")' "$1" "$2"
}

# Campo de um JSON, ex.: json_field "$body" id
json_field() {
  node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]] ?? "")' "$1" "$2"
}

# Token de desenvolvimento assinado com o mesmo segredo que o gateway está usando.
token() {
  JWT_SECRET="$(docker compose exec -T gateway printenv JWT_SECRET)" node scripts/issue-token.mjs "$@"
}

echo "== subindo o sistema"
docker compose build
started=$(date +%s)
docker compose up -d --wait
elapsed=$(( $(date +%s) - started ))
[ "$elapsed" -lt 120 ] || fail "subida levou ${elapsed}s (limite 120s)"
ok "todos ready em ${elapsed}s"

echo "== saúde agregada"
code=$(curl -s -o /tmp/smoke-health.json -w '%{http_code}' localhost:18000/health)
body=$(cat /tmp/smoke-health.json)
[ "$code" = 200 ] || fail "GET /health respondeu $code: $body"
for service in "${SERVICES[@]}"; do
  [ "$(service_status "$body" "$service")" = up ] || fail "$service não está up: $body"
done
ok "GET /health 200 com os 4 serviços up"

echo "== CRUD de produtos"
supplier="Bearer $(token supplier 11111111-1111-4111-8111-111111111111)"
retailer="Bearer $(token retailer)"
sku="SMOKE-$(date +%s)"
code=$(curl -s -o /tmp/smoke-product.json -w '%{http_code}' -X POST localhost:18000/products   -H "Authorization: $supplier" -H 'Content-Type: application/json'   -d "{\"name\":\"Smoke\",\"description\":\"\",\"category\":\"smoke\",\"tags\":[],\"variants\":[{\"sku\":\"$sku\",\"attributes\":{},\"wholesalePriceCents\":100,\"minQuantity\":1,\"initialStock\":1}]}")
body=$(cat /tmp/smoke-product.json)
[ "$code" = 201 ] || fail "POST /products respondeu $code: $body"
id=$(json_field "$body" id)
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" "localhost:18000/products/$id")
[ "$code" = 200 ] || fail "GET do produto como lojista respondeu $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: $supplier" "localhost:18000/products/$id")
[ "$code" = 204 ] || fail "DELETE respondeu $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" "localhost:18000/products/$id")
[ "$code" = 404 ] || fail "GET do produto desativado respondeu $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:18000/products)
[ "$code" = 401 ] || fail "POST sem token respondeu $code"
ok "criar 201, ler 200, desativar 204, ler 404, sem token 401"

echo "== orders parado"
docker compose stop orders
code=$(curl -s -o /tmp/smoke-health.json -w '%{http_code}' localhost:18000/health)
body=$(cat /tmp/smoke-health.json)
[ "$code" = 503 ] || fail "com orders parado, GET /health respondeu $code: $body"
[ "$(service_status "$body" orders)" = down ] || fail "orders não está down: $body"
for service in catalog integration erp-mock; do
  [ "$(service_status "$body" "$service")" = up ] || fail "$service não está up: $body"
done
ok "GET /health 503 com orders down e os demais up"
docker compose start orders
docker compose up -d --wait

echo "== imagem de execução do catalog"
docker compose run --rm --no-deps --entrypoint sh catalog -c '
  ! test -e node_modules/.bin/prisma || { echo "binário prisma presente"; exit 1; }
  ! find . -name "*.ts" -not -path "./node_modules/*" | grep -q . || { echo "arquivos .ts presentes"; exit 1; }
  test "$(id -u)" != 0 || { echo "rodando como root"; exit 1; }
' || fail "imagem de execução do catalog"
ok "sem CLI do Prisma, sem .ts e sem root"

echo "== portas publicadas"
published=$(docker compose ps --format '{{range .Publishers}}{{if .PublishedPort}}{{.PublishedPort}} {{end}}{{end}}' \
  | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')
[ "$published" = "18000 18432 " ] || fail "portas publicadas: $published (esperado: 18000 18432)"
ok "só 18000 (gateway) e 18432 (postgres) publicadas"

echo "== down e up sem apagar dados"
docker compose down
docker compose up -d --wait
for migrate in catalog-migrate orders-migrate integration-migrate; do
  docker compose logs "$migrate" | grep -q 'No pending migrations to apply' \
    || fail "$migrate não reportou 'No pending migrations to apply'"
done
ok "segundo up sem migrations pendentes nos 3 serviços"

docker compose down
echo "smoke ok"
