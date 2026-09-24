import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { APP_GUARD } from '@nestjs/core'
import { DatabaseModule } from './database/database.service'
import { AIModule } from './ai/ai.module'
import { AuthController } from './auth/auth.controller'
import { AuthGuard, PermissionGuard } from './auth/guards'
import { WorkspaceController, HealthController } from './workspace/workspace.controller'
import { TasksController, AssetsController, ExecutionsController, WorkflowsController, ProvidersController, ModelsController, PipelinesController, StagesController, QualityGatesController } from './resources/resource.controllers'
import { UsersController, RolesController, PermissionsController, AuditLogsController } from './admin/admin.controllers'

@Module({
  imports: [DatabaseModule, AIModule, JwtModule.registerAsync({ useFactory: () => {
    const secret = process.env.JWT_ACCESS_SECRET
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters')
    return { secret }
  } })],
  controllers: [AuthController, HealthController, WorkspaceController, TasksController, AssetsController, ExecutionsController, WorkflowsController, ProvidersController, ModelsController, PipelinesController, StagesController, QualityGatesController, UsersController, RolesController, PermissionsController, AuditLogsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
