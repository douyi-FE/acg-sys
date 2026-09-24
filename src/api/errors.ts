export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid-response' | 'invalid-request'

export interface ApiErrorInfo {
  status?: number
  code?: string
  requestId?: string
  details?: unknown
  cause?: unknown
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: string
  readonly requestId?: string
  readonly details?: unknown
  readonly cause?: unknown

  constructor(kind: ApiErrorKind, message: string, info: ApiErrorInfo = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = info.status
    this.code = info.code
    this.requestId = info.requestId
    this.details = info.details
    this.cause = info.cause
  }
}
