# AI Content Factory

面向 AI 短视频与热点文章的内容生产工作空间。采用 Vue 3、TypeScript、Vite、Ant Design Vue、Vue Router 和 Pinia。

## 启动

推荐 Node.js 20.19+ 或 22.12+，pnpm 10。

```sh
pnpm install
pnpm dev
```

`npm run dev` 默认启动 **DEVELOPMENT DEMO**：无需数据库、后端或登录，所有页面使用明确标注的本地 Mock 数据。启动器默认只监听 `127.0.0.1`，显示 `OPEN BROWSER` 精确地址、模式与后端状态；按 Enter 可重新打印，Ctrl+C 只清理它自己启动的进程。`DEV_WEB_PORT`、`DEV_BACKEND_PORT` 可指定端口；端口冲突会给出可操作错误，不会触碰其他进程。

支持 ANSI 的交互终端顶部固定三行 LOCAL / LAN（路由）/ REMOTE，日志在下方滚动；窗口缩放重绘，退出恢复滚动区域。过小终端（少于 20 列或 6 行）、`TERM=dumb` 和非 TTY 输出退回普通日志，不需要颜色支持。窄窗口会截断固定行，可放大窗口或使用管道查看完整地址。

- LOCAL 使用实际监听端口，`DEV_WEB_PORT=0` 显示操作系统分配的端口。
- LAN 从系统网卡推导，但默认 loopback 显示不可用。只有显式 `DEV_HOST=0.0.0.0` 或匹配网卡 IP 才展示 LAN 地址；仅表示监听允许，不保证防火墙、路由或设备可达。IPv6 可显式绑定，但当前 LAN 列表仅展示 IPv4。
- REMOTE 默认未配置。可设置 `DEV_PUBLIC_URL=https://your-approved-host.example`，只接受无凭据、query、fragment 的 HTTP(S) URL，并标记“configured, not verified”。启动器不会开公网端口、创建 tunnel 或验证远端服务；请自行配置受控 HTTPS/VPN。不要在该变量里放秘密。
- 后端仍仅绑定 localhost；LAN 访问通过 Vite 同源代理。DEMO 显示未启动；REAL 区分启动中、监听与外部后端，不把进程监听当作数据库健康。

右上角账户头像支持桌面悬停、点击、方向键 / Home / End / Escape，以及移动端点击；Tab 保持自然焦点顺序。真实身份和角色来自 `/api/auth/me`，个人资料通过已有 `PATCH /api/auth/profile` 修改自己的昵称和邮箱（没有虚构 GET profile 接口），不要求管理权限；强制改密仍优先。演示身份明确标为 Mock，不提供真实资料、改密或退出 API 操作。真实退出立即清除本地会话与工作区；服务器失败会明确提示撤销尚未确认，httpOnly cookie 无法由前端删除，刷新页面仍可能恢复会话。

```sh
npm run dev:demo                 # 默认模式的显式别名
npm run dev:real                 # 真实后端，必须登录；服务错误不会伪装为成功
npm run dev:server               # 与 dev:real 相同：一次启动前端 8060 + 后端 8061
npm run dev:backend              # 仅启动 NestJS 后端，不提供前端页面
API_PROXY_TARGET=http://127.0.0.1:3301 npm run dev:real  # 使用外部后端
DEV_WEB_PORT=0 npm run dev       # 由操作系统分配可用端口，终端显示精确 URL
```

开发页面顶部的黄色横幅会明确显示 DEMO / REAL。REAL 模式连接失败时只显示离线错误；可以点击“选择 Mock 演示”主动切换，切换会整页重载并隔离本地演示状态。`.env` 中已有 `VITE_API_MODE=real` 不会阻止默认 `npm run dev` 进入 DEVELOPMENT DEMO；启动器通过 dev-only 模式选择解释并覆盖它。不要将真实密码或密钥输入 Mock 表单。

默认 DEMO 不启动后端；页面切换 REAL 只改变前端模式，不会启动服务器。需要本地前后端时运行 `npm run dev:real` 或 `npm run dev:server`；传入 `API_PROXY_TARGET` 时使用外部服务而不启动/停止它。开发环境前端端口由 `DEV_WEB_PORT` 控制（默认 8060），后端端口由 `DEV_BACKEND_PORT` 控制（默认 8061），两者可独立配置；访问 `http://127.0.0.1:8060/` 前必须使用双进程启动命令，不能只运行 `npm run dev:backend`。生产环境入口默认 8060，Nest 后端端口由 `PORT` 控制（默认 8060）。页面选择仅在当前标签页的 sessionStorage 保留，生产忽略该值。Mock 工作区使用原有独立 localStorage 数据，真实工作区仅来自后端；切换时不复制任何数据。Mock 管理示例是临时内存数据，刷新重置。

视频任务的 Mock 审核预览使用项目内固定资源 `public/mock-assets/f2f33158052b4d898f47826dcd166892.mp4`，不会依赖开发者桌面文件。该视频仅是用户提供的 Mock 示例，不代表当前任务真实生成结果，也不会用于真实 Provider 或真实资产记录。

自动验证开发/生产边界（使用临时端口和专用的不可连接数据库地址，不使用真实数据库）：

```sh
VITE_API_MODE=mock npm run build
npm run server:build
npm run test:smoke:development
npx playwright test tests/e2e/development-mode.spec.ts
```

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

浏览器端到端测试：

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

## 当前版本的运行边界

第三阶段已增量加入 NestJS + Prisma + MySQL 后端，但真实服务是否可用取决于本机配置。浏览器只访问同源 `/api`，不会直接连接 MySQL、ComfyUI 或 LLM。

- 生产构建永远是真实模式：`import.meta.env.PROD` 会拒绝 Mock 权限快捷方式，即使构建环境误设 `VITE_API_MODE=mock`。只有开发 bundle 能启用 Mock；后端从不信任前端 mode，也不跳过 JWT / RBAC。
- `VITE_API_MODE=real` 走后端认证、RBAC、任务、执行、工作流、模型、资产和审计 API；开发启动器默认 DEVELOPMENT DEMO，`npm run dev:real` 才进入真实服务。
- Mock 模式明确标注为模拟数据：热点不是实时新闻，生成文本和质量评分不代表真实模型判断，也不会将模拟任务包装成真实 MP4。
- 真实模式使用 JWT access token + httpOnly、轮换 refresh cookie；管理员初始化密码只从本地 `INITIAL_ADMIN_PASSWORD` 读取并保存为 hash，首次登录必须改密。
- ComfyUI、OpenAI-compatible LLM 和 Ollama 的请求由 NestJS 后端代理，Secret 加密保存并脱敏返回；AI 结果归档为受权限控制的 Asset。
- MySQL、ComfyUI、LLM 当前是否可联通请运行 `npm run check:services` 并查看实际健康状态。离线时不能把协议测试当作真实联调成功。
- 浏览器 localStorage 仍仅用于 Mock 工作区；真实模式以 MySQL 和服务端资产存储为事实源。

## 使用路线

1. 进入工作台，查看当前任务与生产概况。
2. 在「AI 视频工厂 → 新建视频」填写主题、人物、风格、比例、模型和 Workflow，启动自动创作。
3. 进入任务详情，检查阶段输入/输出、Prompt、耗时、日志；编辑剧本、角色与分镜首尾帧剧情桥。
4. 检查 Quality Gate，修订、重试或人工确认；系统失败与质量失败分别处理。
5. 在热点工厂分析热点，区分事实、观点、AI 推断与待核实内容，创建并编辑文章。
6. 在内容资产中搜索、预览、下载或删除生产资料。
7. 在 Workflow、模型和系统设置中管理元信息、可用模型、审核阈值和重试上限。

## 第三阶段启动

```sh
cp .env.example .env
# 仅在本机环境或交互式进程中填写 INITIAL_ADMIN_PASSWORD、JWT_ACCESS_SECRET、AI_SECRET_KEY、
# DATABASE_URL 及 MySQL 密码；不要提交 .env。
pnpm install
npm run server:db:generate
npm run server:db:migrate
npm run server:seed-admin
npm run dev
```

开发真实模式下，即使 MySQL、ComfyUI、LLM 离线，后端仍启动并让页面显示离线错误；不会回退、不跳过真实认证。数据库离线不再阻止 Nest 进程启动，便于生产页面显示安全的 503；`NODE_ENV=production` 仍绝不启用 Mock 或认证绕过。生产环境仍应监控并修复数据库，而不是把 503 当成功。

- `GET /api/health/live`：进程存活返回 200；`GET /api/health`：数据库可用返回 200，否则返回 503，包含 `backend`、`database` 和依赖状态。ComfyUI/LLM 标记 `not_checked`，不冒充已联网；实际服务探测仍走受权限保护的 API。
- 数据库未就绪时业务 API 返回安全的 `DATABASE_UNAVAILABLE` / HTTP 503，不能读取私有数据或执行功能操作。数据库恢复后仍必须经过原有 JWT 与权限校验。
- Prisma 连接/连接池等待限制为 2 秒、socket 等待限制为 3 秒；单次探测不重叠，每次完成后 5 秒再次检查，退出时清理计时器和连接。
- AI 启动恢复在数据库就绪后重试，成功前禁止提交新执行。只对启动前已有、无 receipt 的 SUBMITTING/RUNNING 执行作保守的未知结果处理；数据库连接失败本身不代表执行失败，不自动重提未知结果。
- 真实前端显示「应用暂时不可用」、后端/数据库状态及重试按钮。用户可主动选择空白的导航/布局预览，但不创建模拟身份、加载 Mock 数据或装载特权业务页面。连接恢复后重试会重新校验真实会话。
- `NODE_ENV=production` 在数据库离线时提供 503 并持续重连；缺失/无效的安全配置仍启动失败。ComfyUI/LLM 离线时真实探测与生成不会伪造成功。
- 非默认后端端口可配合 `API_PROXY_TARGET=http://127.0.0.1:<port>` 启动 Vite。开发启动器退出时只终止它自己启动的子进程组。

离线验证（需要本机已有环境配置且数据库确实离线）：

```sh
npm run server:build
node scripts/smoke-offline.mjs
npx playwright test --config playwright.real.config.ts phase3-offline.spec.ts
```

Smoke 使用临时端口启动真实 Nest、Vite 和 Chromium，不拦截 API；读取配置交给 Node 环境加载器，不输出连接信息、环境秘密或服务日志，结束后仅清理自己的进程。

2026-09-24 开发/生产边界验证：`npm run typecheck:all`、`npm run lint`、前后端 build 通过；新增开发模式单元与浏览器测试，原有 Mock 生产流程/移动端 Engine 测试 7 项及新增开发页面测试 2 项通过，真实离线/会话测试 7 项通过。`test:smoke:development` 实际启动 `npm run dev`、开发真实后端、生产离线后端与 production preview，验证精确 URL、Enter 重印、离线 503、主动切换演示以及生产构建即使使用 `VITE_API_MODE=mock` 也不能绕过。Smoke 使用独立的不可连接数据库地址和测试凭据，结束后清理自己的进程组。Vite build 仍有主 bundle 超过 500 kB 的体积警告。数据库恢复由自动化替身测试覆盖，本次未启动真实 MySQL/ComfyUI/LLM，也不声称通过真实生成联调。

Docker Compose 提供 `mysql`、`backend`、`frontend`、`proxy` 四个服务，默认只将生产入口绑定到 `127.0.0.1:8060`，可通过 `PROD_PORT` 配置宿主机入口端口、通过 `PORT` 配置容器内 Nest 后端端口。远程访问必须通过 HTTPS/VPN/受控 Tunnel；不要暴露应用后端、3306、8188 或 LLM 端口。

详细配置、Windows 命令、ComfyUI/Llama 配置、备份和 HTTPS 说明见 `docs/phase3-running.md`。

## 工程结构

```text
src/
  api/            HTTP API 类型、客户端与错误处理
  components/     公共页面组件
  layouts/        响应式工作空间布局
  pages/          工作台、视频、任务、热点、文章、资产、Workflow、模型、统计、设置
  providers/      AI / 内容 / 热点 / 发布接口与 ComfyUI 适配
  orchestrator/   Pipeline 定义、ProviderRegistry、阶段执行与资产来源
  engine/         ComfyUI 原生 HTTP 协议客户端
  workflow/       不可变 Workflow 文件版本与活动版本指针
  services/       Mock Service、任务状态机与前端适配
  stores/         Pinia 工作空间状态
  types/          跨模块领域模型
workflows/        版本化 Workflow 与语义输入 Mapping
apps/server/      NestJS API、认证授权、AI Provider 代理与资产归档
prisma/           MySQL Schema、迁移与管理员初始化 seed
tests/            状态机、API / Adapter 及浏览器验收测试
```

## 接入真实 ComfyUI

1. 从 ComfyUI 导出 **API 格式** Workflow。画布用 UI Workflow（包含 `nodes` / `links`）不是 `/prompt` 的输入格式。
2. 在 Workflow 文件版本面板导入已验证的 API JSON，填写 Mapping 并保存、激活快照。`workflows/minimax-h3/video-v1.json` 仍是仓库占位文件，不声称可执行，也不会自动覆盖页面中的快照。
3. 将 `prompt / width / height / duration / seed / firstFrame / lastFrame` 绑定到真实节点和字段。业务层只使用语义输入名。
4. 管理员在后端 Provider 中配置 ComfyUI 实例。NestJS 提交后即保存 `promptId`，通过 `/history/{prompt_id}` 获取结果并归档 Asset；浏览器只访问 `/api`。
5. 配置明确超时、错误映射与有限重试，再用真实产物替换本地模拟输出。

不要把云端 API 密钥放进 `VITE_*` 环境变量，它们会进入前端构建产物。公开部署前需要服务端鉴权、存储、作业调度、安全检查与发布授权。

## 保留的第二阶段 Mock 架构

现有页面与 V2 工作空间数据兼容，新增字段按需初始化并迁移到 V3；不会为旧任务补造不存在的执行历史。

- `Orchestrator` 统一接管任务提交、阶段推进及人工动作；一个任务的异常不应停止其他任务。
- `PipelineStageDefinition` 描述“做什么”，`ProviderRegistry` 选择执行能力；`StageExecution` 单独保存每次尝试，`ProductionTrace` 关联阶段日志。
- ComfyUI **Instance 是部署服务地址**，ComfyUI Execution 是该实例上的作业，`promptId` 是外部作业标识，不等于业务 Task ID。
- Workflow 元数据与 UI/API JSON、Mapping 文件版本分离。文件快照支持导入、复制、导出、激活、停用和回滚；回滚只切换活动指针，不覆盖历史文件。激活不代表模型/节点可用，也不会立即执行。
- 任务详情提供执行追踪与快照导出；资产来源只展示可证实的关联，旧资产缺失来源时明确说明。
- 系统设置提供 Draft、Production、Strict 质量参数预设。选择预设不会立即生效，仍需保存。
- 阶段模型与 Workflow 按能力选择，支持定义中的显式配置优先；SCRIPT 不再沿用视频阶段模型。设置页可单独保存阶段质量门槛。
- Mock 质量失败会记录 Prompt 修复前后、原因和 attempt，达到预算后要求人工处理；这仍是模拟修复，不声称真实模型优化效果。
- 热点分析通过 Orchestrator 同步阶段记录 execution/trace，但尚未成为完整的异步热点采集任务队列。

本地数据保存在 `acg-content-factory-db`，Workflow 文件版本另存于 `acg-workflow-versions-v1`。备份时应同时备份两者。localStorage 不是具备跨标签原子事务的数据库，也不是生产级任务队列。

原有 ComfyUI 协议客户端保留用于兼容和协议测试，Mock Store 已禁止通过它从浏览器连接 AI 服务。第三阶段真实执行由 NestJS 接管：挂起作业可按 promptId 删除；正在运行的作业不盲目调用实例级 `/interrupt`，以免影响其他作业。当前不声称完成真实 GPU 联调。

详细审查与实现边界参见 `docs/architecture-review.md`、`docs/phase2-architecture.md`。

## 部署

`pnpm build` 生成 `dist/`，`pnpm server:build` 生成 NestJS 服务。History Router 需要将非文件路径回退到 `index.html`。真实部署必须同时配置 `/api` 反向代理和 MySQL；仅托管 `dist/` 不会提供共享后端、鉴权或 AI 生成能力。
