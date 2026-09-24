# 第二阶段架构：浏览器持久化编排与 ComfyUI

## 1. 本轮交付边界

本轮实现是浏览器持久化编排、Workflow 文件版本管理、结构化阶段记录，以及可显式调用的真实 ComfyUI HTTP 能力。它不是服务器常驻生产平台；**没有业务 HTTP 后端不构成本轮未完成的判据**。服务端 worker、分布式调度、WebSocket 事件流、真实模型探测均不宣称已实现。

依据：`src/types/index.ts`、`src/orchestrator/*`、`src/workflow/versions.ts`、`src/services/mock.ts`、`src/services/comfyui-engine.ts`、`src/engine/comfy-client.ts`、`src/stores/factory.ts`、当前 router/UI，以及 `src/api/engine.ts`。

## 2. 实体语义与关系

| 实体 | 回答的问题 | 当前实现 |
| --- | --- | --- |
| Task（`VideoTask`，也承载 article） | 做什么 | 请求、创作内容、当前阶段、状态、审核与结果 |
| PipelineDefinition / PipelineStageDefinition | 按哪些步骤做 | 视频/文章阶段定义；阶段可指定 provider/model/workflow |
| StageExecution | 某阶段这一次怎么执行 | taskId、pipelineId、stageId、attempt、provider、workflowVersion、输入/输出、日志、error、traceId |
| Provider | 谁以什么能力执行 | `Mock` / `ComfyUI`，通过 ProviderRegistry 按 WorkflowKind 解析 |
| Workflow / WorkflowRevision | 用什么配置做 | 元数据与不可变 API/UI/Mapping 文件快照分离 |
| **ComfyUIInstance** | **在哪里做** | **部署服务**；id、name、baseUrl、enabled、connected、health |
| **ComfyUIExecution** | **该服务提交的哪一个作业** | **prompt job**；instanceId、promptId、workflowId、revision、taskId/stageId、状态、inputs、files |
| Asset | 产出了什么、来自哪里 | 内容/URL 与可选 executionId、provider、pipelineId、stageId、workflowVersion 等来源字段 |
| ProductionTrace | 哪个阶段尝试发生了什么 | 与 StageExecution 关联的状态摘要、attempt、时间和错误 |

```text
Task ── PipelineDefinition ── PipelineStageDefinition
  └─ 多个 StageExecution（同一 task/stage 的 attempt 递增）
       ├─ ProductionTrace（executionId / traceId 关联）
       └─ Asset（有显式来源时关联，不推测旧历史）

ProviderRegistry: Mock / ComfyUI
ComfyUIInstance（部署地址）1 ── N ComfyUIExecution（prompt job）
ComfyUIExecution ── taskId + stageId + workflowId ── 阶段产物消费
Workflow 1 ── N WorkflowRevision；activeRevisionId 指向活动快照
```

当前没有独立的“Task 全流程 Execution 聚合”类型，不能把它写成已实现实体。`db.executions` 是 StageExecution[]，`db.comfyExecutions` 是 ComfyUIExecution[]，两者不能混用。StageExecution 与 ComfyUIExecution 不是按相同 id 一一关联：编排器匹配 task/stage/workflow，成功输出包含 ComfyUI executionId/promptId/files。

`connected` 表示连接授权/配置，不等于健康检查成功。Instance 不会因为创建了一条 prompt job 而被创建；一个部署服务可以承载多个作业。

## 3. 已实现分层

```text
Vue 页面 / EngineStatus / ProductionTracePanel
  -> Pinia factory（异步操作、loading/error、订阅快照）
  -> services/mock（本地持久化服务，不是“全部调用都为假”）
       -> Orchestrator -> ProviderRegistry / Pipeline / QualityGate
       -> ComfyUIEngine -> ComfyUIAdapter -> 原生 HTTP
       -> WorkflowVersionRegistry（独立 localStorage 文件版本库）

ComfyHttpClient：另一条原生 HTTP 客户端能力，不等于所有 UI 都已使用它
EngineHttpApiClient：业务 HTTP 传输契约，不启动服务器，当前 store 不经它调度
```

### 浏览器持久化编排

- 工作空间存储键为 `acg-content-factory-db`。v2 可缺省新增集合，经校验加载后升级为 v3；成功事务写入持久化。
- 创建任务调用 Orchestrator.submit，tick 调用 Orchestrator.tick，人工动作调用 Orchestrator.action；不是绕过编排器直接写成功。
- 250ms 订阅 timer 驱动推进，实际阶段还受 stageDuration 约束。最后订阅者离开时停止。
- 真正推进阶段时建立 StageExecution 和 ProductionTrace。重试保留旧记录；approve/skip 也形成记录。
- 每次事务重新读取持久化快照，减少旧标签页缓存覆盖；这不是跨标签页原子事务或分布式锁。
- 网络操作在本地同步事务外执行，通过进度回调持久化状态和 promptId；迟到成功不能覆盖已经取消的记录。探测期间实例变更会拒绝旧健康结果回写。
- 刷新后可以查看持久化任务/执行，不代表关闭浏览器后仍在调度，也不代表 RUNNING prompt 会自动恢复轮询。

### Workflow 文件版本

`WorkflowVersionRegistry` 使用 `acg-workflow-versions-v1`，保存完整 API Workflow、UI Workflow、Mapping 快照；版本不可覆盖。激活、停用、回滚只切换 activeRevisionId。

UI JSON 是画布存档，不能作为 `/prompt` 输入。激活要求 API graph 和非空合法 Mapping；空图、无效节点、重复映射目标等由解析器拒绝。激活不验证远端已安装所有节点/模型，也不提交作业。

Engine.configureActive 读取活动快照；入队记录 workflowVersion/workflowRevisionId，运行时活动 revision 不匹配则拒绝并要求重新入队。它不是自动把队列中的旧作业升级为新版本。

旧 Workflow metadata 的 history 仍只是版本说明；不能把元数据行的“回滚不可用”扩大成文件版本库完全不支持回滚。

### Provider、质量与资产

Mock 支持 text/image/video/audio/vision/embedding 模拟能力；ComfyUI registry 支持 image/video/audio。不存在的 provider/capability 明确拒绝，没有 HTTP 失败转 Mock 的路径。

ComfyUI 阶段消费已成功、有 promptId/files、匹配 task/stage/workflow、尚未消费的真实结果；未通过真实健康检查拒绝消费。同步 Orchestrator 不会自动为每个阶段提交网络作业。

质量门限支持 stage 配置；固定 Mock 评分不能当成真实媒体评价，真实 Provider 的质量阶段没有真实评估器时拒绝使用 Mock 固定分数。

AssetRegistry 只使用显式执行关联，并验证来源一致性；旧资产缺少证据显示 `legacy unavailable`，不按时间或类型猜测来源。同执行相同内容可去重，不跨任务/attempt 仅凭 URL 合并。媒体文件元信息与 URL 不等于对象存储归档、checksum 校验或真实视频已生成。

## 4. 真实 ComfyUI HTTP 能力与 UI 边界

| 层 | 已实现 | 不能据此宣称 |
| --- | --- | --- |
| ComfyUIAdapter | API graph/Mapping 校验；`POST /prompt`，history 轮询；images/gifs/videos/audio 解析；`/view` URL 与 Blob 下载；有界超时/取消 | 节点图必然可运行、原生 POST 幂等、自动恢复所有远端作业 |
| ComfyUIEngine | Instance CRUD；`/system_stats` 真实探测；活动快照配置、入队、执行、进度持久化回调、本地取消 | Mock probe 可授权真实运行；本地取消保证 GPU 停止 |
| ComfyHttpClient | `/system_stats` + `/queue` + `/object_info` 健康信息；submit/status；view URL；排队删除和保守 interrupt | WebSocket 已连接、模型文件可用性已探测、所有 UI 已接该客户端 |
| store/local service | 实例、健康、队列、执行等方法；网络显式调用；拒绝重复活动 stage job | 存在常驻 worker 或任务关闭页面后继续本地调度 |
| 页面 adapter | 从 comfyInstances/comfyExecutions 映射视图；SUCCESS 显示 Completed | 将 VideoTask 当 ComfyUIExecution，或用配置 enabled 推导真实连接 |

ComfyHttpClient 从真实 stats 中读取 GPU/VRAM 字段，缺失则不补造；当前 Engine UI 仍明确显示 GPU/VRAM Unavailable，不提供汇总硬件遥测。`websocket`、`model` 始终是 unavailable；`object_info` 节点类型列表不是模型探测。

原生取消：排队作业调用 `/queue` 删除；仅当队列显示目标为唯一运行作业时才调用实例级 `/interrupt`，否则报 UNSAFE_CANCEL。此检查不是服务器原子租约。ComfyUIEngine.cancel 则只取消本地等待，两条路径语义不可混写。

健康探测与运行都需要显式配置，受 CORS、混合内容、网络和超时约束。不存储供应商密钥；地址不允许内嵌凭据/query/hash。原生 POST 超时可能已受理，不能因 retryable=true 就断言可以安全重复提交。

## 5. 错误分类

- 领域 `ExecutionError`：`code`、`type`、`message`、`retryable`；type 为 quality/system/timeout/cancelled。
- 编排记录：PROVIDER_ERROR、PROVIDER_TIMEOUT、QUALITY_REJECTED 等；StageExecution 与 Trace 保留本次错误。
- Engine 执行：COMFYUI_EXECUTION_FAILED 或 CANCELLED，按超时/系统/取消区分。
- ComfyHttpClient：NETWORK_ERROR、TIMEOUT、WORKFLOW_ERROR、NODE_ERROR、CUDA_OOM、MODEL_MISSING、UNSAFE_CANCEL。部分分类基于错误文本，不是完整远端错误 schema。
- UI 将质量错误显示为 QUALITY_FAILED，其余非取消执行错误显示为 SYSTEM_ERROR；完成不等于质量审核通过。
- HTTP 业务客户端仍使用 ApiError 的 http/network/timeout/aborted/invalid-response/invalid-request；不要将此传输错误 kind 改写成领域 type。
- PersistenceError 明示读取/写入失败，不静默清库。

## 6. 业务 API：以 `src/api/engine.ts` 为准

以下是 **EngineHttpApiClient 已定义的传输契约**，不是已经部署的服务器。默认前缀 `/api`；沿用 HttpApiClient 成功信封 `{ data: ... }`，客户端返回解包结果。

| 方法 | 相对路径 | 客户端方法 / 返回类型 |
| --- | --- | --- |
| GET | `/engine/pipelines` | pipelines / PipelineDefinition[] |
| GET | `/tasks/:taskId/executions` | executions / StageExecution[] |
| GET | `/tasks/:taskId/traces` | traces / ProductionTrace[] |
| GET | `/engines/comfyui/instances` | instances / ComfyUIInstance[] |
| POST | `/engines/comfyui/instances` | createInstance / ComfyUIInstance；body 为 Omit<ComfyUIInstance, 'health'> |
| DELETE | `/engines/comfyui/instances/:id` | deleteInstance / void（TypeScript 声明；仍调用通用 request） |
| PUT | `/engines/comfyui/instances/:id` | saveInstance / ComfyUIInstance；body 为 instance |
| POST | `/engines/comfyui/instances/:id/health` | probeInstance / ComfyUIInstance |
| GET | `/engines/comfyui/queue` | queue / ComfyUIExecution[] |
| GET | `/engines/comfyui/executions/:id` | execution / ComfyUIExecution |
| POST | `/engines/comfyui/executions/:id/cancel` | cancelExecution / ComfyUIExecution |

列表目前是数组，不是分页对象。此类没有创建 task execution、提交 prompt 或 Workflow revision HTTP 端点；不能把本地 service 方法伪写成已经存在的业务 API。路径 ID 通过通用 segment 校验并编码。deleteInstance 的 void 声明不应被解释为自动支持 HTTP 204，响应解析仍以通用 HttpApiClient 为准。原生 ComfyUI 的 `/prompt` 等端点与上表业务 API 是两个协议层。

## 7. 当前页面及验收

| 路由/入口 | 实际含义 |
| --- | --- |
| 全局 `AI Engine` 按钮 | Drawer 展示 LLM、Vision、ComfyUI、GPU/VRAM、Queue 摘要；进入 Engine Center |
| `/engine` | 部署实例配置、启用状态、健康信息、队列摘要 |
| `/comfyui` | Execution Queue 与 Workflow Registry 两个页签；不是 `/queue` |
| `/comfyui/executions/:id` | prompt job 详情；未找到记录明确报告，不伪造事件 |
| `/workflows` | metadata 与文件快照版本面板 |
| `/tasks/:id` 的 Production Trace | 真实产生的阶段尝试、关联 Workflow/version、日志和 JSON 导出；不是独立 Workflow trace 路由 |

当前 EngineCenter 直接调用 store 的实例保存、probeComfyHealth、deleteComfyInstance；ComfyUICenter 提交表单显式选择 instance/workflow/task/stage 与语义输入，用户勾选真实网络请求同意后调用 enqueueComfy/runComfy；ExecutionDetail 调用 cancelComfy。网络同意与合法配置是前置条件，不伪造保存、探测或运行成功。Queue 仍只展示实际 comfyExecutions，缺省集合显示 Unavailable。

E2E 使用上述现有页面，不添加假路由、不大批 skip、不注入虚构执行记录。通过 UI 创建部署配置和 Mock 任务、观察持久化、查看阶段 Trace；测试 Mock 阶段不声称调用真实 GPU。Workflow JSON 测试只验证导入/版本规则，不执行测试节点。390/768/1440px 检查整页横向溢出及 Drawer 边界；手机 JSON 编辑明确为 PC 优先。

本次验证：`phase2.spec.ts` 共 15 项，三个视口全部通过，0 skip（58.7s）。ESLint 与该文件独立 TypeScript noEmit 检查通过。Trace 测试还解析实际导出 JSON，验证 taskId、executionId、traceId 与 Mock provider 对应；Workflow 展示与持久化 StageExecution 对照，不误用 Task 的视频 Workflow 作为 SCRIPT 的文本 Workflow。测试没有连接真实 ComfyUI，不能据此报告远端 GPU、模型、媒体生成或取消已实测成功。

## 8. 后续演进（非本轮必做）

如需多人共享、关闭浏览器持续生产、可靠取消与幂等提交，再将持久化/调度端口迁移到服务端 worker、事务库、对象存储，并增加授权、审计、网络隔离与对账。迁移时保留 StageExecution、ComfyUIExecution 和 Instance 的现有语义，不把本地 Mock 记录转换成真实历史。

当前全库读写、跨标签页竞争、队列优先级/并发仅元数据、没有 WS/模型探测、没有真实质量 evaluator 都是已知边界；不通过编写尚不存在的后端验收来取代本轮浏览器能力验收。
