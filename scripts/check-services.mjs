import net from 'node:net'
import { URL } from 'node:url'
const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const probes = [
  ['MySQL', process.env.DB_HOST || database?.hostname || '127.0.0.1', Number(process.env.DB_PORT || database?.port || 3306)],
  ['Backend', '127.0.0.1', Number(process.env.PORT || 3000)],
  ['ComfyUI', process.env.COMFYUI_DEFAULT_HOST || '127.0.0.1', Number(process.env.COMFYUI_DEFAULT_PORT || 8188)],
  ['LLM', process.env.LLM_DEFAULT_HOST || '127.0.0.1', Number(process.env.LLM_DEFAULT_PORT || 11434)],
]
for (const [name, host, port] of probes) {
  await new Promise(resolve => {
    const socket = net.createConnection({ host, port })
    let finished = false
    function done(result) {
      if (finished) return
      finished = true
      console.log(`${name}: ${host}:${port} — ${result}`)
      socket.destroy()
      resolve()
    }
    socket.setTimeout(2000, () => done('Timeout'))
    socket.once('connect', () => done('TCP reachable (not an authenticated health check)'))
    socket.once('error', error => done(error.code || 'Offline'))
  })
}
