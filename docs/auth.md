# Autenticação e autorização

Não há cadastro nem login nesta fase do projeto. A identidade é um JWT assinado com um segredo compartilhado, validado só no gateway. Tokens de desenvolvimento são emitidos por um script.

## O token

- **Algoritmo:** HS256, com o segredo em `JWT_SECRET`. Token assinado com outro algoritmo é recusado, mesmo com o segredo certo.
- **Claims:**
  - `sub`: quem é;
  - `role`: `supplier` (fornecedor) ou `retailer` (lojista);
  - `supplierId`: UUID do fornecedor, obrigatório quando o papel é `supplier`;
  - `exp`: expiração, **obrigatória**. A biblioteca de JWT só confere `exp` quando a claim existe, então o guard recusa token sem ela; senão o token nunca expiraria.
- **Validade:** os tokens de desenvolvimento valem 1 hora.

Qualquer problema com o token responde 401 sem dizer qual foi. A mensagem não ajuda quem tenta forjar um token.

## Ordem das checagens

| Etapa | Onde | Pergunta | Falha |
|---|---|---|---|
| `AuthGuard` | gateway | quem é? (assinatura, expiração, claims coerentes) | 401 |
| `RolesGuard` | gateway | o papel pode usar esta rota? (`@Roles` no handler) | 403 |
| `ValidationPipe` | gateway | o corpo é válido? | 400 |
| `ProductsService` | catalog | o ator é fornecedor e dono deste produto? | 403 se não é fornecedor; 404 se não é o dono |

O `AuthGuard` transforma as claims no **ator**, `{ role: 'supplier', supplierId }` ou `{ role: 'retailer' }`, e o anexa à requisição. O ator segue para o catalog dentro de toda mensagem TCP, no envelope `{ actor, data }`. Os serviços internos não veem o token.

## Papel no gateway, posse no serviço

O gateway sabe **quem** chama, mas não sabe de quem é cada produto. Por isso:

- **Papel** (fornecedor pode escrever, lojista não) é decidido no gateway, antes de qualquer chamada interna.
- **Posse** (este produto é deste fornecedor?) é decidida pelo catalog, que é dono do dado. Checar no gateway exigiria buscar o produto antes de cada escrita: uma chamada a mais e uma corrida entre a checagem e a escrita.

O catalog também repete a checagem de papel (escrita por lojista vira 403), como defesa em profundidade, caso outro serviço passe a chamá-lo direto.

**Produto de outro fornecedor responde 404, igual a um inexistente.** Um 403 diria que o id existe e pertence a outro. O mesmo vale para ler um produto inativo de outro fornecedor.

**O dono vem do token, nunca do corpo.** A criação usa o `supplierId` do ator, e um `supplierId` no corpo é campo desconhecido (400).

## Limite de confiança

Os serviços internos confiam no ator que chega pela mensagem TCP. Isso só é seguro porque as portas TCP não são publicadas fora da rede do Compose (ver [infrastructure.md](infrastructure.md#portas)). Quem alcançar a porta TCP do catalog pode forjar um ator. Em produção, isso pede rede isolada ou autenticação entre serviços (fora do escopo deste estudo).

## Tokens de desenvolvimento

O `scripts/issue-token.mjs` assina um token com o `JWT_SECRET` do `.env` ou do ambiente, que precisa ser o mesmo do gateway:

```bash
npm run token -- supplier 11111111-1111-4111-8111-111111111111   # Fornecedor Alfa
npm run token -- supplier 22222222-2222-4222-8222-222222222222   # Fornecedor Beta
npm run token -- retailer
```

Os dois fornecedores existem desde a migration de seed do catalog. O smoke gera tokens do mesmo jeito, lendo o segredo que o gateway está usando de fato.

## Segredo

O `JWT_SECRET` só vem do ambiente. O gateway não sobe sem ele, e o Compose também exige a variável, sem valor padrão: um segredo conhecido deixaria qualquer um que alcançasse a porta 18000 assinar tokens de fornecedor. O `.env.example` traz um valor só para desenvolvimento local.
