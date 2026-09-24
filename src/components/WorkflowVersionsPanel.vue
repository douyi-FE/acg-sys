<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { Workflow } from '../types'
import {
  WorkflowVersionRegistry,
  parseWorkflowImport,
  parseWorkflowSnapshot,
  parseMapping,
  type WorkflowHistory,
  type WorkflowRevision,
} from '../workflow/versions'
import type { ApiWorkflow } from '../providers/comfyui'
import { isMockMode } from '../api/mode'
import { serverRequest } from '../api/session'
import { segment } from '../api/http'
import { serverHistory, saveServerSnapshot } from '../workflow/server-versions'
import { useAuthStore } from '../stores/auth'
import { useFieldValidation } from '../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
const fileError = ref<string>()
function importError(text: string, kind: 'api' | 'ui') {
  if (!text.trim()) return kind === 'api' && !ui.value.trim() ? '请至少提供 API 或 UI 工作流' : undefined
  try {
    return parseWorkflowImport(text).kind === kind ? undefined : `请填写 ${kind.toUpperCase()} 格式工作流`
  } catch (cause) { return cause instanceof Error ? cause.message : '工作流 JSON 无效' }
}
function mappingError() {
  try { parseMapping(mapping.value) } catch (cause) { return cause instanceof Error ? cause.message : '映射 JSON 无效' }
}
const auth = useAuthStore()
const props = defineProps<{ workflows: Workflow[] }>()
const registry = new WorkflowVersionRegistry()
const selected = ref('')
const history = ref<WorkflowHistory>({ workflowId: '', activeRevisionId: null, revisions: [] })
const open = ref(false)
const version = ref('1.0.0')
const note = ref('')
const api = ref('')
const ui = ref('')
const mapping = ref('{}')
const error = ref('')
const busy = ref(false)
const workflow = computed(() => props.workflows.find((item) => item.id === selected.value))
watch(
  () => props.workflows,
  (items) => {
    if (!selected.value) selected.value = items[0]?.id ?? ''
  },
  { immediate: true },
)
watch(selected, () => { void refresh().catch(() => undefined) }, { immediate: true })
async function refresh() {
  const id = selected.value
  if (!id) return
  try {
    const result = isMockMode ? registry.list(id) : await serverHistory(id)
    if (id !== selected.value) return
    history.value = result
    error.value = ''
  } catch (cause) {
    history.value = { workflowId: id, activeRevisionId: null, revisions: [] }
    error.value = cause instanceof Error ? cause.message : '读取失败'
    throw cause
  }
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileError.value = undefined
  if (file.size > 3_000_000) {
    fileError.value = '工作流文件不得超过 3MB'
    await nextTick()
    validateFields()
    return
  }
  busy.value = true
  file
    .text()
    .then((text) => {
      const snapshot = parseWorkflowSnapshot(text)
      if (snapshot) {
        api.value = snapshot.apiWorkflow ? JSON.stringify(snapshot.apiWorkflow, null, 2) : ''
        ui.value = snapshot.uiWorkflow ? JSON.stringify(snapshot.uiWorkflow, null, 2) : ''
        mapping.value = JSON.stringify(snapshot.mapping, null, 2)
        version.value = snapshot.version
        note.value = snapshot.note
        message.success('已读取完整版本快照，尚未保存或激活')
        return
      }
      const parsed = parseWorkflowImport(text)
      if (parsed.kind === 'ui') ui.value = JSON.stringify(parsed.value, null, 2)
      else api.value = JSON.stringify(parsed.value, null, 2)
      message.success(`已识别 ${parsed.kind.toUpperCase()} Workflow，尚未保存`)
    })
    .catch((cause) => {
      fileError.value = cause instanceof Error ? cause.message : '文件内容无效'
      void nextTick().then(() => validateFields())
    })
    .finally(() => {
      busy.value = false
    })
}
async function save() {
  if (busy.value) return
  if (!validateFields()) return
  busy.value = true
  try {
    if (!workflow.value) throw new Error('请选择工作流')
    const apiValue = api.value.trim() ? parseWorkflowImport(api.value) : null
    const uiValue = ui.value.trim() ? parseWorkflowImport(ui.value) : null
    if (apiValue && apiValue.kind !== 'api') throw new Error('API 区域中检测到 UI Workflow')
    if (uiValue && uiValue.kind !== 'ui') throw new Error('UI 区域中检测到 API Workflow')
    const snapshot = {
      version: version.value,
      note: note.value,
      apiWorkflow: (apiValue?.value as ApiWorkflow | undefined) ?? null,
      uiWorkflow: uiValue?.value ?? null,
      mapping: parseMapping(mapping.value),
    }
    if (isMockMode) registry.import(workflow.value, snapshot)
    else await saveServerSnapshot(selected.value, snapshot)
    await refresh()
    open.value = false
    message.success('版本快照已保存，尚未激活')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败'
  } finally { busy.value = false }
}
async function activate(id: string | null) {
  if (busy.value) return
  busy.value = true
  try {
    if (isMockMode) registry.activate(selected.value, id)
    else if (id) {
      const revision = history.value.revisions.find(row => row.id === id)
      if (!revision) throw new Error('版本不存在')
      await saveServerSnapshot(selected.value, revision, true)
    } else await serverRequest(`/workflows/${segment(selected.value)}`, 'PATCH', { status: 'DRAFT' })
    await refresh()
    message.success(id ? '活动版本已切换；未执行 Workflow' : '执行版本已停用')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败'
  } finally { busy.value = false }
}
function exportRevision(revision: WorkflowRevision) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(revision, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${selected.value}-${revision.version}-snapshot.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function duplicate(revision: WorkflowRevision) {
  const parts = revision.version.split('.')
  version.value = `${parts[0]}.${parts[1]}.${Number.parseInt(parts[2] ?? '0') + 1}`
  api.value = revision.apiWorkflow ? JSON.stringify(revision.apiWorkflow, null, 2) : ''
  ui.value = revision.uiWorkflow ? JSON.stringify(revision.uiWorkflow, null, 2) : ''
  mapping.value = JSON.stringify(revision.mapping, null, 2)
  note.value = `基于 ${revision.version} 复制`
  open.value = true
}
</script>
<template>
  <section class="panel version-panel">
    <div class="section-head">
      <div>
        <span class="eyebrow">可执行工作流快照</span>
        <h2>工作流文件与版本</h2>
      </div>
      <a-button
        :disabled="!workflow || busy || !auth.can('workflows.update')"
        @click="open = true"
        >导入工作流版本</a-button
      >
    </div>
    <p class="muted">
      元数据与可执行快照分离。API 工作流、画布工作流、参数映射
      独立保存，回滚只切换不可变快照，不伪造节点或模型可用性。
    </p>
    <p v-if="!isMockMode" class="muted">真实模式使用后端自动编号；导入会将当前工作流设为草稿。激活 / 回滚复制所选内容为新的后端快照，不修改历史，也不执行节点。</p>
    <a-select
      v-model:value="selected"
      aria-label="版本工作流"
      class="full"
      :options="workflows.map((item) => ({ value: item.id, label: item.name }))"
    />
    <a-alert
      v-if="error"
      type="error"
      :message="error"
      show-icon
    />
    <div
      v-if="!history.revisions.length"
      class="empty-state"
    >
      暂无文件版本。现有元数据配置仍保留；导入真实 API 工作流后才可激活执行版本。
    </div>
    <article
      v-for="revision in history.revisions.slice().reverse()"
      :key="revision.id"
      class="revision"
    >
      <div>
        <h3>
          V{{ revision.version }}
          <a-tag
            v-if="history.activeRevisionId === revision.id"
            color="green"
            >Active</a-tag
          >
        </h3>
        <p class="muted">{{ revision.note }} · {{ new Date(revision.createdAt).toLocaleString() }}</p>
        <span class="chip">{{ revision.apiWorkflow ? 'API 已导入' : 'API 未配置' }}</span>
        <span class="chip">{{ revision.uiWorkflow ? 'UI 已导入' : 'UI 未配置' }}</span>
      </div>
      <div class="revision-actions">
        <a-button @click="exportRevision(revision)">导出</a-button
        ><a-button @click="duplicate(revision)">复制版本</a-button
        ><a-button
          v-if="history.activeRevisionId !== revision.id"
          :disabled="busy || !auth.can('workflows.update')"
          @click="activate(revision.id)"
          >{{ history.activeRevisionId ? '回滚 / 激活' : '激活' }}</a-button
        ><a-button
          v-else
          :disabled="busy || !auth.can('workflows.update')"
          @click="activate(null)"
          >停用</a-button
        >
      </div>
    </article>
    <a-drawer
      v-model:open="open"
      title="导入版本 · 画布 / API / 参数映射"
      width="min(850px,100vw)"
    >
      <a-alert
        v-if="error"
        type="error"
        :message="error"
        show-icon
      />
      <div class="mobile-editor-note">
        JSON 编辑为 PC 优先能力。请在桌面端导入或调整，手机仍可查看、审批与下载。
      </div>
      <div class="desktop-editor">
        <label v-field="fileError" class="field"
          >上传 JSON（自动识别 UI / API）<input
            aria-label="上传工作流 JSON"
            type="file"
            accept=".json,application/json"
            :disabled="busy"
            @change="importFile"
        /></label>
        <label v-if="isMockMode" v-field="!/^\d+\.\d+\.\d+$/.test(version) ? '版本号需使用 x.y.z 格式' : history.revisions.some(row => row.version === version) ? '版本号已存在' : undefined" class="field"
          >版本号<a-input
            v-model:value="version"
            placeholder="1.0.0"
        /></label>
        <label class="field">版本说明<a-input v-model:value="note" /></label>
        <label v-field="importError(api, 'api')" class="field"
          >API 工作流 JSON<a-textarea
            v-model:value="api"
            :rows="8"
            placeholder="ComfyUI API Format，不是画布 nodes/links JSON"
        /></label>
        <label v-field="importError(ui, 'ui')" class="field"
          >画布工作流 JSON（可选）<a-textarea
            v-model:value="ui"
            :rows="5"
            placeholder="仅供画布存档，不能直接执行"
        /></label>
        <label v-field="mappingError()" class="field"
          >参数映射<a-textarea
            v-model:value="mapping"
            :rows="5"
            placeholder='{"prompt":"实际节点.inputs.text"}'
        /></label>
        <a-button
          type="primary"
          :loading="busy"
          @click="save"
          >保存不可变版本</a-button
        >
      </div>
    </a-drawer>
  </section>
</template>
<style scoped>
.full {
  width: 100%;
  margin: 16px 0;
}
.revision {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding: 18px 0;
  border-top: 1px solid #efedf5;
}
.revision-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.desktop-editor {
  display: grid;
  gap: 20px;
}
.field {
  display: grid;
  gap: 8px;
}
.mobile-editor-note {
  display: none;
}
.version-panel h2 {
  font-size: 18px;
}
.revision h3 {
  font-size: 15px;
}
@media (max-width: 767px) {
  .desktop-editor {
    display: none;
  }
  .mobile-editor-note {
    display: block;
  }
  .revision {
    flex-direction: column;
    align-items: flex-start;
  }
  .section-head {
    flex-wrap: wrap;
  }
}
</style>
