<script setup lang="ts">
import { taskStatusLabel } from '../types'
import type { TaskStatus } from '../types'
defineProps<{ status: TaskStatus | string; label?: string }>()
const labels: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  success: '已完成',
  failed: '失败',
}
</script>
<template>
  <span
    class="status-badge"
    :class="`status-${status.toLowerCase()}`"
    ><i></i>{{ label || labels[status] || taskStatusLabel(status) }}</span
  >
</template>
