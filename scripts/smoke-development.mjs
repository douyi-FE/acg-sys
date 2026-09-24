/* global fetch, AbortSignal, setTimeout, clearTimeout, sessionStorage, localStorage */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
const browser = await chromium.launch()
const children = []
function launch(command, args, env) {
  const child = spawn(command, args, {
    cwd: root, detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env },
  })
  let output = ''
  child.stdout.on('data', data => { output += data.toString() })
  child.stderr.on('data', data => { output += data.toString() })
  children.push(child)
  return { child, output: () => output }
}
async function waitFor(check, label) {
  for (let i = 0; i < 180; i++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timeout: ${label}`)
}
async function stop(child) {
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit')
  const kill = signal => {
    try { process.kill(-child.pid, signal) } catch (e) { if (e.code !== 'ESRCH') throw e }
  }
  kill('SIGTERM')
  const timer = setTimeout(() => kill('SIGKILL'), 6000)
  await exited
  clearTimeout(timer)
  kill('SIGKILL')
}
try {
  const webPort = await freePort()
  const backendPort = await freePort()
  const dbPort = await freePort()
  const env = {
    DEV_WEB_PORT: String(webPort), DEV_BACKEND_PORT: String(backendPort),
    DATABASE_URL: `mysql://offline:offline@127.0.0.1:${dbPort}/offline`,
    JWT_ACCESS_SECRET: 'development-smoke-only-not-a-real-secret-000000',
    NODE_ENV: 'development', API_PROXY_TARGET: '', VITE_API_MODE: 'real',
  }
  const demo = launch('npm', ['run', 'dev'], env)
  const base = `http://127.0.0.1:${webPort}`
  await waitFor(() => demo.output().includes(`OPEN BROWSER: ${base}/`), 'exact startup URL')
  assert.match(demo.output(), /MODE: DEMO/)
  assert.match(demo.output(), /LAN \(router\).*unavailable/)
  assert.match(demo.output(), /REMOTE \| unconfigured/)
  assert.equal(demo.output().includes('\x1b'), false, 'non-TTY output has no ANSI escapes')
  const conflict = launch('npm', ['run', 'dev'], env)
  await once(conflict.child, 'exit')
  assert.equal(conflict.child.exitCode, 1)
  assert.match(conflict.output(), /DEV_WEB_PORT/)
  assert.equal((await fetch(base)).status, 200, 'port collision must not stop the original process')
  children.splice(children.indexOf(conflict.child), 1)
  demo.child.stdin.write('\n')
  await waitFor(() => demo.output().split(`OPEN BROWSER: ${base}/`).length >= 3, 'Enter reprints URL')
  const page = await browser.newPage()
  await page.goto(base)
  await page.getByTestId('development-mode').filter({ hasText: 'DEVELOPMENT DEMO' }).waitFor()
  await page.locator('.app-shell').waitFor()
  await page.goto(`${base}/users`)
  await page.getByRole('heading', { name: 'Mock 内容主理人' }).waitFor()
  console.log('PASS actual npm run dev: exact temporary URL, Enter reprint, port-conflict failure preserves existing listener, default demo despite VITE_API_MODE=real, offline users page without login.')
  await stop(demo.child)
  children.splice(children.indexOf(demo.child), 1)

  const ephemeral = launch('npm', ['run', 'dev'], { ...env, DEV_WEB_PORT: '0', FORCE_COLOR: '1', DEV_PUBLIC_URL: 'https://example.com' })
  await waitFor(() => /OPEN BROWSER: http:\/\/127\.0\.0\.1:\d+\//.test(ephemeral.output()), 'ephemeral port URL')
  const ephemeralUrl = /OPEN BROWSER: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(ephemeral.output())[1]
  assert.equal((await fetch(ephemeralUrl)).status, 200)
  // npm may emit its own color sequences with FORCE_COLOR; launcher output must not.
  const launcherOutput = ephemeral.output().slice(ephemeral.output().indexOf('LOCAL |'))
  assert.equal(launcherOutput.includes('\x1b'), false)
  assert.match(launcherOutput, /configured, not verified/)
  await stop(ephemeral.child)
  children.splice(children.indexOf(ephemeral.child), 1)
  console.log('PASS ephemeral port, configured-only remote URL and plain launcher output with FORCE_COLOR.')

  const real = launch('npm', ['run', 'dev', '--', '--mode', 'real'], env)
  await waitFor(() => real.output().includes(`OPEN BROWSER: ${base}/`), 'real startup URL')
  await waitFor(async () => {
    try { return (await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(1000) })).status === 200 } catch { return false }
  }, 'offline backend live')
  assert.equal((await fetch(`${base}/api/health`)).status, 503)
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 503)
  await page.goto(`${base}/tasks?devMode=real`)
  await page.getByRole('heading', { name: '应用暂时不可用' }).waitFor()
  await page.getByRole('button', { name: '选择 Mock 演示' }).click()
  await page.locator('.app-shell').waitFor()
  console.log('PASS actual npm run dev -- --mode real: configurable backend proxy, DB offline 503, no auth bypass, explicit demo switch.')
  await stop(real.child)
  children.splice(children.indexOf(real.child), 1)

  const productionPort = await freePort()
  const production = launch(process.execPath, ['apps/server/dist/main.js'], {
    ...env, PORT: String(productionPort), HOST: '127.0.0.1', NODE_ENV: 'production', VITE_API_MODE: 'mock', ACG_CONCISE_LOGS: '1',
  })
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${productionPort}/api/health/live`)).status === 200 } catch { return false }
  }, 'production offline backend')
  assert.equal((await fetch(`http://127.0.0.1:${productionPort}/api/auth/me`, { headers: { 'x-dev-mode': 'mock' } })).status, 503)
  console.log('PASS actual production backend with offline DB: alive, protected API 503 even with mock env/header.')

  const previewPort = await freePort()
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {})
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${previewPort}`)).ok } catch { return false }
  }, 'production preview')
  // dist must have been built with VITE_API_MODE=mock to exercise the regression.
  await page.addInitScript(() => {
    sessionStorage.setItem('acg-development-mode', 'demo')
    localStorage.setItem('acg-content-factory-db', '{"privateMarker":"must-not-render","version":3}')
  })
  await page.goto(`http://127.0.0.1:${previewPort}/tasks?devMode=demo`)
  await page.getByRole('heading', { name: '应用暂时不可用' }).waitFor()
  assert.equal(await page.getByTestId('development-mode').count(), 0)
  assert.equal(await page.locator('.app-shell').count(), 0)
  console.log('PASS production build (built with env mock) ignores query/storage demo and shows offline, not privileged pages.')
  await stop(production.child)
  children.splice(children.indexOf(production.child), 1)
} finally {
  await browser.close()
  for (const child of children.reverse()) await stop(child)
  console.log('Stopped only smoke-owned process groups.')
}
