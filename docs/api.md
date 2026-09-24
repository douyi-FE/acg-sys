# API 契约与 HTTP 客户端

## 当前状态（重要）

**当前没有实现或启动 HTTP 后端。以下端点是待后端实现的契约，不是已上线服务。**

当前 Pinia `factory` 直接导入 `mockApi`，通过本地 Mock Service、localStorage 和本地定时器推进任务；120ms 延迟只是 UI 模拟延迟。Vite 是前端开发服务器，不是业务 API 服务器。新增 `HttpApiClient` 未接入 Pinia，也不会启动服务器或在请求失败后偷偷退回 Mock。

领域类型复用 `src/types/index.ts`；分页、可编辑 DTO、仪表盘汇总和传输选项定义在 `src/api/types.ts`。`ApiClient` 为异步、传输无关接口；`HttpApiClient` 是其 fetch 实现。现有同步 Mock API **不是**此接口的直接实现。

## 公共约定

- 默认 API 前缀 `/api`，可配置为 `https://backend.example/api`，不要重复添加 `/api`。URL 不得包含用户名、密码、查询串或 hash。
- 请求/响应使用 JSON。所有成功响应为 `{ "data": ... }`；客户端返回解包后的 `data`。
- 创建返回 201，其他成功返回 200。删除也返回 JSON，不返回 204。`data` 不可缺少或为 null。
- 列表返回 `Page<T>`：`items`、`total`、`page`、`pageSize`。建议后端默认 page=1、pageSize=20；二者是正整数。`search` 是可选文本搜索；查询字段缺省时不发送。
- ID 被编码为单个 URL 路径段；空白 ID、`.` 和 `..` 被拒绝。
- 时间字段使用 ISO 8601 字符串。任务/文章状态及字段遵循领域类型，不另造状态：暂停使用 `WAITING`，没有 `PAUSED`。
- HTTP 客户端校验 JSON 和成功信封；TypeScript 不等于运行时 schema 校验，**没有逐字段验证领域对象**。接入不可信后端时，应增加领域校验和契约测试。

## 端点

以下路径均相对于 `/api`；表中返回类型均指 `data`。

| 方法 | 路径 | 请求体 / 查询 | 返回 |
| --- | --- | --- | --- |
| POST | `/video/tasks` | `VideoRequest` | `VideoTask` |
| GET | `/video/tasks` | `TaskQuery` | `Page<VideoTask>`，只含视频 |
| GET | `/video/tasks/:id` | — | `VideoTask` |
| POST | `/video/tasks/:id/actions` | `{ action: TaskAction }` | 更新后的 `VideoTask` |
| GET | `/tasks` | `TaskQuery` | `Page<VideoTask>`，包括文章任务 |
| GET | `/tasks/:id` | — | `VideoTask` |
| POST | `/tasks/:id/actions` | `{ action: TaskAction }` | 更新后的 `VideoTask` |
| PATCH | `/tasks/:id` | `TaskUpdate` | 更新后的 `VideoTask` |
| GET | `/hot-topics` | `ListQuery` | `Page<HotTopic>` |
| POST | `/hot-topics/:id/analyze` | 无 | `HotTopic` |
| POST | `/articles` | `{ topicId: string }` | `Article` |
| GET | `/articles` | `ListQuery` | `Page<Article>` |
| GET | `/articles/:id` | — | `Article` |
| PATCH | `/articles/:id` | `ArticleUpdate` | 更新后的 `Article` |
| GET | `/assets` | `AssetQuery` | `Page<Asset>` |
| GET | `/assets/:id` | — | `Asset` |
| DELETE | `/assets/:id` | — | `boolean` |
| GET | `/workflows` | `ListQuery` | `Page<Workflow>` |
| GET | `/workflows/:id` | — | `Workflow` |
| PUT | `/workflows/:id` | `Workflow`，body.id 与路径一致 | `Workflow` |
| GET | `/models` | `ListQuery` | `Page<AIModel>` |
| GET | `/models/:id` | — | `AIModel` |
| PATCH | `/models/:id` | `{ enabled: boolean }` | `AIModel` |
| GET | `/dashboard` | — | `Dashboard` |
| GET | `/settings` | — | `Settings` |
| PUT | `/settings` | `Settings` | `Settings` |

`ListQuery`：page、pageSize、search。`TaskQuery` 额外支持 status、kind（video/article）；视频列表中 kind 只能省略或使用 video，后端应拒绝 article。`AssetQuery` 额外支持 type、taskId。

`TaskAction` 完整取值：retry、cancel、pause、resume、approve、reject、skip、wait。统一通过 actions 端点 POST，不是 GET，也不在客户端直接修改状态。

任务编辑只接受 title、script、characters、shots；文章编辑只接受 title、outline、body、platform、safety，以及 draft/review 状态。关联 ID、时间、进度、评分、重试计数和 approved 不可通过编辑绕过审核。后端必须校验权限、状态迁移、模型/工作流可用性、字段白名单，不能仅信任 TypeScript。当前 Mock 的状态机应作为迁移参考，终态不可任意修改。

## JSON 示例

创建视频请求（`POST /api/video/tasks`）：

```json
{
  "title": "城市漫游", "theme": "未来城市", "type": "短视频",
  "ratio": "9:16", "duration": 30, "platform": "抖音",
  "style": "动漫", "characters": "旅行者",
  "modelId": "video-model", "workflowId": "video-workflow", "scenario": "normal"
}
```

`scenario` 来自当前领域类型，用于 Mock 故障场景；生产后端应仅接受 normal 或忽略该测试开关，禁止普通用户触发故障注入。ID 示例不代表真实后端存在这些配置。

空任务列表响应：

```json
{ "data": { "items": [], "total": 0, "page": 1, "pageSize": 20 } }
```

文章详情/编辑响应示例：

```json
{
  "data": {
    "id": "article-1", "topicId": "topic-1", "taskId": "task-1",
    "title": "话题观察", "outline": "一、概述", "body": "正文待核验",
    "platform": "微信公众号", "status": "draft",
    "updatedAt": "2026-09-23T08:00:00.000Z",
    "safety": [{ "name": "来源核验", "status": "待核实", "reason": "尚未补充来源" }]
  }
}
```

仪表盘响应：

```json
{
  "data": {
    "totalTasks": 0,
    "tasksByStatus": { "QUEUED": 0, "RUNNING": 0, "REVIEWING": 0, "WAITING": 0, "SUCCESS": 0, "FAILED": 0, "CANCELLED": 0 },
    "totalAssets": 0, "totalArticles": 0, "enabledModels": 0, "activeWorkflows": 0
  }
}
```

删除成功：`{ "data": true }`。创建任务、详情和 action 均返回完整 `VideoTask`，不是仅返回 ID；其字段包含 request、stages、logs、quality 等，严格以领域类型为准。

错误响应示例（HTTP 409）：

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "终态任务不能暂停",
    "details": { "status": "SUCCESS", "action": "pause" }
  },
  "requestId": "req-123"
}
```

建议状态码：400 参数错误，401 未登录，403 无权限，404 不存在，409 状态冲突，422 业务校验失败，429 限流，500/502/503 服务端失败。业务失败不得伪装成 HTTP 200。

## 错误与取消

统一抛出 `ApiError`，通过 `kind` 判别：

| kind | 含义 |
| --- | --- |
| `http` | 非 2xx；保留 status，以及合法错误体中的 code/message/details/requestId |
| `network` | fetch 拒绝、CORS/断网、响应体读取失败；浏览器通常不能区分具体网络原因 |
| `timeout` | 超过客户端等待时间 |
| `aborted` | 调用方 AbortSignal 取消 |
| `invalid-response` | 2xx 返回非法 JSON、缺少 data、data=null 或 204 |
| `invalid-request` | 无效配置、ID、分页或无法序列化的请求体 |

`ApiError` 还提供可选 cause。HTTP 错误的 `x-request-id` 响应头优先于错误体 requestId。非 JSON 错误页面不作为 message 展示，仍保留 HTTP 状态；不要将未经脱敏的 details/cause 写入公共日志。

默认 timeoutMs=15000，可逐请求覆盖，要求正有限数且不超过 2147483647。每次请求独立创建 AbortController，timeout 覆盖 fetch 和响应体读取，结束时清理 timer/外部 abort 监听器。预先取消不发起 fetch。外部 signal 不被客户端反向中止。

HTTP 客户端不自动重试。**中止 fetch/超时不等于取消服务端任务**：任务 cancel 必须调用 action；POST 超时后结果可能已经落库，应先查询/对账再决定是否重试。真实后端接入时需设计幂等键，避免重复创建和重复计费。

## 调用示例

```ts
import { ApiError, HttpApiClient, type ApiClient } from '@/api'

const api: ApiClient = new HttpApiClient({ baseUrl: '/api', timeoutMs: 15_000 })
const controller = new AbortController()
try {
  const page = await api.listTasks(
    { page: 1, pageSize: 20, status: 'FAILED' },
    { signal: controller.signal },
  )
  console.log(page.items)
} catch (error) {
  if (error instanceof ApiError && error.kind === 'aborted') {
    // 组件离开导致的主动取消，不必显示失败提示。
  } else {
    throw error
  }
}
// 组件卸载时调用 controller.abort()。
```

以上仅为接入示例，当前页面不会执行这些请求。若工程没有 `@` 别名，请使用对应的本地模块导入路径。

## 迁移到真实后端

1. 先实现并验证上表 HTTP 契约、鉴权、字段白名单和服务端状态机；业务调度、AI 调用、重试及审核逻辑放在后端。本次不提供后端实现。
2. 后端保管模型/供应商 API Key，绝不写入 VITE_*、前端环境变量、localStorage、请求参数或打包产物。客户端不提供供应商密钥配置；models/workflows 接口也不得返回密钥。前端只持有不敏感 ID/展示元数据。
3. 优先同源 `/api` 反向代理及 HttpOnly/Secure/SameSite 会话 Cookie。默认 credentials=same-origin；跨域显式设置 include，后端精确配置 CORS、允许凭证及 CSRF 防护，不能使用通配 Origin。生产使用 HTTPS。
4. 在后续授权改动中，通过依赖注入提供 `ApiClient`，将 Pinia 的同步 `run(() => mockApi...)` 改成真正 await 异步调用，再更新对应实体。不能只替换 import：目前 store 依赖 getDb/refresh/subscribe/tick，HTTP 接口没有这些本地数据库操作。
5. 初始化通过列表、详情、dashboard/settings 分别加载；正确处理分页，不能把第一页视为全部数据库。saveArticle/saveTask 映射为受限 update DTO；模型 toggle 改成提交显式 enabled 值，避免重试反转。
6. 解除 Mock subscribe 定时推进，改为后端任务列表/详情轮询或以后约定的 SSE/WebSocket；组件离开时取消请求，防止过期结果覆盖新状态。此客户端当前不实现推送。
7. 如需维持双模式，另写实现同一 `ApiClient` 的 Mock adapter，明确配置 Mock/HTTP，禁止 HTTP 失败时静默降级。本地 Mock 数据不会自动上传到后端；迁移导入应单独确认与设计。
8. 联调真实后端并增加契约/E2E 测试后，才能宣称 HTTP 路径已运行。此阶段单元测试使用注入 fetch，只验证客户端行为，不证明服务器可用。

测试：使用现有 Vitest 运行 `npm test -- tests/api.test.ts`，不需要新增依赖。
