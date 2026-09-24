export type TaskStatus = 'QUEUED' | 'RUNNING' | 'REVIEWING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  QUEUED: '排队中',
  RUNNING: '制作中',
  REVIEWING: '待审核',
  WAITING: '等待中',
  SUCCESS: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
}
export const TASK_STATUS_VALUES: TaskStatus[] = Object.keys(TASK_STATUS_LABELS) as TaskStatus[]
export function taskStatusLabel(status: TaskStatus | string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status
}
export type VideoTaskStatus = TaskStatus
export type StageKey = 'SCRIPT' | 'CHARACTER' | 'STORYBOARD' | 'PROMPT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'SUBTITLE' | 'COMPOSE' | 'QA' | 'PUBLISH'
export interface QualityResult { score: number; passed: boolean; threshold: number; criteria: { name: string; score: number; passed: boolean; reason: string }[]; suggestions: string[] }
export interface TaskLog { id: string; time: string; level: 'info' | 'error' | 'warn'; message: string }
export interface PipelineStage { key: string; name: string; status: 'pending' | 'running' | 'success' | 'failed'; duration: number; input: string; output: string; prompt: string; model: string; workflow: string; seed: number; score?: number; error?: string }
export interface Character { id: string; name: string; age: number; gender: string; identity: string; appearance: string; outfit: string; expression: string; pose: string }
export interface VideoShot { id: string; start: number; end: number; description: string; character: string; camera: string; action: string; emotion: string; sound: string; firstPrompt: string; lastPrompt: string; bridge: string; continuity: string }
export interface Storyboard { taskId: string; shots: VideoShot[] }
export interface VideoRequest { title: string; theme: string; type: string; ratio: string; duration: number; platform: string; style: string; characters: string; modelId: string; workflowId: string; scenario: 'normal' | 'quality' | 'system' | 'timeout' }
export interface VideoTask { id: string; title: string; kind: 'video' | 'article'; status: TaskStatus; progress: number; stageIndex: number; stages: PipelineStage[]; createdAt: string; updatedAt: string; elapsed: number; estimated: number; modelId: string; workflowId: string; cover: string; request: VideoRequest; script: string; previousScript: string; characters: Character[]; shots: VideoShot[]; quality: QualityResult | null; logs: TaskLog[]; retries: number; errorType?: 'quality' | 'system' | 'timeout'; error?: string; approved: boolean }
export interface HotTopic { id: string; title: string; category: string; heat: number; growth: number; sources: { name: string; url: string; publishedAt: string; fetchedAt: string }[]; summary: string; analysis: { label: string; type: '事实' | 'AI 推断' | '用户观点' | '待核实'; text: string }[]; risk: string; analyzed: boolean }
export interface Article { id: string; topicId: string; taskId: string; title: string; outline: string; body: string; platform: string; status: 'draft' | 'review' | 'approved'; updatedAt: string; safety: { name: string; status: '待核实' | '通过' | '风险'; reason: string }[] }
export interface Workflow { id: string; name: string; type: string; provider: string; version: string; active: boolean; description: string; mapping: Record<string, string>; history: { version: string; time: string; description: string }[] }
export interface AIModel { id: string; name: string; provider: string; capability: 'LLM' | 'Vision' | 'Image' | 'Video' | 'Audio' | 'Embedding'; enabled: boolean; connected: boolean; calls: number; latency: number; failureRate: number }
export interface Asset { id: string; name: string; type: '图片' | '视频' | '音频' | '角色' | '剧本' | '分镜' | '文章'; url: string; cover: string; tags: string[]; taskId: string; model: string; createdAt: string; duration?: number; resolution?: string; content?: string; provider?: ProviderKind; workflowVersion?: string; prompt?: string; seed?: number; executionId?: string; pipelineId?: string; stageId?: string }
export interface Settings { threshold: number; maxRetries: number; maxIterations: number; autoRetry: boolean; stageDuration: number }
export interface Database { version: number; tasks: VideoTask[]; topics: HotTopic[]; articles: Article[]; assets: Asset[]; workflows: Workflow[]; models: AIModel[]; settings: Settings; pipelines?: PipelineDefinition[]; executions?: StageExecution[]; traces?: ProductionTrace[]; comfyInstances?: ComfyUIInstance[]; comfyExecutions?: ComfyUIExecution[]; providerRegistry?: WorkspaceProviderRegistration[]; qualityConfigs?: QualityGateConfig[] }
export type TaskAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'approve' | 'reject' | 'skip' | 'wait'

// Optional for persisted records created before execution snapshots were introduced.
export interface VideoTask {
  repairPrompt?: string
  qualityRepairs?: { attempt: number; stageKey: string; time: string; before: string; after: string; reason: string }[]
}
export interface StageExecution {
  modelId?: string
  stageKey?: string
  stageIndex?: number
  prompt?: string
  seed?: number
  quality?: QualityResult | null
}
export interface ComfyUIExecution {
  modelId?: string
  workflowVersion?: string
  workflowRevisionId?: string
}
export interface Asset {
  workflowId?: string
  traceId?: string
  attempt?: number
}

export type ProviderKind = 'Mock' | 'ComfyUI'
export type WorkflowKind = 'text' | 'image' | 'video' | 'audio' | 'vision' | 'embedding'
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED'
export interface ExecutionError { code: string; type: 'quality' | 'system' | 'timeout' | 'cancelled'; message: string; retryable: boolean }
export interface ExecutionLog { id: string; time: string; level: 'info' | 'warn' | 'error'; message: string; traceId: string; executionId: string }
export interface PipelineStageDefinition { id: string; key: string; name: string; workflowKind: WorkflowKind; provider?: ProviderKind; modelId?: string; workflowId?: string; optional?: boolean; manual?: boolean }
export interface PipelineDefinition { id: string; kind: 'video' | 'article'; version: string; stages: PipelineStageDefinition[] }
export interface StageExecution { id: string; taskId: string; pipelineId: string; stageId: string; provider: ProviderKind; workflowId: string; workflowVersion: string; status: ExecutionStatus; attempt: number; traceId: string; startedAt: string; finishedAt?: string; input: string; output: string; error?: ExecutionError; logs: ExecutionLog[] }
export interface ProductionTrace { id: string; taskId: string; pipelineId: string; stageId: string; executionId: string; provider: ProviderKind; status: ExecutionStatus; attempt: number; startedAt: string; finishedAt?: string; error?: ExecutionError }
export interface ProviderRegistration { provider: ProviderKind; workflowKinds: WorkflowKind[] }
// Workspace metadata includes server services, unlike the local stage executor registry.
export interface WorkspaceProviderRegistration { provider: ProviderKind | 'COMFYUI' | 'OPENAI' | 'OLLAMA'; workflowKinds: WorkflowKind[] }
export interface QualityGateConfig { stageId: string; threshold: number; criteria?: string[]; enabled?: boolean }
export interface ComfyUIHealth { status: 'unknown' | 'healthy' | 'unhealthy'; checkedAt: string; simulated: boolean; message: string }
export interface ComfyUIInstance { id: string; name: string; baseUrl: string; enabled: boolean; connected: boolean; health: ComfyUIHealth }
export interface ComfyUIExecution { id: string; instanceId: string; workflowId: string; status: ExecutionStatus; createdAt: string; updatedAt: string; inputs: Record<string, import('../providers/contracts').JsonValue>; taskId?: string; stageId?: string; promptId?: string; files: import('../providers/comfyui').ComfyFile[]; error?: ExecutionError }
export interface ComfyUIQueueItem { executionId: string; instanceId: string; status: 'QUEUED' | 'RUNNING'; position: number }
export interface ComfyUIEngineDatabase { comfyInstances?: ComfyUIInstance[]; comfyExecutions?: ComfyUIExecution[] }
