import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

// O segredo só vem do ambiente. Sem ele o gateway não sobe: melhor falhar no
// boot do que aceitar tokens assinados com um valor padrão conhecido.
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET is required');
        }
        return { secret, verifyOptions: { algorithms: ['HS256'] } };
      },
    }),
  ],
  providers: [AuthGuard, RolesGuard],
  exports: [JwtModule, AuthGuard, RolesGuard],
})
export class AuthModule {}
