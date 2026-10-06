import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { ApiExceptionFilter, DataInterceptor, securityMiddleware } from './common/http'

async function bootstrap() {
  if (!process.env.DATABASE_URL) console.warn('[startup] DATABASE_URL is missing; health endpoint will report configuration error')
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32)
    console.warn('[startup] JWT_ACCESS_SECRET is missing or too short; health endpoint will report configuration error')
  const app = await NestFactory.create(AppModule, { bodyParser: true })
  app.use(securityMiddleware(new Set((process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || 'http://127.0.0.1:8060').split(',').map(value => value.trim()).filter(Boolean))))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(new DataInterceptor())
  await app.listen(Number(process.env.PORT || 8060))
}
void bootstrap()
