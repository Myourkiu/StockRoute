// Emite um JWT de desenvolvimento, assinado com o mesmo JWT_SECRET do gateway.
// Não há login nesta etapa: é assim que se obtém um token para curl e smoke.
//
//   npm run token -- supplier 11111111-1111-4111-8111-111111111111
//   npm run token -- retailer
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

const [role, supplierId] = process.argv.slice(2);
const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('Defina JWT_SECRET (o mesmo do gateway; ver .env.example).');
  process.exit(1);
}
if (role !== 'supplier' && role !== 'retailer') {
  console.error('Uso: npm run token -- <supplier|retailer> [supplierId]');
  process.exit(1);
}
if (role === 'supplier' && !supplierId) {
  console.error('O papel supplier precisa do supplierId.');
  process.exit(1);
}

const claims =
  role === 'supplier'
    ? { sub: supplierId, role, supplierId }
    : { sub: randomUUID(), role };

console.log(
  new JwtService({ secret }).sign(claims, {
    algorithm: 'HS256',
    expiresIn: '1h',
  }),
);
