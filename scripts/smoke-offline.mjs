/* global fetch, AbortSignal, setTimeout, clearTimeout */
// Uses the existing environment through Node's loader; never prints secrets or server logs.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'apps/server/dist/main.js'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'ignore',
})
const exited = once(child, 'exit')
let web
let webExited
let browser
try {
  const base = `http://127.0.0.1:${port}`
  let health
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Nest exited before becoming live (logs withheld)')
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })
      health = { status: response.status, body: await response.json() }
      break
    } catch { await new Promise(resolve => setTimeout(resolve, 500)) }
  }
  assert.equal(health?.status, 503, 'Smoke requires the existing configured database to be offline')
  assert.equal(health.body.data.database, 'down')
  assert.equal(health.body.data.backend, 'up')
  assert.equal((await fetch(`${base}/api/health/live`)).status, 200)
  for (const path of ['/api/auth/me', '/api/workspace', '/api/workspace/public']) {
    const response = await fetch(`${base}${path}`)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'DATABASE_UNAVAILABLE')
  }
  await new Promise(resolve => setTimeout(resolve, 5500))
  assert.equal((await fetch(`${base}/api/health/live`)).status, 200)
  const webReservation = createServer()
  webReservation.listen(0, '127.0.0.1')
  await once(webReservation, 'listening')
  const webPort = webReservation.address().port
  await new Promise(resolve => webReservation.close(resolve))
  web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    env: { ...process.env, VITE_API_MODE: 'real', API_PROXY_TARGET: base }, stdio: 'ignore',
  })
  webExited = once(web, 'exit')
  const webUrl = `http://127.0.0.1:${webPort}`
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(webUrl)).ok) break } catch { /* Vite is starting */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`${webUrl}/tasks`)
  await page.getByRole('heading', { name: '应用暂时不可用' }).waitFor()
  await page.getByText('数据库：未就绪 (503)').waitFor()
  await page.getByRole('button', { name: '选择浏览离线布局预览' }).click()
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('heading', { name: '任务中心' }).waitFor()
  await page.getByRole('button', { name: '重试连接' }).click()
  await page.getByRole('heading', { name: '应用暂时不可用' }).waitFor()
  console.log('PASS: real Vite + browser + Nest, no route interception: visible offline shell, database down, empty navigation preview and retry.')
  console.log('PASS: actual Nest offline startup; readiness 503, liveness 200, auth/workspace 503; alive after retry interval.')
} finally {
  await browser?.close()
  if (web) {
    web.kill('SIGTERM')
    await webExited
  }
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 8000)
  await exited
  clearTimeout(force)
  console.log('Own Nest process terminated; no other processes touched.')
}
