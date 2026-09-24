<script setup lang="ts">
/* global crypto, window */
import { computed, ref } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import type { Workflow } from '../../types'
import PageHeader from '../../components/PageHeader.vue'
import WorkflowVersionsPanel from '../../components/WorkflowVersionsPanel.vue'
import { isMockMode } from '../../api/mode'
import {
  kindLabels,
  metadataCapabilities,
  metadataErrors,
  providerLabel,
  retainOption,
  typeLabel,
} from '../../workflow/metadata'
import { useFieldValidation, required, jsonObject } from '../../composables/fieldValidation'
const { vField, validateFields, resetValidation } = useFieldValidation()
function mappingError() {
  const syntax = jsonObject(mapping.value)
  if (syntax) return syntax
  return Object.entries(JSON.parse(mapping.value)).some(
    ([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim(),
  )
    ? '映射的键和值必须为非空字符串'
    : undefined
}
function versionError() {
  const value = draft.value
  if (!value || !isMockMode) return
  if (!/^\d+\.\d+\.\d+$/.test(value.version)) return '版本号需使用 x.y.z 格式'
  const before = original.value
  if (before && value.version === before.version) {
    if (
      value.name !== before.name ||
      value.type !== before.type ||
      value.provider !== before.provider ||
      value.description !== before.description ||
      mapping.value !== JSON.stringify(before.mapping, null, 2)
    )
      return '配置已修改，请递增版本号'
    return
  }
  if (value.history.some((item) => item.version === value.version)) return '版本号已存在'
  if (before) {
    const old = before.version.split('.').map(Number)
    const next = value.version.split('.').map(Number)
    const index = next.findIndex((part, i) => part !== old[i])
    if (index < 0 || next[index]! <= old[index]!) return '新版本必须高于当前版本'
  }
}

const store = useFactoryStore()
const query = ref('')
const busy = ref('')
const error = ref('')
const notice = ref('')
const open = ref(false)
const draft = ref<Workflow | null>(null)
const original = ref<Workflow | null>(null)
const mapping = ref('{ }')
const changeNote = ref('')
const capabilities = computed(() => metadataCapabilities(isMockMode, store.db.providerRegistry))
const providerOptions = computed(() =>
  retainOption(
    capabilities.value.map((row) => ({ value: row.provider, label: providerLabel(row.provider) })),
    draft.value?.provider ?? '',
    providerLabel(draft.value?.provider ?? ''),
  ),
)
const typeOptions = computed(() =>
  retainOption(
    (capabilities.value.find((row) => row.provider === draft.value?.provider)?.workflowKinds ?? []).map(
      (kind) => ({ value: kind, label: kindLabels[kind] }),
    ),
    draft.value?.type ?? '',
    typeLabel(draft.value?.type ?? ''),
  ),
)
const selectionErrors = computed(() =>
  draft.value ? metadataErrors(draft.value, capabilities.value, original.value) : {},
)
const retained = computed(
  () =>
    !!draft.value &&
    (providerOptions.value.some((option) => option.value === draft.value?.provider && option.disabled) ||
      typeOptions.value.some((option) => option.value === draft.value?.type && option.disabled)),
)
const rows = computed(() =>
  store.db.workflows.filter((w) =>
    `${w.name} ${w.type} ${w.provider} ${typeLabel(w.type)} ${providerLabel(w.provider)}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
)
function edit(workflow?: Workflow, copy = false) {
  if (busy.value || store.loading) return
  error.value = ''
  notice.value = ''
  changeNote.value = ''
  resetValidation()
  original.value = workflow && !copy ? JSON.parse(JSON.stringify(workflow)) : null
  draft.value = workflow
    ? JSON.parse(JSON.stringify(workflow))
    : {
        id: crypto.randomUUID(),
        name: '',
        type: capabilities.value[0]?.workflowKinds[0] ?? '',
        provider: capabilities.value[0]?.provider ?? '',
        version: '1.0.0',
        active: false,
        description: '',
        mapping: {},
        history: [],
      }
  if (copy && draft.value) {
    draft.value.id = crypto.randomUUID()
    draft.value.name += '（副本）'
    draft.value.active = false
    draft.value.version = '1.0.0'
    draft.value.history = []
  }
  mapping.value = JSON.stringify(draft.value!.mapping, null, 2)
  open.value = true
}
async function save() {
  if (!draft.value || busy.value) return
  if (!validateFields()) return
  error.value = ''
  notice.value = ''
  try {
    if (!draft.value.name.trim() || !draft.value.type.trim() || !draft.value.provider.trim())
      throw new Error('请填写名称、类型与提供方')
    if (isMockMode && !/^\d+\.\d+\.\d+$/.test(draft.value.version))
      throw new Error('版本号需使用 x.y.z 格式，例如 1.1.0')
    const parsed: unknown = JSON.parse(mapping.value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(([k, v]) => !k.trim() || typeof v !== 'string' || !v.trim())
    )
      throw new Error('mapping 必须是键和值均为非空字符串的 JSON 对象')
    const changed =
      original.value &&
      (draft.value.name !== original.value.name ||
        draft.value.description !== original.value.description ||
        draft.value.type !== original.value.type ||
        draft.value.provider !== original.value.provider ||
        JSON.stringify(parsed) !== JSON.stringify(original.value.mapping))
    if (isMockMode && changed && draft.value.version === original.value?.version)
      throw new Error('配置已修改，请递增版本号以保留版本记录')
    const isNewVersion = !original.value || draft.value.version !== original.value.version
    if (isNewVersion && draft.value.history.some((h) => h.version === draft.value!.version))
      throw new Error('此版本号已存在，请使用新的版本号')
    if (isMockMode && original.value && isNewVersion) {
      const before = original.value.version.split('.').map(Number)
      const after = draft.value.version.split('.').map(Number)
      const firstDifference = after.findIndex((part, i) => part !== before[i])
      if (firstDifference < 0 || after[firstDifference]! <= before[firstDifference]!)
        throw new Error('新版本必须高于当前版本')
    }
    const saved: Workflow = {
      ...draft.value,
      name: draft.value.name.trim(),
      mapping: parsed as Record<string, string>,
      history: [...draft.value.history],
    }
    if (isNewVersion)
      saved.history.unshift({
        version: saved.version,
        time: new Date().toISOString(),
        description:
          changeNote.value.trim() || (original.value ? '更新工作流元数据与映射' : '创建工作流元数据'),
      })
    busy.value = saved.id
    await store.saveWorkflow(saved)
    open.value = false
    notice.value = '工作流元数据已保存；未部署或执行真实节点'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    busy.value = ''
  }
}
async function toggle(workflow: Workflow) {
  if (busy.value) return
  busy.value = workflow.id
  error.value = ''
  notice.value = ''
  try {
    await store.saveWorkflow({ ...workflow, active: !workflow.active })
    notice.value = isMockMode ? '启用状态已保存，仅影响本地配置' : '后端状态已保存；未执行节点'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '更新失败'
  } finally {
    busy.value = ''
  }
}
function close() {
  if (busy.value) return
  if (window.confirm('关闭编辑器？尚未保存的内容将丢失。')) open.value = false
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="工作流中心"
      description="维护流程元数据、参数映射和版本记录，让创作配置保持清晰。"
      eyebrow="工作流注册管理"
      ><a-button
        type="primary"
        :disabled="!!busy || store.loading"
        @click="edit()"
        >创建工作流</a-button
      ></PageHeader
    >
    <a-alert
      type="info"
      show-icon
      message="元数据继续复用 V0.1 配置；下方可执行文件版本保存完整 API、画布和参数映射快照，支持激活、停用与回滚。激活不代表已连接真实节点。"
    />
    <WorkflowVersionsPanel :workflows="store.db.workflows" />
    <a-alert
      v-if="error || store.error"
      type="error"
      show-icon
      :message="error || String(store.error)"
    />
    <a-alert
      v-if="notice"
      type="success"
      :message="notice"
    />
    <section class="panel">
      <div class="section-head">
        <h2>工作流配置</h2>
        <a-input
          v-model:value="query"
          class="search"
          allow-clear
          placeholder="搜索名称、类型或提供方"
        />
      </div>
      <div
        v-if="!rows.length"
        class="empty-state"
      >
        {{ store.loading ? '正在加载…' : '暂无工作流，创建第一份流程配置。' }}
      </div>
      <article
        v-for="w in rows"
        :key="w.id"
        class="workflow"
      >
        <div class="info">
          <div class="name">
            <h3>{{ w.name }}</h3>
            <span class="chip">v{{ w.version }}</span
            ><a-tag :color="w.active ? 'green' : 'default'">{{ w.active ? '已启用' : '已禁用' }}</a-tag>
          </div>
          <p class="muted">{{ w.description || '暂无描述' }}</p>
          <div class="muted meta">
            {{ typeLabel(w.type) }} · {{ providerLabel(w.provider) }} ·
            {{ Object.keys(w.mapping).length }} 项映射 · {{ w.history.length }} 条版本记录
          </div>
        </div>
        <div class="actions">
          <a-switch
            :checked="w.active"
            :loading="busy === w.id"
            :disabled="!!busy || store.loading"
            :aria-label="`${w.name}启用状态`"
            @change="toggle(w)"
          /><a-button
            :disabled="!!busy || store.loading"
            @click="edit(w)"
            >编辑 / 版本</a-button
          ><a-button
            :disabled="!!busy || store.loading"
            @click="edit(w, true)"
            >复制</a-button
          >
        </div>
      </article>
    </section>
    <a-drawer
      :open="open"
      title="工作流元数据"
      width="min(640px, 100vw)"
      :mask-closable="false"
      :closable="!busy"
      @close="close"
    >
      <div
        v-if="draft"
        class="form"
      >
        <a-alert
          v-if="error"
          type="error"
          :message="error"
          show-icon
        />
        <label
          v-field="required(draft.name, '名称')"
          class="field"
          >名称<a-input
            v-model:value="draft.name"
            :disabled="!!busy"
            :maxlength="100"
        /></label>
        <div class="pair">
          <label
            v-field="selectionErrors.type"
            class="field"
            >类型<a-select
              v-model:value="draft.type"
              :virtual="false"
              aria-label="工作流类型"
              :disabled="!!busy"
              :options="[{ value: '', label: '请选择类型', disabled: true }, ...typeOptions]" /></label
          ><label
            v-field="selectionErrors.provider"
            class="field"
            >提供方<a-select
              v-model:value="draft.provider"
              :virtual="false"
              aria-label="工作流提供方"
              :disabled="!!busy"
              :options="[{ value: '', label: '请选择提供方', disabled: true }, ...providerOptions]"
          /></label>
        </div>
        <p class="muted">
          类型按提供方能力列出；切换提供方不清空类型、映射或描述。ComfyUI 支持图像、视频、音频；OpenAI
          兼容服务与 Ollama 当前仅支持文本。模拟服务仅在演示模式可选。
        </p>
        <p class="muted">
          {{
            store.db.providerRegistry === undefined
              ? '未获得能力注册信息，使用已知适配器能力；不代表服务已配置或连接，执行前仍需验证。'
              : '选项来自当前可见的已启用提供方能力；无选项时请检查服务配置或访问权限。启用不代表连接正常。'
          }}
        </p>
        <p
          v-if="retained"
          role="status"
        >
          当前包含历史值或不可用值，已原样保留；可继续修改其他元数据。更改类型或提供方后须选择有效组合，不会自动转换。
        </p>
        <label
          v-if="isMockMode"
          v-field="versionError()"
          class="field"
          >版本号<a-input
            v-model:value="draft.version"
            :disabled="!!busy"
            placeholder="1.0.0"
        /></label>
        <label class="field"
          >描述<a-textarea
            v-model:value="draft.description"
            :rows="3"
            :disabled="!!busy"
        /></label>
        <label
          v-field="mappingError()"
          class="field"
          >参数映射（JSON）<a-textarea
            v-model:value="mapping"
            class="mapping"
            :rows="8"
            :disabled="!!busy"
            spellcheck="false"
        /></label>
        <p class="muted">例如 {"prompt": "input.prompt"}，只保存映射文本，不解释执行。</p>
        <label class="field"
          >版本说明<a-input
            v-model:value="changeNote"
            :disabled="!!busy"
        /></label>
        <div class="actions">
          <a-switch
            v-model:checked="draft.active"
            aria-label="启用工作流配置"
            :disabled="!!busy"
          />{{ isMockMode ? '启用本地配置' : '启用工作流配置' }}
        </div>
        <a-button
          type="primary"
          class="save"
          :loading="!!busy"
          :disabled="!!busy"
          @click="save"
          >保存配置</a-button
        >
        <h3>版本记录</h3>
        <div
          v-if="!draft.history.length"
          class="empty-state"
        >
          保存后生成首条版本记录。
        </div>
        <div
          v-for="(history, index) in draft.history"
          :key="index"
          class="history"
        >
          <b>v{{ history.version }}</b
          ><small class="muted">{{ history.time }}</small>
          <p>{{ history.description }}</p>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.search {
  max-width: 320px;
}
.workflow {
  display: flex;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
  padding: 24px 0;
  border-top: 1px solid #eeeef4;
}
.info {
  min-width: 0;
  overflow-wrap: anywhere;
}
.name,
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.name h3 {
  margin: 0;
  font-size: 17px;
}
.meta {
  font-size: 12px;
}
.field {
  display: grid;
  min-width: 0;
  gap: 8px;
  margin: 16px 0;
}
.field :deep(.ant-select) {
  min-width: 0;
  width: 100%;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.mapping {
  font-family: monospace;
}
.form {
  overflow-wrap: anywhere;
}
.save {
  margin: 24px 0;
}
.history {
  padding: 16px 0;
  border-top: 1px solid #eee;
}
.history small {
  display: block;
  margin-top: 6px;
}
.section-head {
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}
.actions {
  flex-shrink: 0;
}
@media (max-width: 850px) {
  .workflow {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (max-width: 450px) {
  .pair {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .search {
    max-width: none;
  }
}
</style>
