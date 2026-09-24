/* global HTMLElement, URL */
import { nextTick, type ObjectDirective } from 'vue'

export type FieldError = string | undefined
export function required(value: unknown, label = '此项'): FieldError {
  if (value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length))
    return `请填写${label}`
}
export function textField(value: unknown, label: string, max: number, optional = false): FieldError {
  if (optional && (value === undefined || value === '')) return
  return required(value, label) || (typeof value !== 'string' ? `请输入${label}` : value.length > max ? `${label}最多 ${max} 字符` : undefined)
}
export function usernameError(value: unknown): FieldError {
  return textField(value, '用户名', 100) || (typeof value === 'string' && !/^[a-zA-Z0-9_.@-]+$/.test(value) ? '用户名仅支持字母、数字及 _.@-' : undefined)
}
export function passwordError(value: unknown): FieldError {
  return typeof value !== 'string' || value.length < 12 || value.length > 128 ? '密码须为 12–128 个字符' : undefined
}
export function numberRange(value: unknown, min: number, max: number, integer = false): FieldError {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    return `请输入 ${min}–${max} 范围内的${integer ? '整数' : '数字'}`
}
export function endpoint(value: string): FieldError {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      return '请输入 HTTP(S) 地址，不含账号、密码、查询参数或片段'
  } catch {
    return '请输入有效的 HTTP(S) 地址'
  }
}
export function jsonObject(value: string): FieldError {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '请输入 JSON 对象'
    // JSON.parse accepts overflowing numbers such as 1e999; providers do not.
    const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item)
      : item !== null && typeof item === 'object' ? Object.values(item).every(finite) : true
    if (!finite(parsed)) return 'JSON 数字必须为有限值'
  } catch {
    return '请输入有效的 JSON 对象'
  }
}

let sequence = 0
const controls = 'input:not([type="hidden"]), textarea, select, [role="switch"]'
interface FieldState {
  error: FieldError
  touched: boolean
  message: HTMLElement
  blur: () => void
}

/** One registry per form/action. Bind to a native wrapper or an Ant FormItem. */
export function useFieldValidation() {
  const fields = new Map<HTMLElement, FieldState>()
  function render(el: HTMLElement, state: FieldState) {
    const invalid = state.touched && !!state.error
    el.classList.toggle('inline-field-invalid', invalid)
    state.message.textContent = invalid ? state.error! : ''
    state.message.hidden = !invalid
    // FormItem is a flex row: put help inside the control column, not beside it.
    const host = el.querySelector('.ant-form-item-control') ?? el
    if (state.message.parentElement !== host) host.appendChild(state.message)
    for (const control of el.querySelectorAll<HTMLElement>(controls)) {
      control.setAttribute('aria-invalid', String(invalid))
      const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== state.message.id)
      if (invalid) ids.push(state.message.id)
      if (ids.length) control.setAttribute('aria-describedby', ids.join(' '))
      else control.removeAttribute('aria-describedby')
    }
  }
  const vField: ObjectDirective<HTMLElement, FieldError> = {
    mounted(el, binding) {
      const message = el.ownerDocument.createElement('span')
      message.id = `field-error-${++sequence}`
      message.className = 'inline-field-error'
      message.setAttribute('aria-live', 'polite')
      const state: FieldState = {
        error: binding.value, touched: false, message,
        blur: () => { void nextTick(() => {
          if (!fields.has(el)) return
          state.touched = true
          render(el, state)
        }) },
      }
      fields.set(el, state)
      el.addEventListener('focusout', state.blur)
      render(el, state)
    },
    updated(el, binding) {
      const state = fields.get(el)
      if (!state) return
      state.error = binding.value
      render(el, state)
    },
    beforeUnmount(el) {
      const state = fields.get(el)
      if (!state) return
      el.removeEventListener('focusout', state.blur)
      state.message.remove()
      fields.delete(el)
    },
  }
  function validateFields() {
    let first: HTMLElement | undefined
    for (const [el, state] of fields) {
      // Inactive tabs and retained closed drawers must not block unrelated actions.
      if (!el.isConnected || !el.getClientRects().length) continue
      if (![...el.querySelectorAll<HTMLElement>(controls)].some(control => !control.matches(':disabled'))) continue
      state.touched = true
      render(el, state)
      if (state.error && !first) first = el
    }
    if (first) {
      first.scrollIntoView({ block: 'center', behavior: 'auto' })
      first.querySelector<HTMLElement>(`${controls.split(', ').map(selector => `${selector}:not(:disabled)`).join(', ')}`)?.focus({ preventScroll: true })
    }
    return !first
  }
  function resetValidation() {
    for (const [el, state] of fields) {
      state.touched = false
      render(el, state)
    }
  }
  return { vField, validateFields, resetValidation }
}
