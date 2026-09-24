import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { addressLines, cleanLog, createTerminal, publicAddress, renderHeader } from '../scripts/dev-terminal.mjs'

const base = { host: '127.0.0.1', port: 12345, mode: 'demo', backend: 'not started',
  interfaces: { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] } }
describe('development terminal', () => {
  it('reports actual port and only advertises LAN for matching bindings', () => {
    expect(addressLines(base)[0]).toContain('http://127.0.0.1:12345/')
    expect(addressLines(base)[1]).toContain('unavailable')
    expect(addressLines({ ...base, host: '0.0.0.0' })[1]).toContain('http://192.168.1.20:12345/')
    expect(addressLines({ ...base, host: '192.168.2.2' })[1]).toContain('unavailable')
  })
  it('never echoes invalid remote secrets or implies verification', () => {
    for (const value of ['ftp://host', 'https://user:secret@host', 'https://host?token=secret']) {
      expect(publicAddress(value)).not.toContain('secret')
      expect(publicAddress(value)).toContain('invalid')
    }
    expect(publicAddress('https://example.com')).toContain('configured, not verified')
    expect(publicAddress()).toBe('unconfigured')
    expect(cleanLog('\x1b[2Jpassword=abc https://u:p@host')).toBe('password=[redacted] https://[redacted]@host')
  })
  it('clips to safe dimensions and restores on resize and close', () => {
    const output = Object.assign(new EventEmitter(), { isTTY: true, rows: 24, columns: 80, write: value => chunks.push(value) })
    const chunks = []
    const terminal = createTerminal(output, () => addressLines(base), { TERM: 'xterm' })
    terminal.banner()
    expect(chunks.join('')).toContain('\x1b[4;24r')
    expect(renderHeader(addressLines(base), 20).every(line => line.length <= 19)).toBe(true)
    output.rows = 30; output.emit('resize')
    expect(chunks.join('')).toContain('\x1b[4;30r')
    output.rows = 3; output.emit('resize')
    terminal.close()
    expect(chunks.join('')).toContain('\x1b[r\x1b[0m\x1b[?25h')
    expect(output.listenerCount('resize')).toBe(0)
  })
  it('produces readable escape-free non-TTY output even with FORCE_COLOR', () => {
    const chunks = []
    const output = Object.assign(new EventEmitter(), { write: value => chunks.push(value) })
    const terminal = createTerminal(output, () => addressLines(base), { FORCE_COLOR: '1' })
    terminal.banner(); terminal.log('\x1b[31mhello\x1b[0m'); terminal.close()
    expect(chunks.join('')).not.toContain('\x1b')
    expect(chunks.join('')).toContain('hello')
  })
})
