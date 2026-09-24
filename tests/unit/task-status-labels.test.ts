import { describe, expect, it } from 'vitest'
import { TASK_STATUS_LABELS, TASK_STATUS_VALUES, taskStatusLabel } from '../../src/types'

describe('task status labels', () => {
  it('maps every internal task status to a consistent Chinese label', () => {
    expect(TASK_STATUS_VALUES).toEqual([
      'QUEUED',
      'RUNNING',
      'REVIEWING',
      'WAITING',
      'SUCCESS',
      'FAILED',
      'CANCELLED',
    ])
    expect(TASK_STATUS_LABELS).toEqual({
      QUEUED: '排队中',
      RUNNING: '制作中',
      REVIEWING: '待审核',
      WAITING: '等待中',
      SUCCESS: '已完成',
      FAILED: '失败',
      CANCELLED: '已取消',
    })
    expect(taskStatusLabel('SUCCESS')).toBe('已完成')
    expect(taskStatusLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})
