-- Seed dos fornecedores: não há cadastro de fornecedor nesta etapa. UUIDs fixos
-- para os tokens de desenvolvimento (`npm run token`) e para os testes.
-- Como migration, roda uma vez só por banco, no Compose, no CI e nos testes.
INSERT INTO "suppliers" ("id", "name", "min_order_value_cents") VALUES
  ('11111111-1111-4111-8111-111111111111', 'Fornecedor Alfa', 50000),
  ('22222222-2222-4222-8222-222222222222', 'Fornecedor Beta', 100000);
