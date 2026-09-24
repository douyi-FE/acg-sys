import { stripVTControlCharacters } from 'node:util'
import { isIP } from 'node:net'

export function cleanLog(value) {
  return stripVTControlCharacters(String(value))
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi, '$1[redacted]')
}

export function publicAddress(value) {
  if (!value) return 'unconfigured'
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error()
    return `${url.href} (configured, not verified)`
  } catch { return 'unconfigured (invalid DEV_PUBLIC_URL; use HTTP(S), no credentials/query/fragment)' }
}

export function addressLines({ host, port, mode, backend, remote, interfaces = {} }) {
  const addresses = Object.values(interfaces).flat().filter(item => item && !item.internal && item.family === 'IPv4')
    .map(item => item.address)
  const lan = [...new Set(addresses)].filter(ip => host === '0.0.0.0' || host === ip)
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const url = `http://${isIP(localHost) === 6 ? `[${localHost}]` : localHost}:${port}/`
  return [
    `LOCAL | OPEN BROWSER: ${url} | MODE: ${mode.toUpperCase()} | BACKEND: ${backend}`,
    `LAN (router) | ${lan.length ? lan.map(ip => `http://${ip}:${port}/`).join(' ') + ' (bound; firewall/reachability not verified)' : 'unavailable (loopback or no matching interface; opt in with DEV_HOST=0.0.0.0)'}`,
    `REMOTE | ${publicAddress(remote)}`,
  ].map(cleanLog)
}

// ASCII header makes clipping predictable even in narrow terminals. No color is
// required, and child output cannot inject cursor movement into the fixed area.
export function renderHeader(lines, columns) {
  const width = Math.max(1, Math.floor(columns) - 1)
  return lines.slice(0, 3).map(line => cleanLog(line).replace(/[^\x20-\x7e]/g, '?').slice(0, width))
}

export function createTerminal(output, getLines, env = process.env) {
  let active = false
  const capable = () => output.isTTY && env.TERM !== 'dumb' &&
    Number.isInteger(output.rows) && output.rows >= 6 &&
    Number.isInteger(output.columns) && output.columns >= 20
  function restore() {
    if (active) output.write('\x1b[r\x1b[0m\x1b[?25h')
    active = false
  }
  function paint(reset = false) {
    if (!capable()) { restore(); return false }
    const first = !active || reset
    active = true
    if (first) output.write('\x1b[r\x1b[2J\x1b[H')
    else output.write('\x1b7')
    output.write('\x1b[1;1H' + renderHeader(getLines(), output.columns)
      .map(line => '\x1b[2K' + line).join('\r\n'))
    if (first) output.write(`\x1b[4;${output.rows}r\x1b[4;1H`)
    else output.write('\x1b8')
    return true
  }
  const resize = () => { if (!paint(true)) output.write(getLines().join('\n') + '\n') }
  output.on('resize', resize)
  return {
    banner() { if (!paint()) output.write(getLines().join('\n') + '\n') },
    log(value) { output.write(cleanLog(value) + '\n') },
    close() { output.off('resize', resize); restore() },
  }
}
