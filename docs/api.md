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

## Validação de entrada

O gateway valida todo corpo antes de chamar qualquer serviço:

- **Campo desconhecido é erro.** O dono do produto vem do token, e um `supplierId` no corpo responde 400.
- **Sem conversão implícita.** `"10"` não vira `10`: preço em texto é erro.
- **Campo opcional que vem precisa ser válido.** Na edição, mandar `null` é erro; omitir o campo é o jeito de não mudar.
- **Limites:** nome com até 200 caracteres, categoria com até 100, até 20 tags de até 50, e de 1 a 50 variantes por criação. SKU com letras, números, `.`, `_` e `-`, até 64 caracteres. Preço e quantidade mínima ≥ 1, estoque inicial ≥ 0, todos inteiros até 2³¹−1.
- **Dinheiro em centavos inteiros** (`wholesalePriceCents: 1990` = R$ 19,90).
- **Atributos da variante** são um objeto de textos (`{ "cor": "azul" }`).

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
| catalog fora do ar, sem resposta em 5 s | 503 | `message: "Catalog unavailable"` |
| catalog respondeu fora do contrato | 502 | `message: "Unexpected catalog response"` |
| erro inesperado no catalog | 500 | `message: "Internal error"`, sem detalhe interno (o detalhe vai para o log do catalog) |

**Como o erro atravessa os serviços:** o catalog lança erros de domínio (`ProductNotFoundError`, `ForbiddenActionError`, `SkuConflictError`); um filtro de exceção RPC os converte no formato do contrato, `{ status, message }`; o gateway recebe esse objeto como erro do client TCP e o converte em resposta HTTP com o mesmo status. Falha de transporte (conexão recusada, timeout) chega como `Error` e vira 503.
