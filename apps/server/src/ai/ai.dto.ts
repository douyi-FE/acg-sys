import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import type { ServiceKind } from '@prisma/client'
import type { Request } from 'express'

export interface AuthenticatedRequest extends Request {
  user: { id: string; role?: string; permissions: string[] }
}

export class CreateInstanceDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string
  @IsString() @IsNotEmpty() @MaxLength(2048) baseUrl!: string
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() enabled?: boolean
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MaxLength(8192) secret?: string
}
export class CreateLlmServiceDto extends CreateInstanceDto {
  @IsIn(['OPENAI', 'OLLAMA']) kind!: Extract<ServiceKind, 'OPENAI' | 'OLLAMA'>
}
export class UpdateServiceDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(200) name?: string
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @IsNotEmpty() @MaxLength(2048) baseUrl?: string
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsBoolean() enabled?: boolean
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MaxLength(8192) secret?: string
}
export class SubmitDto {
  @IsString() @IsNotEmpty() @MaxLength(191) serviceId!: string
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) taskId?: string
  @IsString() @IsNotEmpty() @MaxLength(191) workflowId!: string
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) workflowVersion?: string
  @IsObject() input!: Record<string, unknown>
}
export class GenerateDto {
  @IsString() @IsNotEmpty() @MaxLength(191) serviceId!: string
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) taskId?: string
  @IsString() @IsNotEmpty() @MaxLength(191) modelId!: string
  @IsString() @IsNotEmpty() @MaxLength(100_000) prompt!: string
  @IsOptional() @IsIn(['ordinary', 'json']) mode?: 'ordinary' | 'json'
}

export interface AiMessageEvent {
  data: unknown
}
