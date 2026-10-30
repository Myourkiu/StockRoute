import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CATALOG_PATTERNS,
  type Actor,
  type CatalogRequest,
  type ProductView,
} from '@stockroute/contracts';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { CurrentActor } from '../auth/actor.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CATALOG_CLIENT } from '../clients/clients.constants';
import { toHttpException } from '../common/rpc-to-http';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto, VariantDto } from './dto/variant.dto';

// Tempo máximo esperando o catalog antes de responder 503.
const CATALOG_TIMEOUT_MS = 5000;

// API pública de produtos. A ordem do pipeline é: AuthGuard (quem é, 401) →
// RolesGuard (pode, 403) → ValidationPipe (o corpo, 400) → handler. A posse
// do produto quem decide é o catalog.
@Controller('products')
@UseGuards(AuthGuard, RolesGuard)
export class ProductsController {
  constructor(@Inject(CATALOG_CLIENT) private readonly catalog: ClientProxy) {}

  @Post()
  @Roles(['supplier'])
  create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateProductDto,
  ): Promise<ProductView> {
    return this.send(CATALOG_PATTERNS.create, { actor, data: body });
  }

  @Get(':id')
  get(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<ProductView> {
    return this.send(CATALOG_PATTERNS.get, { actor, data: { id } });
  }

  @Patch(':id')
  @Roles(['supplier'])
  update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductView> {
    return this.send(CATALOG_PATTERNS.update, {
      actor,
      data: { id, changes: body },
    });
  }

  // "Remover" desativa, e é idempotente: repetir também responde 204.
  @Delete(':id')
  @Roles(['supplier'])
  @HttpCode(204)
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<void> {
    await this.send(CATALOG_PATTERNS.deactivate, { actor, data: { id } });
  }

  @Post(':id/variants')
  @Roles(['supplier'])
  addVariant(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: VariantDto,
  ): Promise<ProductView> {
    return this.send(CATALOG_PATTERNS.addVariant, {
      actor,
      data: { id, variant: body },
    });
  }

  @Patch(':id/variants/:sku')
  @Roles(['supplier'])
  updateVariant(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('sku') sku: string,
    @Body() body: UpdateVariantDto,
  ): Promise<ProductView> {
    return this.send(CATALOG_PATTERNS.updateVariant, {
      actor,
      data: { id, sku, changes: body },
    });
  }

  private send<T>(
    pattern: { cmd: string },
    request: CatalogRequest<unknown>,
  ): Promise<T> {
    return firstValueFrom(
      this.catalog.send<T>(pattern, request).pipe(
        timeout(CATALOG_TIMEOUT_MS),
        catchError((error) => throwError(() => toHttpException(error))),
      ),
    );
  }
}
