import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AssetController, ComfyUiController, LlmController, TaskEventsController } from './ai.controller'
import { DatabaseModule } from '../database/database.service'

@Module({
  imports: [DatabaseModule],
  controllers: [ComfyUiController, LlmController, TaskEventsController, AssetController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
export { AiModule as AIModule }
