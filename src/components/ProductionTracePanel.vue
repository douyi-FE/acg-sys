<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFactoryStore } from '../stores/factory'
const props = defineProps<{ taskId: string }>()
const store = useFactoryStore()
const selected = ref('')
const records = computed(() => (store.db.executions ?? []).filter((item) => item.taskId === props.taskId))
const current = computed(
  () => records.value.find((item) => item.id === selected.value) ?? records.value.at(-1),
)
const currentModel = computed(() => {
  if (current.value?.modelId) return current.value.modelId
  try {
    const input: unknown = JSON.parse(current.value?.input ?? '{}')
    return input && typeof input === 'object' && 'modelId' in input && typeof input.modelId === 'string'
      ? input.modelId
      : '执行快照未记录'
  } catch {
    return '执行快照未记录'
  }
})
function exportTrace() {
  const data = {
    taskId: props.taskId,
    executions: records.value,
    traces: (store.db.traces ?? []).filter((item) => item.taskId === props.taskId),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `production-trace-${props.taskId}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <section class="panel production-trace">
    <div class="section-head">
      <div>
        <span class="eyebrow">INPUT → PROVIDER → EXECUTION → QUALITY → ASSET</span>
        <h2>Production Trace</h2>
      </div>
      <a-button
        :disabled="!records.length"
        @click="exportTrace"
        >导出追踪记录</a-button
      >
    </div>
    <p class="muted">
      Task 是生产目标，Execution 是每次实际执行。重试保留独立记录；Mock 与真实执行不会混记。
    </p>
    <div
      v-if="!records.length"
      class="empty-state"
    >
      尚无结构化执行记录。V0.1 历史日志仍可查看；新阶段运行后将在此记录，不补造历史 Execution。
    </div>
    <template v-else>
      <div class="trace-rail">
        <button
          v-for="record in records"
          :key="record.id"
          :class="{ selected: current?.id === record.id }"
          @click="selected = record.id"
        >
          <strong>{{ record.stageId }}</strong
          ><small>{{ record.status }}</small
          ><span>{{ record.id.slice(0, 12) }}</span>
        </button>
      </div>
      <div
        v-if="current"
        class="trace-detail"
      >
        <dl>
          <div>
            <dt>Execution ID</dt>
            <dd>{{ current.id }}</dd>
          </div>
          <div>
            <dt>Pipeline</dt>
            <dd>{{ current.pipelineId }}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{{ current.provider }}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{{ currentModel }}</dd>
          </div>
          <div>
            <dt>工作流</dt>
            <dd>{{ current.workflowId || '不适用' }}</dd>
          </div>
          <div>
            <dt>工作流版本</dt>
            <dd>{{ current.workflowVersion || '未记录' }}</dd>
          </div>
          <div>
            <dt>Attempt</dt>
            <dd>{{ current.attempt }}</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{{ current.stageKey || current.stageId }}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{{ new Date(current.startedAt).toLocaleString() }}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{{ current.finishedAt ? new Date(current.finishedAt).toLocaleString() : '尚未结束' }}</dd>
          </div>
        </dl>
        <a-alert
          v-if="current.error"
          type="error"
          show-icon
          :message="`${current.error.type} · ${current.error.code}`"
          :description="current.error.message"
        />
        <ul class="execution-logs">
          <li
            v-for="entry in current.logs"
            :key="entry.id"
          >
            <time>{{ new Date(entry.time).toLocaleTimeString() }}</time>
            <span>{{ entry.level }} · {{ entry.message }}</span>
          </li>
        </ul>
        <a-collapse>
          <a-collapse-panel
            key="snapshot"
            header="完整执行快照 · 输入、Prompt、Seed、输出、质量与错误"
          >
            <pre>{{ JSON.stringify(current, null, 2) }}</pre>
          </a-collapse-panel>
        </a-collapse>
      </div>
    </template>
  </section>
</template>
<style scoped>
.production-trace h2 {
  font-size: 18px;
  margin: 5px 0;
}
.execution-logs {
  padding: 0;
  list-style: none;
  font-size: 12px;
}
.execution-logs li {
  display: flex;
  gap: 12px;
  padding: 7px 0;
  overflow-wrap: anywhere;
}
.execution-logs time {
  flex-shrink: 0;
  color: #777;
}
.production-trace .section-head {
  flex-wrap: wrap;
}
.trace-rail {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 12px 0;
}
.trace-rail button {
  display: grid;
  gap: 7px;
  min-width: 160px;
  padding: 14px;
  border: 1px solid #e4e2f1;
  border-radius: 10px;
  text-align: left;
  background: #fafafd;
}
.trace-rail button.selected {
  border-color: #8279df;
  background: #f0edff;
}
.trace-rail strong {
  font-size: 12px;
}
.trace-rail small,
.trace-rail span {
  font-size: 10px;
  color: #9692a5;
}
.trace-detail dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  padding: 20px 0;
}
.trace-detail dt {
  font-size: 10px;
  color: #9793a5;
}
.trace-detail dd {
  margin: 6px 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.trace-detail pre {
  font-size: 11px;
  line-height: 1.8;
  max-height: 450px;
  overflow: auto;
}
@media (max-width: 767px) {
  .trace-detail dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
