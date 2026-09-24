/* global setTimeout, clearTimeout, setInterval, clearInterval, fetch, AbortSignal */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer as createPortCheck } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { addressLines, cleanLog, createTerminal } from './dev-terminal.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const modeIndex = args.indexOf('--mode')
const mode = modeIndex < 0 ? 'demo' : args[modeIndex + 1]
if (!['demo', 'real'].includes(mode) || args.some((arg, i) => i !== modeIndex && i !== modeIndex + 1)) {
  console.error('Usage: npm run dev -- --mode demo|real')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production') {
  console.error('Development launcher refuses NODE_ENV=production. Use build + production server instead.')
  process.exit(1)
}
function port(value, fallback) {
  const result = Number(value ?? fallback)
  if (!Number.isInteger(result) || result < 0 || result > 65535) throw new Error('Ports must be integers from 0 to 65535.')
  return result
}
const webPort = port(process.env.DEV_WEB_PORT, 5173)
const host = process.env.DEV_HOST || '127.0.0.1'
if (!isIP(host)) throw new Error('DEV_HOST must be an explicit IP address (default 127.0.0.1).')
const backendPort = port(process.env.DEV_BACKEND_PORT, 3000)
if (!backendPort) throw new Error('DEV_BACKEND_PORT must be nonzero; choose an unused port.')
const target = process.env.API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`
const externalBackend = !!process.env.API_PROXY_TARGET
const targetUrl = new URL(target)
if (!['http:', 'https:'].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password || targetUrl.search || targetUrl.hash) {
  throw new Error('API_PROXY_TARGET must be an HTTP(S) origin without credentials, query or fragment.')
}
process.env.NODE_ENV = 'development'
process.env.VITE_DEV_MODE = mode
process.env.API_PROXY_TARGET = target
let web
let child
let input
let healthTimer
let checkingHealth = false
let stopping = false
let backendState = mode === 'demo' ? 'not started (isolated demo)' : 'starting'
let browserUrl = ''
let actualPort = webPort
const terminal = createTerminal(process.stdout, () => addressLines({
  host, port: actualPort, mode, backend: backendState,
  remote: process.env.DEV_PUBLIC_URL, interfaces: networkInterfaces(),
}))
function banner() {
  terminal.banner()
}
function kill(signal) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, signal)
  } catch (error) { if (error.code !== 'ESRCH') console.error(`Cleanup failed: ${error.code}`) }
}
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  clearInterval(healthTimer)
  terminal.close()
  input?.close()
  process.stdin.pause()
  kill('SIGTERM')
  const force = setTimeout(() => kill('SIGKILL'), 4000)
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => child.once('exit', resolve))
  }
  // Also terminate lingering grandchildren after the process-group leader exits.
  kill('SIGKILL')
  clearTimeout(force)
  await web?.close()
  process.exitCode = code
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
process.on('exit', () => terminal.close())
process.on('uncaughtException', error => {
  terminal.log(`Development failure: ${error.code || 'unexpected error'}`)
  void stop(1)
})
process.on('unhandledRejection', () => {
  terminal.log('Development failure: unhandled rejection')
  void stop(1)
})
try {
  // Vite treats zero as its default port. Reserve an OS-selected candidate,
  // then use strictPort so any race fails rather than taking another port.
  if (webPort === 0) {
    actualPort = await new Promise((resolve, reject) => {
      const check = createPortCheck()
      check.once('error', reject)
      check.listen(0, host, () => {
        const selected = check.address().port
        check.close(error => error ? reject(error) : resolve(selected))
      })
    })
  }
  web = await createServer({
    root, clearScreen: false,
    customLogger: {
      info: message => terminal.log(message), warn: message => terminal.log(message),
      warnOnce: message => terminal.log(message), error: message => terminal.log(message),
      clearScreen() {}, hasErrorLogged: () => false, hasWarned: false,
    },
    server: { host, port: actualPort, strictPort: true, open: false },
  })
  await web.listen()
  const address = web.httpServer.address()
  actualPort = address.port
  browserUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : isIP(host) === 6 ? `[${host}]` : host}:${actualPort}/`
  if (mode === 'real' && !externalBackend) {
    // Fail rather than accidentally proxying another project's backend. Nest
    // still binds strictly, so a race after this check cannot steal a port.
    await new Promise((resolve, reject) => {
      const check = createPortCheck()
      check.once('error', reject)
      check.listen(backendPort, '127.0.0.1', () => check.close(resolve))
    })
    child = spawn(process.execPath, ['--env-file-if-exists=.env', 'node_modules/@nestjs/cli/bin/nest.js', 'start', '--watch'], {
      cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(backendPort), HOST: '127.0.0.1', ACG_CONCISE_LOGS: '1',
        ALLOWED_ORIGINS: browserUrl.slice(0, -1) },
    })
    // Prefix every line; remove URL credentials and typical secret assignments.
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', line => {
        // ANSI escapes are stripped before the concise backend prefix is shown.
        const clean = cleanLog(line).trim()
        if (clean) terminal.log(`[backend] ${clean}`)
        if (clean.includes('Nest application successfully started')) {
          backendState = 'listening (dependencies not verified)'
          banner()
        }
        if (clean.includes('Watching for file changes')) banner()
        if (clean.includes('EADDRINUSE')) {
          terminal.log('[backend] Port occupied. Choose another DEV_BACKEND_PORT; no existing process will be stopped.')
          void stop(1)
        }
      })
    }
    child.on('error', error => { terminal.log(`[backend] Spawn failed: ${error.code}`); void stop(1) })
    child.on('exit', (code, signal) => {
      if (stopping) return
      backendState = `exited (${code ?? signal}); see backend error above`
      banner()
      void stop(code || 1)
    })
  } else if (mode === 'real') backendState = 'external (not managed by launcher)'
  if (mode === 'real' && !externalBackend) {
    healthTimer = setInterval(async () => {
      if (checkingHealth || stopping) return
      checkingHealth = true
      let state = 'not reachable (starting/restarting)'
      try {
        const response = await fetch(`${targetUrl.origin}/api/health/live`, { signal: AbortSignal.timeout(1000), redirect: 'error' })
        if (response.ok) state = 'live (dependencies not verified)'
      } catch { /* Do not expose response bodies or connection credentials. */ }
      finally { checkingHealth = false }
      if (!stopping && state !== backendState) { backendState = state; banner() }
    }, 2000)
  }
  banner()
  terminal.log('Press Enter to print addresses again. Ctrl+C stops only our processes.')
  input = createInterface({ input: process.stdin })
  input.on('line', banner)
} catch (error) {
  terminal.log(`Development startup failed: ${error.code || cleanLog(error.message)}. If the port is occupied, set DEV_WEB_PORT=0 or choose another DEV_WEB_PORT / DEV_BACKEND_PORT. No existing process is stopped.`)
  await stop(1)
}
