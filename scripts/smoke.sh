#!/usr/bin/env bash
# Smoke do sistema em containers: sobe os 5 serviços, confere a saúde agregada,
# o CRUD de produtos pelo gateway, o cache do produto, a busca, a falha de um
# serviço, o broker e o índice fora (com a reindexação), o que a imagem de
# execução leva, as portas publicadas e um segundo `up` sem apagar dados.
# Uso: scripts/smoke.sh (precisa do Docker; termina com `down`, sem -v).
set -euo pipefail
cd "$(dirname "$0")/.."

# O Compose exige JWT_SECRET. Sem .env nem variável, o smoke usa um aleatório.
if [ -z "${JWT_SECRET:-}" ] && ! grep -qs '^JWT_SECRET=.' .env; then
  export JWT_SECRET="smoke-$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
fi

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

# Repete um comando até ele dar certo ou passarem N segundos, ex.:
# eventually 5 search_has "category=smoke" "$id"
eventually() {
  local deadline=$((SECONDS + $1))
  shift
  until "$@"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.5
  done
}

# A busca do lojista traz o produto? search_has "<query string>" "<id>"
search_has() {
  curl -s -H "Authorization: $retailer" "localhost:18000/products/search?$1"     | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.exit((JSON.parse(s).items ?? []).some((i) => i.id === process.argv[1]) ? 0 : 1))' "$2"
}

search_lacks() { ! search_has "$@"; }

# Cria um produto pelo gateway e imprime o id. create_product "<nome>" "<categoria>"
create_product() {
  local sku="SMOKE-$(date +%s%N)"
  local code
  code=$(curl -s -o /tmp/smoke-created.json -w '%{http_code}' -X POST localhost:18000/products \
    -H "Authorization: $supplier" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"description\":\"\",\"category\":\"$2\",\"tags\":[],\"variants\":[{\"sku\":\"$sku\",\"attributes\":{},\"wholesalePriceCents\":100,\"minQuantity\":1,\"initialStock\":1}]}")
  [ "$code" = 201 ] || fail "POST /products ($1) respondeu $code: $(cat /tmp/smoke-created.json)"
  json_field "$(cat /tmp/smoke-created.json)" id
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

echo "== cache do produto"
curl -s -o /dev/null -H "Authorization: $retailer" "localhost:18000/products/$id"
ttl=$(docker compose exec -T redis redis-cli TTL "catalog:product:v1:$id" | tr -d '')
[ "$ttl" -ge 239 ] && [ "$ttl" -le 360 ] || fail "TTL da chave do produto: $ttl (esperado 240-360)"
ok "produto em cache com TTL de ${ttl}s"
docker compose stop redis
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" "localhost:18000/products/$id")
[ "$code" = 200 ] || fail "com o Redis parado, GET do produto respondeu $code"
docker compose start redis
ok "com o Redis parado, o GET segue pelo banco (200)"

echo "== busca"
eventually 5 search_has "category=smoke" "$id" || fail "o produto não apareceu na busca em 5 s"
ok "produto na busca em até 5 s (escrita → RabbitMQ → Elasticsearch)"

code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: $supplier" "localhost:18000/products/$id")
[ "$code" = 204 ] || fail "DELETE respondeu $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" "localhost:18000/products/$id")
[ "$code" = 404 ] || fail "GET do produto desativado respondeu $code"
eventually 5 search_lacks "category=smoke" "$id" || fail "o produto desativado continuou na busca depois de 5 s"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:18000/products)
[ "$code" = 401 ] || fail "POST sem token respondeu $code"
ok "criar 201, ler 200, desativar 204, ler 404 e fora da busca, sem token 401"

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

echo "== RabbitMQ parado e reindexação"
docker compose stop rabbitmq
offline_id=$(create_product "Smoke sem broker" smoke-reindex)
ok "com o RabbitMQ parado, criar responde 201"
docker compose up -d --wait rabbitmq
npm run --silent catalog:reindex >/tmp/smoke-reindex.log 2>&1 \
  || fail "catalog:reindex falhou: $(cat /tmp/smoke-reindex.log)"
eventually 5 search_has "category=smoke-reindex" "$offline_id" \
  || fail "depois da reindexação, o produto criado sem broker não está na busca"
ok "catalog:reindex roda no container, e o produto criado sem broker está na busca"
# O consumidor reconecta sozinho (tentativas a cada 5 s), sem reiniciar o catalog.
online_id=$(create_product "Smoke broker de volta" smoke-reconnect)
eventually 20 search_has "category=smoke-reconnect" "$online_id" \
  || fail "com o RabbitMQ de volta, um produto novo não chegou à busca em 20 s"
ok "com o RabbitMQ de volta, um produto novo chega à busca sem reindexar"

echo "== Elasticsearch parado"
docker compose stop elasticsearch
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" localhost:18000/products/search)
[ "$code" = 503 ] || fail "com o Elasticsearch parado, a busca respondeu $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: $retailer" "localhost:18000/products/$online_id")
[ "$code" = 200 ] || fail "com o Elasticsearch parado, o GET por id respondeu $code"
body=$(curl -s localhost:18000/health)
[ "$(service_status "$body" catalog)" = up ] || fail "com o Elasticsearch parado, o catalog não está up: $body"
docker compose up -d --wait elasticsearch
ok "com o Elasticsearch parado, busca 503, GET 200 e o catalog continua pronto"

echo "== imagem de execução do catalog"
docker compose run --rm --no-deps --entrypoint sh catalog -c '
  ! test -e node_modules/.bin/prisma || { echo "binário prisma presente"; exit 1; }
  ! find . -name "*.ts" -not -path "./node_modules/*" | grep -q . || { echo "arquivos .ts presentes"; exit 1; }
  test "$(id -u)" != 0 || { echo "rodando como root"; exit 1; }
  for dep in amqplib amqp-connection-manager @elastic/elasticsearch; do
    test -d "node_modules/$dep" || { echo "$dep ausente"; exit 1; }
  done
' || fail "imagem de execução do catalog"
ok "sem CLI do Prisma, sem .ts, sem root, e com o cliente do RabbitMQ e do Elasticsearch"

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
