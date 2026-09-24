# 第三阶段：本机运行与安全部署

本文件描述单机 Vue + NestJS + MySQL 部署。ComfyUI 和本地 LLM 是外部服务，不要求 Docker 化。未完成真实设备联调时，自动化测试通过不代表 GPU 或模型调用成功。

## 前置条件

- Node.js 22 LTS（现有 Node 20.19 环境亦须通过项目检查）。
- pnpm 10（仓库沿用已有 `pnpm-lock.yaml`）。
- MySQL 8；单独建立 `content_factory` 数据库和仅拥有该库权限的应用用户。不要用 root 连接业务 API。
- ComfyUI、OpenAI-compatible LLM 或 Ollama 按需单独启动。AI 服务离线不应被标记为 Online。
- Docker 部署需要 Docker Desktop / Docker Engine + Compose；本地运行不强制 Docker。

## 配置

复制根目录 `.env.example` 为 `.env`（Windows PowerShell 可使用 `Copy-Item .env.example .env`），填写：

1. `DATABASE_URL`：本机 MySQL 连接串。密码中的 URL 保留字符须进行百分号编码。
2. `JWT_ACCESS_SECRET`：至少 32 个随机字符，不是管理员密码。当前 refresh token 是数据库保存的轮换 opaque token，不需要 `JWT_REFRESH_SECRET`。
3. `AI_SECRET_KEY`：32 个随机字节的十六进制表示，用于加密 AI API Key。更换此密钥后必须迁移已有密文或重新录入 Secret。
4. `INITIAL_ADMIN_USERNAME` 和 `INITIAL_ADMIN_PASSWORD`：仅用于首次初始化，不提交 Git，不写进前端配置。
5. `ALLOWED_ORIGINS`（或兼容的 `CORS_ORIGIN`）：浏览器实际访问的站点 Origin，包括协议与端口。
6. `ALLOWED_AI_HOSTS`：明确允许的 `host:port` 列表，例如 `127.0.0.1:8188`。服务配置不能超出该清单，修改 LAN 地址时需要同步更新。

`VITE_*` 都可能被打包进浏览器。不得在该前缀下存放密码、JWT Secret、数据库连接串或 AI Key。

## 本地启动

```sh
pnpm install
npm run server:db:generate
npm run server:db:migrate
# 管理员初始化命令以 package.json 中 server:seed-admin 为准
npm run server:seed-admin
npm run dev
```

前端由 Vite 提供，`/api` 代理到本机 NestJS 3000。浏览器不能将 AI Base URL 作为请求地址；真实请求只能经过后端。

`npm install` 在已有 pnpm 链接布局上可能发生 npm 依赖树错误；不要因此删除用户源代码。优先在当前仓库继续使用 pnpm 安装，`npm run` 可以运行项目脚本。

诊断：

```sh
npm run check:services
npm run lint
npm run typecheck:all
npm run test
npm run build:all
```

TCP 可达只说明端口有监听，不代表认证成功或 GPU/模型可用。

## 首次管理员

将管理员初始密码只填写在本机 `.env` 或进程环境中，执行初始化命令。数据库应只有 `passwordHash`。首次登录需修改密码后才能操作管理与生产功能。

初始化不是密码重置工具：已有管理员不应被重复 seed 覆盖密码。初始化完成后可从常驻进程环境中移除 `INITIAL_ADMIN_PASSWORD`。

## 配置 ComfyUI

1. 启动本机 ComfyUI，确认实际 IP 与端口。
2. 将该 `host:port` 加入后端 `ALLOWED_AI_HOSTS`。
3. 管理员在 AI 服务/ComfyUI 管理中建立实例并测试连接。只有实际探测成功才显示 Online。
4. 从 ComfyUI 导出 API Workflow；UI 画布文件只能作为存档，不能直接提交 `/prompt`。
5. 导入 Workflow 与版本、配置语义 Mapping。普通生产界面只显示提示词、宽高、长度、seed 等业务字段，不暴露节点编号。
6. 在视频生产中选择实例与 Workflow，提交后检查 Task、Execution、promptId、后端进度与 Asset。

ComfyUI 原生 API 不保证能列出磁盘中所有保存的 Workflow；不支持的同步能力必须明确报告。首尾帧字段需要对应 ComfyUI 输入文件或受支持的上传流程，不能填任意浏览器路径并假定远端可读。

## 配置 LLM

1. 启动本地 LLM 服务，确认使用 OpenAI-compatible 还是 Ollama 协议。
2. 将实际 `host:port` 加入允许列表。
3. 建立 LLM Service；OpenAI-compatible Base URL 的 `/v1` 路径以该服务文档为准。
4. 点击同步模型，从实际返回的模型列表选择，不能将示例名称当作已安装模型。
5. 用生成页面选择普通、结构化或流式生成，确认浏览器只请求 `/api`，结果保存到资产。

## Docker

```sh
docker compose build
docker compose up -d mysql
docker compose run --rm backend npm run server:db:migrate
docker compose run --rm backend npm run server:seed-admin
docker compose up -d
```

Compose 不映射 MySQL 与后端端口到主机，只将应用入口绑定到 `127.0.0.1:8088`。AI 服务运行在宿主机时，容器内的 `127.0.0.1` 是容器自身，使用 `host.docker.internal` 并将对应端口加入允许列表。根据 Docker Desktop/操作系统设置确认宿主机服务允许容器网络访问，但不要因此对公网开放 AI 端口。

Compose 包含 mysql、backend、frontend、proxy 四个服务。`deploy/Caddyfile` 是仅监听本机映射端口的 HTTP 内层代理，不是公网 HTTPS 配置。本机 HTTP 验收可设 `COOKIE_SECURE=false` 和 `ALLOWED_ORIGINS=http://127.0.0.1:8088`；远程部署必须改为 `COOKIE_SECURE=true`、真实 HTTPS Origin，并在外层使用 `deploy/Caddyfile.example` 配置域名与证书。

MySQL 密码用于 Compose 连接串时应避免未编码的 URL 保留字符。`mysql-data` 与 `asset-data` 是持久化卷；备份时同时备份数据库和资产目录。不要用 `docker compose down -v` 作为日常重启方式。

## 远程访问

推荐通过 Caddy/Nginx HTTPS 入口或受控 VPN/Tunnel 访问应用：

```text
HTTPS / VPN / Tunnel
  -> 本机应用入口
  -> /api NestJS
  -> 内网 MySQL / ComfyUI / LLM
```

`deploy/Caddyfile.example` 只是部署模板，必须配置真实域名、DNS 与证书。公网入口只能是应用反向代理，不直接开放 3000、5173、3306、8188 或 LLM 端口。

上线前检查 Secure Cookie、精确 Origin、反向代理信任范围、限流、角色权限与公开资源范围；执行一次未登录、游客、普通用户和管理员权限验收。不要将 Mock 构建作为真实部署。

`TRUSTED_PROXY_CIDRS` 默认留空；只填写实际受控反向代理的 IP/CIDR，不使用 `true`、`*` 或覆盖整个公网的网段。未设置信任时后端按直接连接者 IP 限流，代理后的用户可能共享限额；设置过宽则可能允许伪造转发头。
