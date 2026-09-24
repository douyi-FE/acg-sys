<script setup lang="ts">
/* global window */
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useFactoryStore } from '../../stores/factory'
import type { Settings } from '../../types'
import PageHeader from '../../components/PageHeader.vue'
import StageQualitySettings from '../../components/StageQualitySettings.vue'
import { useFieldValidation, numberRange } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

const store = useFactoryStore()
const draft = ref<Settings>({ ...store.db.settings })
const baseline = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value)
const busy = ref(false)
const error = ref('')
const notice = ref('')
watch(
  () => store.db.settings,
  (settings) => {
    if (!dirty.value && JSON.stringify(settings) !== baseline.value) {
      draft.value = { ...settings }
      baseline.value = JSON.stringify(draft.value)
    }
  },
  { deep: true },
)
watch(
  draft,
  () => {
    notice.value = ''
  },
  { deep: true, flush: 'sync' },
)
onBeforeRouteLeave(() => !busy.value && (!dirty.value || window.confirm('设置尚未保存，确定离开？')))
function reset() {
  draft.value = { ...store.db.settings }
  baseline.value = JSON.stringify(draft.value)
  error.value = ''
  notice.value = ''
}
function preset(mode: 'draft' | 'production' | 'strict') {
  const values = {
    draft: { threshold: 70, maxIterations: 2, maxRetries: 1 },
    production: { threshold: 85, maxIterations: 3, maxRetries: 2 },
    strict: { threshold: 95, maxIterations: 4, maxRetries: 3 },
  }
  Object.assign(draft.value, values[mode])
}
async function save() {
  if (busy.value) return
  error.value = ''
  notice.value = ''
  const { threshold, maxRetries, maxIterations } = draft.value
  if (!validateFields()) return
  busy.value = true
  try {
    // 保留未在本页面编辑的 stageDuration 等配置。
    const settings: Settings = {
      ...store.db.settings,
      threshold,
      maxRetries,
      maxIterations,
      autoRetry: draft.value.autoRetry,
    }
    await store.saveSettings(settings)
    draft.value = { ...settings }
    baseline.value = JSON.stringify(settings)
    notice.value = '设置已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="系统设置"
      description="配置内容质量门槛与自动恢复策略，平衡质量、耗时与重试成本。"
      eyebrow="FACTORY PREFERENCES"
      ><a-button
        type="primary"
        :loading="busy"
        :disabled="busy || !dirty"
        @click="save"
        >保存设置</a-button
      ></PageHeader
    >
    <a-alert
      v-if="error || store.error"
      type="error"
      show-icon
      :message="error || String(store.error)"
    />
    <a-alert
      v-if="notice"
      type="success"
      show-icon
      :message="notice"
    />
    <section class="panel settings">
      <div class="section-head">
        <h2>质量控制</h2>
        <span class="chip">{{ dirty ? '有未保存修改' : '已同步' }}</span>
      </div>
      <div
        class="presets"
        aria-label="质量预设"
      >
        <a-button
          :disabled="busy"
          @click="preset('draft')"
          >Draft · 70</a-button
        >
        <a-button
          :disabled="busy"
          @click="preset('production')"
          >Production · 85</a-button
        >
        <a-button
          :disabled="busy"
          @click="preset('strict')"
          >Strict · 95</a-button
        >
        <p class="muted">预设只修改当前草稿，保存后生效；高分阈值不代表真实内容已通过审核。</p>
      </div>
      <div v-field="numberRange(draft.threshold, 0, 100)" class="setting">
        <div>
          <label for="threshold">质量通过阈值</label>
          <p class="muted">评分达到此值才视为质量通过，范围 0–100。</p>
        </div>
        <a-input-number
          id="threshold"
          v-model:value="draft.threshold"
          :min="0"
          :max="100"
          :disabled="busy"
        />
      </div>
      <div v-field="numberRange(draft.maxIterations, 1, 20, true)" class="setting">
        <div>
          <label for="iterations">最大质量迭代次数</label>
          <p class="muted">限制质量优化轮数，避免无限改写，范围 1–20。</p>
        </div>
        <a-input-number
          id="iterations"
          v-model:value="draft.maxIterations"
          :min="1"
          :max="20"
          :precision="0"
          :disabled="busy"
        />
      </div>
      <h2 class="subhead">失败恢复</h2>
      <div class="setting">
        <div>
          <label id="retry-label">自动重试</label>
          <p class="muted">失败时允许按本地任务策略自动重试，仍受次数上限约束。</p>
        </div>
        <a-switch
          v-model:checked="draft.autoRetry"
          aria-labelledby="retry-label"
          :disabled="busy"
        />
      </div>
      <div v-field="numberRange(draft.maxRetries, 0, 10, true)" class="setting">
        <div>
          <label for="retries">最大重试次数</label>
          <p class="muted">每个任务允许的最大重试次数，范围 0–10。关闭自动重试时仍保留此配置。</p>
        </div>
        <a-input-number
          id="retries"
          v-model:value="draft.maxRetries"
          :min="0"
          :max="10"
          :precision="0"
          :disabled="busy"
        />
      </div>
      <div class="footer">
        <span class="muted">配置仅在保存后生效，不会在此页面触发任务执行。</span
        ><a-button
          :disabled="busy || !dirty"
          @click="reset"
          >撤销未保存修改</a-button
        >
      </div>
    </section>
    <StageQualitySettings />
  </div>
</template>

<style scoped>
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.presets p {
  width: 100%;
  font-size: 12px;
}
.settings {
  max-width: 960px;
}
.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 26px 0;
  border-top: 1px solid #eeeef4;
}
.setting > div:first-child {
  min-width: 0;
}
.setting label {
  font-size: 15px;
  font-weight: 600;
}
.setting p {
  margin: 8px 0 0;
  line-height: 1.7;
  font-size: 13px;
}
.setting :deep(.ant-input-number) {
  width: 130px;
  flex-shrink: 0;
}
.subhead {
  margin: 20px 0;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  border-top: 1px solid #eeeef4;
  padding-top: 24px;
}
.footer .muted {
  font-size: 12px;
}
h2 {
  font-size: 18px;
}
.section-head {
  flex-wrap: wrap;
  gap: 10px;
}
@media (max-width: 500px) {
  .setting {
    align-items: flex-start;
    gap: 14px;
    flex-direction: column;
  }
  .setting :deep(.ant-input-number) {
    width: 100%;
  }
}
</style>
