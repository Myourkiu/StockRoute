import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InternalClientsModule } from '../clients/clients.module';
import { ProductsController } from './products.controller';

@Module({
  imports: [AuthModule, InternalClientsModule],
  controllers: [ProductsController],
})
export class ProductsModule {}
