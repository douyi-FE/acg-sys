import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(root, '.env')

if (!existsSync(envFile)) {
  console.error('缺少 .env 文件。请先复制 .env.example 为 .env，并配置 DATABASE_URL。')
  process.exit(1)
}

const required = ['DATABASE_URL', 'INITIAL_ADMIN_USERNAME', 'INITIAL_ADMIN_PASSWORD']
const missing = required.filter((key) => !process.env[key]?.trim())
if (missing.length) {
  console.error(`缺少必要环境变量：${missing.join(', ')}`)
  console.error('请在 .env 中配置数据库连接和首次初始化管理员密码后重试。')
  process.exit(1)
}

const password = process.env.INITIAL_ADMIN_PASSWORD
if (password.length < 12 || password.length > 128) {
  console.error('INITIAL_ADMIN_PASSWORD 长度必须为 12–128 个字符。')
  process.exit(1)
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}`))
    })
  })
}

try {
  console.log('1/3 生成 Prisma Client…')
  await run('pnpm', ['run', 'server:db:generate'])
  console.log('2/3 创建或同步数据库结构…')
  await run('pnpm', ['--dir', 'apps/server', 'db:push'])
  console.log('3/3 初始化权限、管理员和默认流水线…')
  await run('pnpm', ['run', 'server:seed-admin'])
  console.log(`数据库初始化完成，管理员用户名：${process.env.INITIAL_ADMIN_USERNAME}`)
  console.log('首次登录后请按页面提示修改密码。')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
