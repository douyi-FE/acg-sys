<script setup lang="ts">
/* global HTMLElement, HTMLAnchorElement, URL, Blob, document, window */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { useFactoryStore } from '../../stores/factory'
import { allowedActions, reviewActionReason } from '../../services/pipeline'
import { useAuthStore } from '../../stores/auth'
import PageHeader from '../../components/PageHeader.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import ProductionTracePanel from '../../components/ProductionTracePanel.vue'
import TaskReviewPreview from '../../components/TaskReviewPreview.vue'
import { isMockMode } from '../../api/mode'
import type { Character, TaskAction, VideoShot, VideoTask } from '../../types'
import { useFieldValidation, required, numberRange } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
const { vField: vConfigField, validateFields: validateConfiguration } = useFieldValidation()
const editTab = ref('script')

const route = useRoute()
const store = useFactoryStore()
const auth = useAuthStore()
const task = computed(() => store.db.tasks.find((item: VideoTask) => item.id === String(route.params.id)))
const selected = ref(0)
const stage = computed(() => task.value?.stages[selected.value])
const busy = ref('')
const dirty = ref(false)
const scriptDraft = ref('')
const characterDraft = ref<Character[]>([])
const shotDraft = ref<VideoShot[]>([])
const baseline = ref('')
const logsElement = ref<HTMLElement | null>(null)
const configOpen = ref(false)
const configuration = ref({
  modelId: '',
  workflowId: '',
  scenario: 'normal' as VideoTask['request']['scenario'],
})
const configurationModels = computed(() =>
  store.db.models.filter(
    (model) => model.enabled && model.capability === (task.value?.kind === 'article' ? 'LLM' : 'Video'),
  ),
)
function openConfiguration() {
  if (!task.value) return
  configuration.value = {
    modelId: task.value.modelId,
    workflowId: task.value.workflowId,
    scenario: task.value.request.scenario,
  }
  configOpen.value = true
}
async function reconfigure() {
  if (!task.value || blocked.value || dirty.value) return
  if (!validateConfiguration()) return
  busy.value = 'config'
  try {
    await store.reconfigureTask(task.value.id, { ...configuration.value })
    configOpen.value = false
    message.success('配置已更新并重新排队，人工编辑内容已保留')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '配置更新失败')
  } finally {
    busy.value = ''
  }
}
const fixedFields = [
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'identity', label: '身份' },
  { key: 'appearance', label: '外貌' },
] as const
const variableFields = [
  { key: 'outfit', label: '服装' },
  { key: 'expression', label: '表情' },
  { key: 'pose', label: '姿态' },
] as const
const shotFields = [
  { key: 'description', label: '画面描述' },
  { key: 'character', label: '出场角色' },
  { key: 'camera', label: '镜头语言' },
  { key: 'action', label: '角色动作' },
  { key: 'emotion', label: '情绪' },
  { key: 'sound', label: '声音' },
  { key: 'firstPrompt', label: '首帧 Prompt' },
  { key: 'lastPrompt', label: '尾帧 Prompt' },
  { key: 'bridge', label: '剧情桥 / 过渡' },
  { key: 'continuity', label: '连续性约束' },
] as const
function contentSignature(value: VideoTask) {
  return JSON.stringify([value.script, value.characters, value.shots])
}
function loadDraft() {
  if (!task.value) return
  scriptDraft.value = task.value.script
  characterDraft.value = task.value.characters.map((item: Character) => ({ ...item }))
  shotDraft.value = task.value.shots.map((item: VideoShot) => ({ ...item }))
  baseline.value = contentSignature(task.value)
  dirty.value = false
}
watch(
  () => task.value?.id,
  () => {
    selected.value = Math.max(0, Math.min(task.value?.stageIndex ?? 0, (task.value?.stages.length ?? 1) - 1))
    loadDraft()
  },
  { immediate: true },
)
watch(
  () => (task.value ? contentSignature(task.value) : ''),
  () => {
    if (!dirty.value && busy.value !== 'save') loadDraft()
  },
)
watch(
  () => [route.hash, task.value?.id],
  async () => {
    if (route.hash === '#logs' || route.hash === '#review-preview') {
      await nextTick()
      const target = route.hash === '#logs' ? logsElement.value : document.getElementById('review-preview')
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  },
  { immediate: true },
)

const editable = computed(
  () => !!task.value && ['REVIEWING', 'WAITING', 'FAILED'].includes(task.value.status),
)
const blocked = computed(() => !!busy.value || store.loading)
const conflict = computed(
  () => dirty.value && !!task.value && baseline.value !== contentSignature(task.value),
)
const oldScript = computed(() => (dirty.value ? task.value?.script || '' : task.value?.previousScript || ''))
// Line-aligned diff keeps the original text intact, including deleted trailing lines.
const diff = computed(() => {
  const before = oldScript.value.split('\n')
  const after = scriptDraft.value.split('\n')
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
    number: index + 1,
    before: before[index],
    after: after[index],
    changed: before[index] !== after[index],
  }))
})
const actions: { key: TaskAction; label: string; danger?: boolean }[] = [
  { key: 'pause', label: '暂停' },
  { key: 'resume', label: '继续' },
  { key: 'cancel', label: '取消任务', danger: true },
  { key: 'wait', label: '超时后继续等待' },
  { key: 'retry', label: '重试' },
  { key: 'skip', label: '跳过当前阶段' },
]
function reviewReason(action: 'approve' | 'reject') {
  if (!task.value) return '任务不存在。'
  return reviewActionReason(store.db, task.value, action, {
    permitted: auth.can('tasks.update'),
    available: isMockMode,
    busy: blocked.value,
    dirty: dirty.value,
  })
}
function allowed(action: TaskAction) {
  const value = task.value
  if (!value) return false
  if (!allowedActions(value).includes(action)) return false
  if (action === 'approve' || action === 'reject') return !reviewReason(action)
  return true
}
async function act(action: TaskAction) {
  if (blocked.value || dirty.value || !task.value || !allowed(action)) return
  const id = task.value.id
  busy.value = action
  try {
    await store.action(id, action)
    message.success(action === 'approve' ? '人工审核已通过，任务已完成；未向外部平台发布'
      : action === 'reject' ? '已驳回待返工，内容和记录已保留；修改后请重试' : '任务操作已完成')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请重试')
  } finally {
    busy.value = ''
  }
}
function shotStartError(shot: VideoShot, index: number) {
  return numberRange(
    shot.start,
    index ? shotDraft.value[index - 1]!.end : 0,
    task.value?.request.duration ?? 600,
  )
}
function shotEndError(shot: VideoShot) {
  return (
    numberRange(shot.end, 0, task.value?.request.duration ?? 600) ||
    (shot.end <= shot.start ? '结束时间必须晚于开始时间' : undefined)
  )
}
async function validateDraft() {
  if (!scriptDraft.value.trim()) editTab.value = 'script'
  else if (characterDraft.value.some((c) => !c.name.trim() || numberRange(c.age, 0, 10000, true)))
    editTab.value = 'characters'
  else if (
    shotDraft.value.some(
      (s, i) =>
        shotStartError(s, i) ||
        shotEndError(s) ||
        !s.firstPrompt.trim() ||
        !s.lastPrompt.trim() ||
        !s.bridge.trim(),
    )
  )
    editTab.value = 'shots'
  await nextTick()
  return validateFields()
}
async function save() {
  if (blocked.value || !editable.value || !dirty.value || !task.value) return
  if (!(await validateDraft())) return
  busy.value = 'save'
  try {
    if (conflict.value) throw new Error('任务内容已更新，请放弃本地修改并重新编辑，避免覆盖新内容')
    // Copy only at submission time so current logs, progress and status are preserved.
    const value: VideoTask = JSON.parse(JSON.stringify(task.value))
    if (value.script !== scriptDraft.value) value.previousScript = value.script
    value.script = scriptDraft.value
    value.characters = characterDraft.value.map((item) => ({ ...item }))
    value.shots = shotDraft.value.map((item) => ({ ...item }))
    value.updatedAt = new Date().toISOString()
    const id = value.id
    await store.saveTask(value)
    if (task.value?.id === id) loadDraft()
    message.success('脚本、角色与分镜已保存')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败，请重试')
  } finally {
    busy.value = ''
  }
}
async function exportPackage() {
  if (blocked.value || !task.value || dirty.value) return
  busy.value = 'export'
  let url: string | undefined
  let anchor: HTMLAnchorElement | undefined
  try {
    const value = task.value
    const content = {
      format: 'ai-factory-production-package',
      version: 1,
      mock: true,
      exportedAt: new Date().toISOString(),
      notice: 'Mock 制作包，仅含模拟数据、脚本、角色、分镜及运行记录。不包含真实视频或可播放媒体。',
      task: value,
      model: store.db.models.find((model) => model.id === value.modelId),
      workflow: store.db.workflows.find((workflow) => workflow.id === value.workflowId),
      assets: store.db.assets.filter((asset) => asset.taskId === value.id),
    }
    url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' }),
    )
    anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mock-production-${value.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
    document.body.appendChild(anchor)
    anchor.click()
    message.success('制作包已导出（JSON，不含真实视频）')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    anchor?.remove()
    if (url) {
      const objectUrl = url
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    }
    busy.value = ''
  }
}
function pretty(value: string | undefined) {
  if (!value) return '暂无'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
</script>

<template>
  <main class="page-stack detail">
    <PageHeader
      :title="task?.title || '任务详情'"
      eyebrow="PRODUCTION / INSPECT"
      description="可追踪的生产阶段、可编辑的创作内容、可介入的人工审核。"
    >
      <RouterLink to="/tasks"><a-button>返回任务中心</a-button></RouterLink>
      <a-button
        type="primary"
        :loading="busy === 'export'"
        :disabled="blocked || !task || dirty"
        @click="exportPackage"
        >导出制作包</a-button
      >
    </PageHeader>
    <a-alert
      v-if="store.error"
      type="error"
      show-icon
      :message="String(store.error)"
    />
    <a-alert
      v-if="isMockMode"
      type="info"
      show-icon
      message="Mock 演示，不是真实视频"
      description="当前展示的是模拟生产数据。导出为 JSON 制作包，包含脚本、角色、分镜、参数和日志，不提供真实视频播放或下载。"
    />
    <template v-if="task">
      <section
        class="panel overview"
        aria-labelledby="pipeline-heading"
        data-testid="production-pipeline"
      >
        <div class="section-head">
          <div>
            <h2 id="pipeline-heading">生产流水线</h2>
            <StatusBadge :status="task.status" />
            <p class="muted id">{{ task.id }}</p>
          </div>
          <strong class="percent"
            >{{ Math.max(0, Math.min(100, task.progress || 0)) }}<small>%</small></strong
          >
        </div>
        <a-progress
          :percent="Math.max(0, Math.min(100, task.progress || 0))"
          :show-info="false"
          stroke-color="#635bdb"
        />
        <div class="meta">
          <span>当前：{{ task.stages[task.stageIndex]?.name || '暂无阶段' }}</span
          ><span>耗时 {{ task.elapsed }}s / 预计 {{ task.estimated }}s</span
          ><span>重试 {{ task.retries }} 次</span><span>创建 {{ task.createdAt }}</span>
        </div>
        <a-alert
          v-if="task.error"
          type="warning"
          show-icon
          :message="task.error"
          :description="
            task.errorType === 'timeout'
              ? '可以继续等待一次，或重新执行、取消任务。所有恢复操作均保留日志。'
              : '请查看阶段错误与质量建议后再处理。'
          "
        />
        <nav
          class="stage-list"
          aria-label="生产阶段"
        >
          <div class="stage-rail">
            <button
              v-for="(item, index) in task.stages"
              :key="`${item.key}-${index}`"
              type="button"
              class="stage-button"
              :class="{ selected: selected === index }"
              :aria-pressed="selected === index"
              aria-controls="stage-inspector"
              @click="selected = index"
            >
              <span class="stage-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="stage-name">{{ item.name }}</span>
              <span
                class="stage-status"
                :class="item.status"
                >{{
                  { pending: '待执行', running: '进行中', success: '已完成', failed: '失败' }[item.status]
                }}</span
              >
            </button>
          </div>
          <p
            v-if="!task.stages.length"
            class="muted"
          >
            尚无阶段数据
          </p>
        </nav>
        <div
          class="task-actions"
          role="group"
          aria-labelledby="actions-heading"
        >
          <h3 id="actions-heading">任务操作</h3>
          <div class="actions">
            <a-button
              :disabled="blocked || dirty || !['WAITING', 'FAILED'].includes(task.status)"
              @click="openConfiguration"
              >更换模型 / 重新执行</a-button
            >
            <template
              v-for="item in actions"
              :key="item.key"
            >
              <a-popconfirm
                v-if="item.danger || item.key === 'skip'"
                :title="`确认${item.label}？`"
                :disabled="blocked || dirty || !allowed(item.key)"
                @confirm="act(item.key)"
              >
                <a-button
                  :danger="item.danger"
                  :loading="busy === item.key"
                  :disabled="blocked || dirty || !allowed(item.key)"
                  >{{ item.label }}</a-button
                >
              </a-popconfirm>
              <a-button
                v-else
                :loading="busy === item.key"
                :disabled="blocked || dirty || !allowed(item.key)"
                @click="act(item.key)"
                >{{ item.label }}</a-button
              >
            </template>
          </div>
          <p class="muted hint">
            操作随状态开放：暂停仅适用于排队/运行，继续仅适用于无异常的等待任务；已完成和已取消任务不可恢复。编辑后请先保存或放弃修改。
          </p>
          <p class="muted hint">
            仅允许跳过配音或字幕等可选阶段，质量门与最终人工审核不可跳过。超时任务可继续等待一次，避免无限运行。
          </p>
        </div>
      </section>

      <TaskReviewPreview
        :task="task"
        :dirty="dirty"
      />

      <section class="panel overview" aria-labelledby="manual-review-heading" data-testid="manual-review">
        <h2 id="manual-review-heading">最终人工审核</h2>
        <p>请先检查上方已保存内容。通过后进入 SUCCESS（已完成），不等于外部发布；驳回后进入 FAILED，可修改内容并重试。</p>
        <div class="actions">
          <a-button
            type="primary"
            :loading="busy === 'approve'"
            :disabled="!!reviewReason('approve')"
            aria-describedby="approve-reason"
            @click="act('approve')"
          >人工通过</a-button>
          <a-popconfirm
            title="确认驳回并保留内容待返工？"
            :disabled="!!reviewReason('reject')"
            @confirm="act('reject')"
          >
            <a-button
              danger
              :loading="busy === 'reject'"
              :disabled="!!reviewReason('reject')"
              aria-describedby="reject-reason"
            >驳回</a-button>
          </a-popconfirm>
        </div>
        <p id="approve-reason" role="status">{{ reviewReason('approve') || '可人工通过：审核材料与质量、安全检查已就绪。' }}</p>
        <p id="reject-reason" role="status">{{ reviewReason('reject') || '可驳回：保留已保存内容、日志及执行记录，等待人工返工。' }}</p>
      </section>

      <section
        id="stage-inspector"
        class="panel stage-content"
        aria-label="阶段执行详情"
      >
        <p class="eyebrow">阶段执行详情 · 输入 / 输出 / 参数</p>
        <template v-if="stage">
          <div class="section-head">
            <h2>{{ stage.name }}</h2>
            <span class="chip">{{ stage.key }}</span>
          </div>
          <dl class="stage-meta">
            <div>
              <dt>Model</dt>
              <dd>{{ stage.model || '未分配' }}</dd>
            </div>
            <div>
              <dt>工作流</dt>
              <dd>{{ stage.workflow || '未分配' }}</dd>
            </div>
            <div>
              <dt>Seed</dt>
              <dd>{{ stage.seed ?? '—' }}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{{ stage.duration }}s</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{{ stage.score ?? '暂无评分' }}</dd>
            </div>
          </dl>
          <a-alert
            v-if="stage.error"
            type="error"
            show-icon
            :message="stage.error"
          />
          <div class="io-grid">
            <div>
              <h3>Input / 输入</h3>
              <pre>{{ pretty(stage.input) }}</pre>
            </div>
            <div>
              <h3>Output / 输出</h3>
              <pre>{{ pretty(stage.output) }}</pre>
            </div>
          </div>
          <h3>Prompt / 提示词</h3>
          <pre>{{ stage.prompt || '暂无提示词' }}</pre>
        </template>
        <div
          v-else
          class="empty-state"
        >
          选择阶段以检查输入、输出与生成参数。
        </div>
      </section>

      <section
        v-if="task.kind === 'video'"
        class="panel editor"
      >
        <div class="section-head editor-head">
          <div>
            <h2>创作内容工作台</h2>
            <p class="muted">固定角色特征保持身份一致，可变特征控制镜头表现。</p>
          </div>
          <div class="actions">
            <a-popconfirm
              title="放弃尚未保存的修改并载入最新内容？"
              :disabled="blocked || !dirty"
              @confirm="loadDraft"
              ><a-button :disabled="blocked || !dirty">放弃修改</a-button></a-popconfirm
            >
            <a-button
              type="primary"
              :loading="busy === 'save'"
              :disabled="blocked || !editable || !dirty || conflict"
              @click="save"
              >保存创作内容</a-button
            >
          </div>
        </div>
        <a-alert
          v-if="!editable"
          type="info"
          message="当前内容只读；暂停任务或进入待审核、异常状态后可编辑。"
        />
        <a-alert
          v-if="conflict"
          type="warning"
          show-icon
          message="远端创作内容已更新，保存已禁用。请复制需要保留的修改，再放弃本地修改并重新编辑。"
        />
        <a-tabs v-model:active-key="editTab">
          <a-tab-pane
            key="script"
            tab="脚本与 Diff"
          >
            <label
              class="field"
              for="script-editor"
              >当前脚本
              <span
                v-if="dirty"
                class="unsaved"
                >· 有未保存修改</span
              ></label
            >
            <div v-field="required(scriptDraft, '脚本')">
              <a-textarea
                id="script-editor"
                v-model:value="scriptDraft"
                :rows="12"
                :disabled="!editable || blocked"
                @change="dirty = true"
              />
            </div>
            <h3>{{ dirty ? '已保存版本 → 当前编辑' : '上次版本 → 当前版本' }} · 逐行对比</h3>
            <div class="diff-labels"><strong>修改前</strong><strong>修改后</strong></div>
            <div class="diff-table">
              <div
                v-for="line in diff"
                :key="line.number"
                class="diff-row"
              >
                <pre
                  :class="{ removed: line.changed && line.before !== undefined }"
                ><span class="line-number">{{ line.number }}</span>{{ line.changed && line.before !== undefined ? '− ' : '  ' }}{{ line.before ?? '' }}</pre>
                <pre
                  :class="{ added: line.changed && line.after !== undefined }"
                ><span class="line-number">{{ line.number }}</span>{{ line.changed && line.after !== undefined ? '+ ' : '  ' }}{{ line.after ?? '' }}</pre>
              </div>
            </div>
          </a-tab-pane>
          <a-tab-pane
            key="characters"
            tab="角色设定"
          >
            <div
              v-if="!characterDraft.length"
              class="empty-state"
            >
              角色阶段尚未产出内容。
            </div>
            <article
              v-for="(character, index) in characterDraft"
              :key="character.id"
              class="edit-card"
            >
              <h3>角色 {{ index + 1 }} · {{ character.name }}</h3>
              <a-form layout="vertical">
                <h4>固定特征 · 身份一致性</h4>
                <div class="form-grid">
                  <a-form-item
                    v-for="field in fixedFields"
                    v-field="field.key === 'name' ? required(character.name, '角色姓名') : undefined"
                    :key="field.key"
                    :label="field.label"
                    ><a-textarea
                      v-model:value="character[field.key]"
                      :auto-size="{ minRows: 1, maxRows: 5 }"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item>
                  <a-form-item
                    v-field="numberRange(character.age, 0, 10000, true)"
                    label="年龄"
                    ><a-input-number
                      v-model:value="character.age"
                      :min="0"
                      :max="10000"
                      :precision="0"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item>
                </div>
                <h4>变化特征 · 场景表现</h4>
                <div class="form-grid">
                  <a-form-item
                    v-for="field in variableFields"
                    :key="field.key"
                    :label="field.label"
                    ><a-textarea
                      v-model:value="character[field.key]"
                      :rows="2"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item>
                </div>
              </a-form>
            </article>
          </a-tab-pane>
          <a-tab-pane
            key="shots"
            tab="分镜与剧情桥"
          >
            <div
              v-if="!shotDraft.length"
              class="empty-state"
            >
              分镜阶段尚未产出内容。
            </div>
            <article
              v-for="(shot, index) in shotDraft"
              :key="shot.id"
              class="edit-card"
            >
              <h3>
                分镜 {{ String(index + 1).padStart(2, '0') }}
                <small class="muted">{{ shot.start }}–{{ shot.end }}s</small>
              </h3>
              <a-form layout="vertical"
                ><div class="form-grid">
                  <a-form-item
                    v-field="shotStartError(shot, index)"
                    label="开始时间（秒）"
                    ><a-input-number
                      v-model:value="shot.start"
                      :min="0"
                      :max="task.request.duration"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item>
                  <a-form-item
                    v-field="shotEndError(shot)"
                    label="结束时间（秒）"
                    ><a-input-number
                      v-model:value="shot.end"
                      :min="0"
                      :max="task.request.duration"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item>
                  <a-form-item
                    v-for="field in shotFields"
                    v-field="
                      ['firstPrompt', 'lastPrompt', 'bridge'].includes(field.key)
                        ? required(shot[field.key], field.label)
                        : undefined
                    "
                    :key="field.key"
                    :label="field.label"
                    ><a-textarea
                      v-model:value="shot[field.key]"
                      :rows="3"
                      :disabled="!editable || blocked"
                      @change="dirty = true"
                  /></a-form-item></div
              ></a-form>
            </article>
          </a-tab-pane>
        </a-tabs>
      </section>

      <section class="panel quality">
        <div class="section-head">
          <h2>Quality Gate · 质量检查与改进建议</h2>
          <span
            v-if="task.quality"
            class="quality-score"
            >{{ task.quality.score }} <small>/ 阈值 {{ task.quality.threshold }}</small></span
          >
        </div>
        <template v-if="task.quality">
          <a-alert
            :type="task.quality.passed ? 'success' : 'warning'"
            show-icon
            :message="task.quality.passed ? '自动质量检查通过' : '质量未达标，请调整内容或进行人工决策'"
          />
          <div class="criteria">
            <article
              v-for="(criterion, index) in task.quality.criteria"
              :key="index"
            >
              <div class="section-head">
                <strong>{{ criterion.name }}</strong
                ><span :class="criterion.passed ? 'pass' : 'fail'"
                  >{{ criterion.score }} 分 · {{ criterion.passed ? '通过' : '未通过' }}</span
                >
              </div>
              <p>{{ criterion.reason }}</p>
            </article>
          </div>
          <h3>建议</h3>
          <ul v-if="task.quality.suggestions.length">
            <li
              v-for="(suggestion, index) in task.quality.suggestions"
              :key="index"
            >
              {{ suggestion }}
            </li>
          </ul>
          <p
            v-else
            class="muted"
          >
            暂无额外改进建议。
          </p>
          <p class="muted">
            人工审核：{{
              task.approved ? '已通过' : '尚未通过'
            }}。人工通过和驳回位于审核内容预览下方；重试与跳过位于任务操作区。
          </p>
        </template>
        <p
          v-else
          class="muted"
        >
          质量评估尚未生成，阶段完成后会展示评分细则与建议。
        </p>
      </section>
      <ProductionTracePanel :task-id="task.id" />
      <section
        id="logs"
        ref="logsElement"
        class="panel logs"
      >
        <div class="section-head">
          <h2>运行日志</h2>
          <span class="muted">{{ task.logs.length }} 条</span>
        </div>
        <div
          v-if="!task.logs.length"
          class="empty-state"
        >
          暂无日志
        </div>
        <ol v-else>
          <li
            v-for="log in task.logs"
            :key="log.id"
          >
            <time>{{ log.time }}</time
            ><span
              class="log-level"
              :class="log.level"
              >{{ log.level.toUpperCase() }}</span
            >
            <p>{{ log.message }}</p>
          </li>
        </ol>
      </section>
    </template>
    <a-drawer
      v-model:open="configOpen"
      title="更换模型与重新执行"
      width="min(420px, 100vw)"
    >
      <a-alert
        type="info"
        show-icon
        message="当前为本地模拟。重新配置不会连接真实模型，也不会覆盖人工编辑的创作内容。"
      />
      <div class="config-fields">
        <label
          v-config-field="
            configurationModels.some((m) => m.id === configuration.modelId)
              ? undefined
              : '请选择已启用的生成模型'
          "
          class="field"
          >生成模型<a-select
            v-model:value="configuration.modelId"
            :options="configurationModels.map((model) => ({ value: model.id, label: model.name }))"
        /></label>
        <label
          v-config-field="
            store.db.workflows.some(
              (w) =>
                w.id === configuration.workflowId &&
                w.active &&
                w.provider === configurationModels.find((m) => m.id === configuration.modelId)?.provider,
            )
              ? undefined
              : '请选择已启用且提供方匹配的工作流'
          "
          class="field"
          >工作流<a-select
            v-model:value="configuration.workflowId"
            :options="
              store.db.workflows
                .filter((workflow) => workflow.active)
                .map((workflow) => ({ value: workflow.id, label: `${workflow.name} · ${workflow.type}` }))
            "
        /></label>
        <label class="field"
          >模拟服务场景<a-select
            v-model:value="configuration.scenario"
            :options="[
              { value: 'normal', label: '服务正常（模拟故障已恢复）' },
              { value: 'quality', label: '质量不达标' },
              { value: 'system', label: '系统错误' },
              { value: 'timeout', label: '生成超时' },
            ]"
        /></label>
        <a-button
          type="primary"
          :loading="busy === 'config'"
          :disabled="dirty"
          @click="reconfigure"
          >保存并重新执行</a-button
        >
      </div>
    </a-drawer>
    <div
      v-if="!task"
      class="panel empty-state"
    >
      <a-spin v-if="store.loading" />
      <h2>{{ store.loading ? '正在加载任务…' : '未找到该任务' }}</h2>
      <p class="muted">请检查任务 ID，或返回任务中心选择任务。</p>
      <RouterLink to="/tasks">返回任务中心</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.detail {
  min-width: 0;
  overflow-wrap: anywhere;
}
.overview,
.stage-content,
.editor,
.quality,
.logs {
  padding: 24px;
  min-width: 0;
}
.detail h2 {
  font-size: 18px;
  margin: 0 0 14px;
}
.detail h3 {
  font-size: 15px;
  margin: 20px 0 12px;
}
.detail h4 {
  color: #635bdb;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.id {
  font-size: 12px;
}
.percent {
  font-size: 36px;
  color: #635bdb;
}
.percent small {
  font-size: 17px;
}
.meta {
  display: flex;
  gap: 12px 24px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #777488;
  margin: 12px 0 20px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.hint {
  font-size: 12px;
  line-height: 1.8;
  margin-bottom: 0;
}
.task-actions {
  border-top: 1px solid #e5e2f0;
  margin-top: 20px;
  padding-top: 4px;
}
.overview {
  border: 1px solid #ddd8f0;
  border-radius: 16px;
  background: #fff;
}
.stage-list {
  min-width: 0;
}
.stage-button {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  padding: 14px 10px;
  margin-top: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: #5e5c70;
}
.stage-button.selected {
  background: #f0edff;
  border-color: #e0dbfb;
  color: #635bdb;
}
.stage-button:focus-visible {
  outline: 2px solid #635bdb;
}
.stage-index {
  font-size: 12px;
  color: #9691ab;
}
.stage-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.stage-status {
  font-size: 11px;
  white-space: nowrap;
}
.stage-status.success,
.pass {
  color: #28836a;
}
.stage-status.failed,
.fail {
  color: #bd414d;
}
.stage-status.running {
  color: #635bdb;
}
.stage-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  background: #f8f7fb;
  border-radius: 10px;
  padding: 16px;
}
.stage-meta dt {
  font-size: 11px;
  color: #888398;
}
.stage-meta dd {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.io-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.io-grid > div {
  min-width: 0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  background: #f7f7fb;
  padding: 16px;
  border-radius: 8px;
  font:
    12px/1.8 ui-monospace,
    SFMono-Regular,
    monospace;
  max-height: 380px;
  overflow: auto;
}
.editor-head {
  margin-bottom: 16px;
}
.editor-head p {
  margin-bottom: 0;
  font-size: 13px;
}
.field {
  display: block;
  margin: 12px 0;
}
.unsaved {
  color: #ad681b;
}
.diff-labels,
.diff-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.diff-labels {
  gap: 10px;
  margin-top: 18px;
  font-size: 12px;
  color: #777488;
}
.diff-table {
  border: 1px solid #eeedf5;
  border-radius: 8px;
  margin-top: 10px;
  max-height: 420px;
  overflow: auto;
}
.diff-row pre {
  margin: 0;
  padding: 7px 10px;
  border-radius: 0;
  max-height: none;
  border-right: 1px solid #eeedf5;
}
.diff-row .removed {
  background: #fff0f1;
  color: #a13e49;
}
.diff-row .added {
  background: #edf8f2;
  color: #2b7958;
}
.line-number {
  display: inline-block;
  min-width: 25px;
  color: #9691ab;
  user-select: none;
}
.edit-card {
  border: 1px solid #eeedf5;
  border-radius: 12px;
  padding: 20px;
  margin: 16px 0;
}
.edit-card h3 {
  margin-top: 0;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 18px;
}
.form-grid > * {
  min-width: 0;
}
.quality-score {
  font-size: 27px;
  color: #635bdb;
  font-weight: 700;
}
.quality-score small {
  font-size: 12px;
  color: #8b869e;
}
.criteria {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 18px;
}
.criteria article {
  padding: 16px;
  background: #f8f7fb;
  border-radius: 10px;
}
.criteria p {
  font-size: 13px;
  color: #787386;
  line-height: 1.8;
  margin-bottom: 0;
}
.quality li {
  margin: 10px 0;
  line-height: 1.7;
}
.logs {
  scroll-margin-top: 24px;
}
.logs ol {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 480px;
  overflow: auto;
}
.logs li {
  display: grid;
  grid-template-columns: 175px 60px minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid #eeedf5;
  padding: 14px 0;
  font-size: 12px;
}
.logs time {
  color: #89849b;
}
.logs p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.log-level {
  font-size: 11px;
  color: #635bdb;
}
.log-level.error {
  color: #bd414d;
}
.log-level.warn {
  color: #ad681b;
}
.empty-state {
  padding: 40px;
  text-align: center;
}
.detail :deep(.ant-tabs-content-holder) {
  min-width: 0;
}
.detail :deep(.ant-input-number) {
  width: 100%;
}
@media (max-width: 1000px) {
  .io-grid {
    grid-template-columns: 1fr;
  }
  .stage-meta {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 700px) {
  .stage-button {
    font-size: 12px;
    padding: 10px 6px;
    gap: 5px;
  }
  .overview,
  .stage-content,
  .editor,
  .quality,
  .logs {
    padding: 16px;
  }
  .form-grid,
  .criteria {
    grid-template-columns: 1fr;
  }
  .edit-card {
    padding: 14px;
  }
  .logs li {
    grid-template-columns: minmax(0, 1fr) 60px;
    gap: 8px;
  }
  .logs li p {
    grid-column: 1/-1;
  }
  .diff-row pre {
    padding: 6px;
    font-size: 11px;
  }
  .line-number {
    min-width: 18px;
  }
  .editor-head .actions {
    width: 100%;
  }
}
</style>
<style scoped>
.stage-rail {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 8px;
}
.stage-rail .stage-button {
  margin: 0;
  background: #f8f7fb;
  border-color: #eeedf5;
}
.stage-rail .stage-button.selected {
  background: #f0edff;
  border-color: #9389dc;
}
.config-fields {
  display: grid;
  gap: 20px;
  margin-top: 22px;
}
.config-fields .field {
  display: grid;
  gap: 8px;
}
@media (max-width: 700px) {
  .stage-rail {
    grid-template-columns: 1fr;
  }
}
</style>
