import type {
  AIModel,
  Article,
  Asset,
  HotTopic,
  Settings,
  TaskAction,
  TaskStatus,
  VideoRequest,
  VideoTask,
  Workflow,
} from '../types'

export interface RequestOptions {
  signal?: AbortSignal
  /** 包含响应体读取时间；默认 15 秒，必须为正有限数。 */
  timeoutMs?: number
}
export interface ListQuery {
  page?: number
  pageSize?: number
  search?: string
}
export interface TaskQuery extends ListQuery {
  status?: TaskStatus
  kind?: VideoTask['kind']
}
export interface AssetQuery extends ListQuery {
  type?: Asset['type']
  taskId?: string
}
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export interface ApiResponse<T> {
  data: T
}
export interface ApiErrorResponse {
  error: { code: string; message: string; details?: unknown }
  requestId?: string
}
/** 审核只能通过任务 action 完成，不能编辑关联 ID / 更新时间。 */
export type ArticleUpdate = Partial<Pick<Article, 'title' | 'outline' | 'body' | 'platform' | 'safety'>> & {
  status?: Exclude<Article['status'], 'approved'>
}
export type TaskUpdate = Pick<VideoTask, 'title' | 'script' | 'characters' | 'shots'>
export interface Dashboard {
  totalTasks: number
  tasksByStatus: Record<TaskStatus, number>
  totalAssets: number
  totalArticles: number
  enabledModels: number
  activeWorkflows: number
}

/** 与传输层无关；真实后端或另行编写的 Mock adapter 均可实现此接口。 */
export interface ApiClient {
  createVideo(request: VideoRequest, options?: RequestOptions): Promise<VideoTask>
  listVideoTasks(query?: TaskQuery, options?: RequestOptions): Promise<Page<VideoTask>>
  getVideoTask(id: string, options?: RequestOptions): Promise<VideoTask>
  videoAction(id: string, action: TaskAction, options?: RequestOptions): Promise<VideoTask>
  listTasks(query?: TaskQuery, options?: RequestOptions): Promise<Page<VideoTask>>
  getTask(id: string, options?: RequestOptions): Promise<VideoTask>
  action(id: string, action: TaskAction, options?: RequestOptions): Promise<VideoTask>
  updateTask(id: string, update: TaskUpdate, options?: RequestOptions): Promise<VideoTask>
  listHotTopics(query?: ListQuery, options?: RequestOptions): Promise<Page<HotTopic>>
  analyzeTopic(id: string, options?: RequestOptions): Promise<HotTopic>
  createArticle(topicId: string, options?: RequestOptions): Promise<Article>
  listArticles(query?: ListQuery, options?: RequestOptions): Promise<Page<Article>>
  getArticle(id: string, options?: RequestOptions): Promise<Article>
  updateArticle(id: string, update: ArticleUpdate, options?: RequestOptions): Promise<Article>
  listAssets(query?: AssetQuery, options?: RequestOptions): Promise<Page<Asset>>
  getAsset(id: string, options?: RequestOptions): Promise<Asset>
  deleteAsset(id: string, options?: RequestOptions): Promise<boolean>
  listWorkflows(query?: ListQuery, options?: RequestOptions): Promise<Page<Workflow>>
  getWorkflow(id: string, options?: RequestOptions): Promise<Workflow>
  saveWorkflow(workflow: Workflow, options?: RequestOptions): Promise<Workflow>
  listModels(query?: ListQuery, options?: RequestOptions): Promise<Page<AIModel>>
  getModel(id: string, options?: RequestOptions): Promise<AIModel>
  setModelEnabled(id: string, enabled: boolean, options?: RequestOptions): Promise<AIModel>
  getDashboard(options?: RequestOptions): Promise<Dashboard>
  getSettings(options?: RequestOptions): Promise<Settings>
  saveSettings(settings: Settings, options?: RequestOptions): Promise<Settings>
}
