# 第三阶段基线审查

审查对象是第二阶段现有工作区，而不是从空仓库重新创建项目。原前端继续保留在根目录 `src/`，新 NestJS 后端放在 `apps/server/`。

## 已有、复用与迁移

| 范围 | 阶段三开始时 | 本轮处理 |
| --- | --- | --- |
| Frontend | Vue 3 / TypeScript / Vite / Pinia / Ant Design Vue | 保留页面与 Mock 闭环，增加真实 API 分支 |
| Backend / NestJS | 不存在 | 增加单体 NestJS 服务 |
| API | HTTP client 与接口定义，无运行中业务服务器 | 对齐实际 REST API，不将契约当作已部署服务 |
| Mock | 浏览器 localStorage + timer | 保留显式 Mock 模式，不能回退冒充真实数据 |
| Pipeline / Stage / Task / Execution | 存在本地编排与独立阶段尝试记录 | 增加服务端持久化执行链 |
| Provider / ComfyUI | 存在 Adapter 和第二套原生 HTTP client | 后端负责网络边界，前端纯 Mapping/类型可保留 |
| Workflow | UI/API JSON、Mapping、不可变快照存在 | 增加数据库版本与后端执行快照 |
| Asset | 元数据与来源追踪存在 | 增加后端归档与受保护内容接口 |
| Auth / User / Permission | 不存在 | 服务端 JWT 会话、RBAC、权限化菜单 |
| Database / ORM | 不存在 | Prisma + MySQL，不引入第二套 ORM |
| Environment | 无环境模板；`.env` 已被忽略 | 增加无真实密码的 `.env.example` |

## 优先处理的边界

1. 第二阶段的实例探测与执行会从浏览器直连 ComfyUI；这不满足第三阶段要求。真实模式必须从 `/api` 进入后端，Mock 不得绕过后端发出真实 AI 请求。
2. UI 隐藏菜单不是授权。必须在后端验证账号、角色状态、权限、资源所有权与公开标志；用户不可通过请求体任意指定 owner。
3. localStorage 不具备服务端任务调度和审计持久化能力。真实模式的数据事实源改为 MySQL，不能在网络错误后自动生成本地 Mock 数据。
4. Workflow UI 画布不能提交 `/prompt`；版本和语义 Mapping 必须在后端校验与快照化。
5. Provider 的提交超时可能产生未知结果。有 promptId 时恢复查询，没有确定结果时不能盲目重发 POST。
6. AI Secret 必须加密持久化且禁止返回；环境密钥与首次管理员密码只在本机配置，示例文件不含真实密码。
7. 所有服务器请求目标必须来自管理员配置和显式主机端口允许列表，禁止客户端提供任意 fetch URL、重定向或资产任意路径。

## 初始运行环境探测

本次开始时，`127.0.0.1:8188`、`:11434`、`:8080` 均连接失败。未找到 Docker 或 MySQL CLI。仅能据此说明这些探测地址当时不可达，不能判断其他主机或端口是否有 AI 服务。真实设备成功联调必须单独记录，不得以拦截响应测试替代。
