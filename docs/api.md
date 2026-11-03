# API pública

Tudo passa pelo gateway, na porta 18000. Nenhum serviço interno é acessível de fora.

## Rotas

### Saúde

| Rota | Autenticação | Resposta |
|---|---|---|
| `GET /health` | não | saúde agregada: 200 com catalog, orders, integration e erp-mock `up`, ou 503 com quem está `down` ([architecture.md](architecture.md#saúde-liveness-e-readiness)) |
| `GET /health/live` | não | o gateway está vivo |
| `GET /health/ready` | não | o gateway pode receber tráfego |

### Produtos

Todas exigem `Authorization: Bearer <token>` ([auth.md](auth.md)).

| Rota | Papel | O que faz | Sucesso |
|---|---|---|---|
| `POST /products` | fornecedor | cria o produto com variantes e estoque inicial; o dono é o fornecedor do token | 201 com o produto |
| `GET /products/:id` | qualquer | produto com variantes e estoque disponível por SKU | 200 com o produto |
| `PATCH /products/:id` | fornecedor dono | edita nome, descrição, categoria, tags ou `active` (`true` reativa, `false` desativa) | 200 com o produto |
| `DELETE /products/:id` | fornecedor dono | desativa; o produto continua no banco; repetir também responde 204 | 204 |
| `POST /products/:id/variants` | fornecedor dono | adiciona uma variante com estoque inicial | 201 com o produto |
| `PATCH /products/:id/variants/:sku` | fornecedor dono | edita atributos, preço ou quantidade mínima da variante | 200 com o produto |

Não existe rota para editar estoque (o estoque vem do ERP nas próximas etapas) nem para remover variante (pedidos vão apontar para SKUs).

**Visibilidade:** produto ativo é visível para qualquer token. Produto inativo só existe para o fornecedor dono; para os outros, responde 404.

O produto devolvido tem id, fornecedor, nome, descrição, categoria, tags, `active`, datas em ISO 8601 (UTC) e a lista de variantes (SKU, atributos, `wholesalePriceCents`, `minQuantity` e `available`).

### Busca

`GET /products/search` exige token, e qualquer papel pode buscar. Só traz produtos ativos, e um produto criado ou editado aparece em alguns segundos (o índice é atualizado por evento; [catalog.md](catalog.md#busca)).

| Parâmetro | Regra | O que faz |
|---|---|---|
| `q` | até 200 caracteres; vazio ou só espaços é busca sem texto | busca em nome, descrição e tags; sem texto, todos, em ordem de nome |
| `category` | até 100 caracteres | só a categoria exata |
| `minPriceCents`, `maxPriceCents` | inteiros ≥ 0; o mínimo não pode passar do máximo | produto com ao menos uma variante na faixa |
| `cursor` | até 512 caracteres | o `nextCursor` da página anterior |
| `limit` | de 1 a 50; padrão 20 | itens por página |

Resposta: `{ items, nextCursor }`. Cada item traz id, fornecedor, nome, descrição, categoria, tags, `minPriceCents` e `maxPriceCents`, sem estoque (que vem no GET por id). `nextCursor` nulo é a última página.

## Validação de entrada

O gateway valida todo corpo antes de chamar qualquer serviço:

- **Campo desconhecido é erro.** O dono do produto vem do token, e um `supplierId` no corpo responde 400.
- **Sem conversão implícita.** `"10"` não vira `10`: preço em texto é erro.
- **Campo opcional que vem precisa ser válido.** Na edição, mandar `null` é erro; omitir o campo é o jeito de não mudar.
- **Limites:** nome com até 200 caracteres, descrição com até 5000, categoria com até 100, até 20 tags de até 50, e de 1 a 50 variantes por criação. SKU com letras, números, `.`, `_` e `-`, até 64 caracteres. Preço e quantidade mínima ≥ 1, estoque inicial ≥ 0, todos inteiros até 2³¹−1.
- **Dinheiro em centavos inteiros** (`wholesalePriceCents: 1990` = R$ 19,90).
- **Atributos da variante** são um objeto de textos (`{ "cor": "azul" }`).
- **Na query da busca**, que chega sempre como texto, só o que está escrito como inteiro vira número: `abc`, `1.5`, `1e3` e vazio são erro, e parâmetro repetido também.

Um 500 causado por dado do cliente é sempre um defeito de validação, nunca o comportamento esperado.

## Erros

Todo erro sai com `statusCode` e `message`. O erro de validação traz também a lista de campos:

| Situação | Status | Corpo |
|---|---|---|
| sem token, assinatura inválida, token expirado ou sem expiração, claims incoerentes | 401 | sem detalhe de qual foi o problema |
| papel errado para a rota (lojista escrevendo) | 403 | `message` explicando que o papel não pode |
| corpo inválido | 400 | `message: "Validation failed"` e `errors`, com `field` (caminho como `variants.0.minQuantity`) e `messages` |
| produto inexistente, inativo de outro dono, de outro dono (em escrita), id que não é UUID | 404 | `message` |
| SKU que já existe em qualquer produto | 409 | `message` |
| cursor da busca que não veio da busca (formato, versão ou ordem errados) | 400 | `message: "Invalid cursor"` |
| índice de busca fora do ar ou sem resposta em 2 s | 503 | `message: "Search unavailable"` (o GET por id e a escrita continuam funcionando) |
| catalog fora do ar, sem resposta em 5 s | 503 | `message: "Catalog unavailable"` |
| catalog respondeu fora do contrato | 502 | `message: "Unexpected catalog response"` |
| erro inesperado no catalog | 500 | `message: "Internal error"`, sem detalhe interno (o detalhe vai para o log do catalog) |

**Como o erro atravessa os serviços:** o catalog lança erros de domínio (`ProductNotFoundError`, `ForbiddenActionError`, `SkuConflictError`, e na busca `InvalidCursorError` e `SearchUnavailableError`); um filtro de exceção RPC os converte no formato do contrato, `{ status, message }`; o gateway recebe esse objeto como erro do client TCP e o converte em resposta HTTP com o mesmo status. Falha de transporte (conexão recusada, timeout) chega como `Error` e vira 503.
