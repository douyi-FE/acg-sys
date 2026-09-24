<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useFactoryStore } from '../stores/factory'
import { pipelineDefinitions } from '../orchestrator/definitions'
import type { QualityGateConfig } from '../types'
import { useFieldValidation, required, numberRange } from '../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

const store = useFactoryStore()
const configs = ref<QualityGateConfig[]>([])
const baseline = ref('[]')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref('')
const threshold = ref(85)
const dirty = computed(() => JSON.stringify(configs.value) !== baseline.value)
const stages = computed(() => {
  const seen = new Set<string>()
  return (store.db.pipelines ?? pipelineDefinitions()).flatMap((pipeline) =>
    pipeline.stages.flatMap((stage) => {
      if (seen.has(stage.id) || stage.manual) return []
      seen.add(stage.id)
      return [{ value: stage.id, label: `${stage.name} · ${stage.id}` }]
    }),
  )
})
watch(
  () => store.db.qualityConfigs,
  (value) => {
    if (dirty.value) return
    configs.value = JSON.parse(JSON.stringify(value ?? [])) as QualityGateConfig[]
    baseline.value = JSON.stringify(configs.value)
  },
  { immediate: true, deep: true },
)
onBeforeRouteLeave(() => !busy.value && (!dirty.value || window.confirm('阶段质量配置尚未保存，确定离开？')))

function add() {
  error.value = ''
  notice.value = ''
  if (!validateFields()) return
  const existing = configs.value.find((item) => item.stageId === selected.value)
  if (existing) Object.assign(existing, { threshold: threshold.value, enabled: true })
  else configs.value.push({ stageId: selected.value, threshold: threshold.value, enabled: true })
}
async function save() {
  if (busy.value) return
  // A partially edited add/update row must not silently disappear on save.
  if ((selected.value || threshold.value !== 85) && !validateFields()) return
  if (selected.value) add()
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await store.saveQualityConfigs(configs.value)
    baseline.value = JSON.stringify(configs.value)
    notice.value = '阶段质量配置已保存'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
function reset() {
  configs.value = JSON.parse(JSON.stringify(store.db.qualityConfigs ?? [])) as QualityGateConfig[]
  baseline.value = JSON.stringify(configs.value)
  error.value = ''
  notice.value = ''
}
</script>

<template>
  <section class="panel stage-quality">
    <div class="section-head">
      <h2>阶段 Quality Gate</h2>
      <span class="chip">{{ dirty ? '未保存' : '已同步' }}</span>
    </div>
    <p class="muted">
      为指定阶段增加质量检查或覆盖门槛。未配置的最终审核使用全局阈值；Mock 分数不代表真实媒体检测。真实
      Provider 未配置评估器时会明确拒绝模拟评分。
    </p>
    <a-alert
      v-if="error"
      type="error"
      :message="error"
      show-icon
    />
    <a-alert
      v-if="notice"
      type="success"
      :message="notice"
      show-icon
    />
    <div class="stage-form">
      <label
        v-field="required(selected, '质量配置阶段') || (stages.some(stage => stage.value === selected) ? undefined : '请选择有效阶段')"
        for="stage-quality-select"
        class="stage-select-label"
        >质量配置阶段
        <a-select
          id="stage-quality-select"
          v-model:value="selected"
          :options="stages"
          placeholder="选择阶段"
          :disabled="busy"
        />
      </label>
      <label v-field="numberRange(threshold, 0, 100)">阶段质量阈值<a-input-number
        v-model:value="threshold"
        :min="0"
        :max="100"
        aria-label="阶段质量阈值"
        :disabled="busy"
      /></label>
      <a-button
        :disabled="busy"
        @click="add"
        >添加 / 更新阶段</a-button
      >
    </div>
    <div
      v-if="!configs.length"
      class="empty-state"
    >
      尚无阶段覆盖，使用默认审核策略。
    </div>
    <div
      v-for="config in configs"
      :key="config.stageId"
      class="quality-row"
    >
      <div>
        <strong>{{ stages.find((item) => item.value === config.stageId)?.label ?? config.stageId }}</strong>
        <p class="muted">阈值 {{ config.threshold }} · {{ config.enabled === false ? '停用' : '启用' }}</p>
      </div>
      <a-button
        danger
        :disabled="busy"
        @click="configs = configs.filter((item) => item.stageId !== config.stageId)"
        >移除覆盖</a-button
      >
    </div>
    <div class="stage-actions">
      <a-button
        :disabled="busy || !dirty"
        @click="reset"
        >撤销阶段修改</a-button
      >
      <a-button
        type="primary"
        :loading="busy"
        :disabled="!dirty"
        @click="save"
        >保存阶段质量配置</a-button
      >
    </div>
  </section>
</template>

<style scoped>
.stage-quality {
  max-width: 960px;
}
.stage-select-label {
  display: grid;
  gap: 8px;
  font-size: 12px;
}
h2 {
  font-size: 18px;
}
.stage-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px auto;
  align-items: end;
  gap: 12px;
  margin: 20px 0;
}
.stage-form :deep(.ant-input-number) {
  width: 100%;
}
.quality-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  border-top: 1px solid #eee;
  padding: 16px 0;
}
.quality-row strong {
  overflow-wrap: anywhere;
  font-size: 13px;
}
.quality-row p {
  font-size: 12px;
}
.stage-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
@media (max-width: 600px) {
  .stage-form {
    grid-template-columns: 1fr;
  }
  .quality-row {
    align-items: flex-start;
  }
}
</style>
