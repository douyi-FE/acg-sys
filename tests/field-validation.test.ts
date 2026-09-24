import { describe, expect, it } from 'vitest'
import { endpoint, jsonObject, numberRange, required, passwordError, usernameError, textField } from '../src/composables/fieldValidation'

describe('字段校验规则', () => {
  it('账号规则与后端一致，可选文本不阻止合法保存', () => {
    expect(usernameError('user.name@example')).toBeUndefined()
    expect(usernameError(' user ')).toBeTruthy()
    expect(passwordError('x'.repeat(12))).toBeUndefined()
    expect(passwordError('x'.repeat(128))).toBeUndefined()
    expect(passwordError('x'.repeat(11))).toBeTruthy()
    expect(passwordError('x'.repeat(129))).toBeTruthy()
    expect(textField('', '密钥', 8192, true)).toBeUndefined()
    expect(textField('abc', '名称', 2)).toBeTruthy()
    expect(jsonObject('{"nested":{"value":1e999}}')).toBeTruthy()
  })
  it('空白必填、数字类型和范围', () => {
    expect(required('  ', '标题')).toBe('请填写标题')
    expect(required('有效标题', '标题')).toBeUndefined()
    for (const value of [null, '', '5', NaN, Infinity, -1, 101])
      expect(numberRange(value, 0, 100)).toBeTruthy()
    expect(numberRange(0, 0, 100)).toBeUndefined()
    expect(numberRange(1.2, 0, 10, true)).toBeTruthy()
  })
  it('地址和 JSON 无效时返回中文错误而不是抛出异常', () => {
    for (const url of ['', 'bad', 'ftp://host', 'http://u:p@host', 'https://host/?key=x'])
      expect(endpoint(url)).toBeTruthy()
    expect(endpoint('http://localhost:8188')).toBeUndefined()
    for (const json of ['', '{', 'null', '[]', '3']) expect(jsonObject(json)).toBeTruthy()
    expect(jsonObject('{"prompt":"text"}')).toBeUndefined()
  })
})
