# V0.1 到第二阶段：架构审查

## 结论与范围

第二阶段已从纯本地 Mock 状态机发展为**浏览器持久化编排 + 显式真实 ComfyUI HTTP 执行能力**。缺少独立业务后端、服务器 worker 不是本轮失败条件。本文依据当前 types、orchestrator、workflow、engine、service、store 和 UI，区分历史问题、已完成改进与残余边界；详细 API 与实体说明见同目录 `phase2-architecture.md`。

必须统一的术语：

- Task：做什么；StageExecution：某阶段的一次尝试。
- Provider：谁执行/支持什么能力；Workflow：使用什么配置。
- **ComfyUIInstance：在哪里做，是部署服务和 baseUrl，不是 prompt job。**
- **ComfyUIExecution：一次 prompt job，通过 instanceId 指向部署服务，通过 promptId 对应远端作业。**
- Asset：产物和来源；ProductionTrace：StageExecution 的结构化追踪摘要。

当前 `db.executions` 不是 Task 全流程运行聚合，不能与 `db.comfyExecutions` 混同。不存在独立 `/instances/:id`、`/queue`、`/workflows/:id/trace` 页面。

## V0.1 问题及已实现改进

| V0.1 问题 | 当前代码证据 | 第二阶段改进 | 剩余边界 |
| --- | --- | --- | --- |
| Task 同时承载当前阶段和重试状态，旧阶段快照被重置 | `src/orchestrator/engine.ts` start/finish/action；`src/types/index.ts` StageExecution | 每次阶段尝试独立记录 attempt、输入输出、错误、日志及 Trace；重试保留记录 | Task 仍保留兼容 stages；没有独立全流程 Execution 聚合 |
| 生产调度和 Provider 调用缺少明确边界 | `src/orchestrator/contracts.ts`、`registry.ts`、`engine.ts` | Registry 按能力解析；同步编排消费真实 Engine 已完成产物，不隐式回退 Mock | 不是自动 dispatch 所有网络阶段的异步 worker |
| 只存 Workflow metadata/history，无法恢复文件 | `src/workflow/versions.ts`、`src/components/WorkflowVersionsPanel.vue` | API/UI/Mapping 完整不可变快照，激活/停用/回滚切换指针 | metadata 与文件版本独立存储；本地激活不证明远端节点模型存在 |
| 只有字符串 TaskLog，产物来源难追踪 | `src/components/ProductionTracePanel.vue`、`src/orchestrator/asset-registry.ts` | StageExecution/ProductionTrace 和执行日志关联；资产显式关联并校验来源 | 不是追加式分布式 span/event 后端；旧历史不补造 |
| ComfyUI Adapter 孤立于工作空间 | `src/services/mock.ts`、`src/services/comfyui-engine.ts`、`src/stores/factory.ts` | 本地 service/store 提供实例、探测、入队、执行、取消及进度持久化 | 页面仍需按已暴露方法显示能力，不能把底层方法存在当成整条 UI 链路已接通 |
| 旧标签页缓存容易覆盖后续数据 | `src/services/mock.ts` transaction/tick | 每次从最新 storage 快照计算并校验、提交；升级 v2 → v3 | 没有原子跨标签页读改写，不能宣称分布式事务安全 |

## 当前层次与关系

```text
UI -> factory store -> 本地持久化 service
                         ├─ Orchestrator -> ProviderRegistry -> StageExecution/Trace
                         ├─ ComfyUIEngine -> Adapter -> 原生 ComfyUI HTTP
                         └─ WorkflowVersionRegistry -> 独立文件版本存储

ComfyUIInstance 1:N ComfyUIExecution
Task + StageDefinition 1:N StageExecution（attempt）
ComfyUIExecution 通过 task/stage/workflow 与编排产物消费关联
StageExecution -> ProductionTrace / 显式来源 Asset
```

网络不进入同步 localStorage 更新函数。ComfyUI job 入队绑定活动 Workflow revision，提交获得 promptId 后回调持久化；活动版本改变则拒绝执行旧入队配置。真实输出必须匹配当前 task/stage/workflow 且未被消费，不能拿无关成功记录推进 Task。

`mockApi` 是历史命名，当前承担本地持久化服务，不代表内部所有能力都是 Mock。`EngineHttpApiClient` 是另一个传输契约，store 没有通过它访问一个已部署后端。

## 残余风险与实际限制

### Major：浏览器运行与持久化边界

**证据：** `src/services/mock.ts` 的 subscribe/transaction/tick，`src/stores/factory.ts` 的 init/dispose。

关闭页面后本地 timer 不继续运行；刷新只能读取已有记录，不等于自动恢复远端 RUNNING 作业。全库克隆、校验、JSON 序列化和同步 storage 写入会随任务/日志量放大。重新读取最新快照降低陈旧覆盖，但不解决两个标签页并发读改写。

**处理：** 本轮如实声明单浏览器工作空间范围，保留导出和损坏数据错误；后续若升级托管服务再引入 worker/事务库。没有性能实测，不给出虚构吞吐和延迟。

### Major：原生提交没有幂等保证，取消语义分层

**证据：** `src/providers/comfyui.ts` generate，`src/services/comfyui-engine.ts` run/cancel，`src/engine/comfy-client.ts` cancel。

promptId 早期回写改善追踪，但 POST 超时仍可能“远端已受理、客户端没收到 id”。retryable 不能被解释为安全重复提交。Engine.cancel 是本地取消，不保证远端 GPU 停止；ComfyHttpClient 仅在队列证据允许时删除 prompt 或 interrupt。实例级 interrupt 的检查与执行之间仍有竞争窗口。

**处理：** 保留取消说明，不把任一取消动作当成已验证的远端终止；有 promptId 先查 history/queue，无 id 的不确定提交不能盲目重发。

### Major：服务层、页面和能力显示不能互相冒充

**证据：** `src/pages/comfyui/engineAdapter.ts`、EngineCenter/ComfyUICenter/ExecutionDetail 与 factory store。

页面通过 store 命令和 adapter 投影读数据。EngineCenter 已接实例 CRUD/探测，ComfyUICenter 已接显式授权的 enqueueComfy/runComfy，详情页调用 cancelComfy。`comfyExecutions` 未建立时显示 Unavailable 与已建立的空队列不是同一状态。生产任务不等于 ComfyUI job；无日志不能补出 Node Start/Complete。Production Trace 在任务详情，不能虚构 Workflow Trace 独立路由。

**处理：** E2E 对现有入口、命令、实际空态和不可用状态断言；不会通过假响应、注入成功作业或跳过测试制造能力证明。

### Minor：元数据与可执行文件版本需要清晰区分

**证据：** WorkflowCenter、ComfyUICenter 的 metadata 部分与 WorkflowVersionsPanel。

旧 metadata 的历史只有说明，而文件版本库已经有完整快照。旧区域的“回滚不可用”不能用来否认新面板能力；新面板的 Active 也不能解释成真实服务已部署。API graph 校验不是远端模型/节点安装校验。

### Minor：Trace 与资产来源覆盖仍有限

**证据：** `src/orchestrator/asset-registry.ts`、`src/components/ProductionTracePanel.vue`。

AssetRegistry 优先显式 executionId，不猜旧数据；Trace 依赖实际保存的 StageExecution 字段，模型/Prompt/Seed 缺失时不能回填猜测。当前 URL/文件元信息不等于对象存储、checksum 校验或自动媒体归档。

## Mock、真实 HTTP 与未实现能力

| 已实现本地能力 | 已实现真实 HTTP 能力 | 未实现/未证明 |
| --- | --- | --- |
| Pipeline、StageExecution、ProductionTrace 持久化 | Adapter 的 prompt/history/view | 业务 HTTP 服务、服务器常驻 worker |
| Instance 配置与健康结果保存 | Engine 的 `/system_stats` 校验与显式执行 | WebSocket 连接和节点实时事件 |
| Workflow 快照和活动指针 | ComfyHttpClient 的 stats/queue/object_info、submit/status/cancel | 真实模型文件探测与质量 evaluator |
| Mock 评分、文本/JSON 产物与人工审核 | stats 响应中真实 GPU/VRAM 字段解析 | UI 汇总硬件遥测、远端生成成功实测 |

模型 enabled、实例 connected、Mock probe healthy 都不能作为真实健康授权。真实运行需显式网络配置、非模拟健康检查和有效活动 API 快照。地址仅允许无凭据的 HTTP(S)；不要把 API key 放进 localStorage 或 VITE_*。浏览器真实请求仍受 CORS/混合内容限制。

## 错误和 API

领域错误 `ExecutionError.type` 为 quality/system/timeout/cancelled；ComfyHttpClient 额外区分 NETWORK_ERROR、TIMEOUT、WORKFLOW_ERROR、NODE_ERROR、CUDA_OOM、MODEL_MISSING、UNSAFE_CANCEL。UI 的 SYSTEM_ERROR / QUALITY_FAILED 是展示分类；ApiError 是 HTTP 传输层，两者不是同一 schema。

Engine 业务 API 唯一依据是 `src/api/engine.ts`：

```text
GET  /api/engine/pipelines
GET  /api/tasks/:taskId/executions
GET  /api/tasks/:taskId/traces
GET  /api/engines/comfyui/instances
POST /api/engines/comfyui/instances
DELETE /api/engines/comfyui/instances/:id
PUT  /api/engines/comfyui/instances/:id
POST /api/engines/comfyui/instances/:id/health
GET  /api/engines/comfyui/queue
GET  /api/engines/comfyui/executions/:id
POST /api/engines/comfyui/executions/:id/cancel
```

这些是客户端契约，不是当前运行页面必须访问的服务器；列表返回数组，不伪写分页协议。原生 `/prompt` 等请求不是业务 `/api` 请求。

## 迁移路径

1. 已完成：保留 V0.1 Task/UI 兼容投影，引入 Pipeline、StageExecution、Trace 和来源字段。
2. 已完成：旧 storage 校验后升级 v3；旧缺省集合按需建立，不伪造旧执行。
3. 已完成：Workflow 文件快照独立保存，Engine 入队记录 revision 并验证运行版本。
4. 当前范围：浏览器显式调用真实 HTTP、本地持久化进度；Mock 与真实 Provider 明确区分。
5. 后续可选：需要托管生产时再迁移 repository/调度端口到后端；保留实体语义与历史，增加幂等/对账、网络隔离、权限、对象存储和 worker。不是本轮文档/E2E 的前置工作。
