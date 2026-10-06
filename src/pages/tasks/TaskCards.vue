<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { useFactoryStore } from '../../stores/factory'
import StatusBadge from '../../components/StatusBadge.vue'
import TaskReviewPreview from '../../components/TaskReviewPreview.vue'
import { TASK_STATUS_LABELS } from '../../types'
import type { TaskAction, TaskStatus, VideoTask } from '../../types'
import { allowedActions, reviewActionReason } from '../../services/pipeline'
import { useAuthStore } from '../../stores/auth'
import { isMockMode } from '../../api/mode'

const props = defineProps<{ videoOnly?: boolean }>()
const route = useRoute()
const store = useFactoryStore()
const auth = useAuthStore()
const search = ref('')
const status = ref<TaskStatus | ''>((route.query.status as TaskStatus | undefined) ?? '')
const kind = ref((route.query.kind as string | undefined) ?? '')
const todayOnly = computed(() => route.query.date === 'today')
const pending = ref<Record<string, boolean>>({})
const previewId = ref('')
const previewMode = ref<'core' | 'delivery' | 'review'>('core')
const previewTask = computed(() => store.db.tasks.find(task => task.id === previewId.value))
const previewOpen = computed({
  get: () => !!previewTask.value,
  set: (open: boolean) => {
    if (!open) previewId.value = ''
  },
})
const statuses: { value: TaskStatus; label: string }[] = Object.entries(TASK_STATUS_LABELS).map(
  ([value, label]) => ({ value: value as TaskStatus, label }),
)
const tasks = computed(() =>
  store.db.tasks
    .filter(
      (task: VideoTask) =>
        (!props.videoOnly || task.kind === 'video') &&
        (!kind.value || task.kind === kind.value) &&
        (!status.value || task.status === status.value) &&
        (!todayOnly.value || new Date(task.createdAt).toDateString() === new Date().toDateString()) &&
        `${task.title} ${task.id}`.toLowerCase().includes(search.value.trim().toLowerCase()),
    )
    .slice()
    .sort((a: VideoTask, b: VideoTask) => b.createdAt.localeCompare(a.createdAt)),
)
const base = computed(() =>
  store.db.tasks.filter((task: VideoTask) => !props.videoOnly || task.kind === 'video'),
)
const activeCount = computed(
  () => base.value.filter((task: VideoTask) => ['QUEUED', 'RUNNING'].includes(task.status)).length,
)
const reviewCount = computed(
  () =>
    base.value.filter((task: VideoTask) => ['REVIEWING', 'WAITING', 'FAILED'].includes(task.status)).length,
)
function canPause(task: VideoTask) {
  return allowedActions(task).includes('pause')
}
function canResume(task: VideoTask) {
  return allowedActions(task).includes('resume')
}
function canWait(task: VideoTask) {
  return allowedActions(task).includes('wait')
}
async function act(task: VideoTask, action: TaskAction) {
  if (pending.value[task.id] || store.loading || !allowedActions(task).includes(action)) return
  pending.value[task.id] = true
  try {
    await store.action(task.id, action)
    message.success(action === 'approve' ? '审核通过，可下载交付；未向外部平台发布'
      : action === 'reject' ? '已驳回，内容与记录已保留'
      : action === 'pause' ? '任务已暂停' : action === 'resume' ? '任务已继续' : '已继续等待一次')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请重试')
  } finally {
    pending.value[task.id] = false
  }
}
function openPreview(task: VideoTask) {
  previewId.value = task.id
  previewMode.value = 'core'
}
function openDelivery(task: VideoTask) {
  previewId.value = task.id
  previewMode.value = 'delivery'
}
function canReview(task: VideoTask) {
  return task.status === 'REVIEWING' && !reviewActionReason(store.db, task, 'approve', {
    permitted: auth.can('tasks.update'),
    available: isMockMode,
    busy: store.loading || !!pending.value[task.id],
  })
}
function openReview(task: VideoTask) {
  previewId.value = task.id
  previewMode.value = 'review'
}
function reviewReason(action: 'approve' | 'reject') {
  if (!previewTask.value) return '任务不存在。'
  return reviewActionReason(store.db, previewTask.value, action, {
    permitted: auth.can('tasks.update'),
    available: isMockMode,
    busy: store.loading || !!pending.value[previewTask.value.id],
  })
}
async function review(action: 'approve' | 'reject') {
  const task = previewTask.value
  if (!task || reviewReason(action)) return
  await act(task, action)
}
function progress(task: VideoTask) {
  return Math.max(0, Math.min(100, Number(task.progress) || 0))
}
</script>

<template>
  <div class="page-stack">
    <div class="metrics">
      <div class="panel metric">
        <span class="muted">全部任务</span><strong>{{ base.length }}</strong>
      </div>
      <div class="panel metric">
        <span class="muted">正在生产</span><strong>{{ activeCount }}</strong>
      </div>
      <div class="panel metric">
        <span class="muted">需要关注</span><strong>{{ reviewCount }}</strong>
      </div>
    </div>
    <a-alert
      v-if="store.error"
      type="error"
      show-icon
      :message="String(store.error)"
    />
    <section
      class="panel filters"
      aria-label="任务筛选"
    >
      <a-input
        v-model:value="search"
        allow-clear
        placeholder="搜索任务名称或 ID"
        aria-label="搜索任务"
      />
      <a-select
        v-model:value="status"
        aria-label="任务状态"
        :options="[{ value: '', label: '全部状态' }, ...statuses]"
      />
      <a-select
        v-if="!videoOnly"
        v-model:value="kind"
        aria-label="任务类型"
        :options="[
          { value: '', label: '全部类型' },
          { value: 'video', label: '视频任务' },
          { value: 'article', label: '文章任务' },
        ]"
      />
      <span class="muted count">{{ tasks.length }} 个结果</span>
    </section>
    <a-spin :spinning="store.loading">
      <div
        v-if="tasks.length"
        class="task-table-wrap"
      >
        <table class="task-table">
          <thead>
            <tr>
              <th>任务</th>
              <th class="type-column">类型</th>
              <th>状态</th>
              <th>进度</th>
              <th>更新时间</th>
              <th class="actions-column">快捷操作</th>
            </tr>
          </thead>
          <tbody>
        <tr
          v-for="task in tasks"
          :key="task.id"
          class="task-row"
        >
          <td>
            <RouterLink class="task-title" :to="`/tasks/${task.id}`">{{ task.title || '未命名任务' }}</RouterLink>
            <span class="identifier">{{ task.id }}</span>
            <span v-if="task.error" class="error">{{ task.error }}</span>
          </td>
          <td class="type-column"><span class="chip task-kind-chip">{{ task.kind === 'video' ? '视频' : '图文' }}</span></td>
          <td><StatusBadge :status="task.status" /></td>
          <td class="progress-cell">
            <span>{{ task.stages[task.stageIndex]?.name || (task.status === 'SUCCESS' ? '制作完成' : '等待处理') }}</span>
            <a-progress :percent="progress(task)" :show-info="false" stroke-color="#635bdb"
              :status="task.status === 'FAILED' ? 'exception' : undefined" />
          </td>
          <td class="muted">{{ task.updatedAt }}</td>
          <td class="row-actions">
            <a-button type="text" v-if="task.status === 'REVIEWING' || task.status === 'SUCCESS'"
              @click="openPreview(task)">预览</a-button>
            <a-button type="text" v-if="task.status === 'SUCCESS'" @click="openDelivery(task)">下载</a-button>
            <a-button type="text" v-if="task.status === 'REVIEWING'"
              :disabled="!canReview(task)" @click="openReview(task)">人工审批</a-button>
            <RouterLink class="action-button" :to="`/tasks/${task.id}`">查看详情</RouterLink>
            <RouterLink class="action-button" :to="`/tasks/${task.id}#logs`">日志</RouterLink>
            <a-button
              type="text"
              v-if="canPause(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'pause')"
              >暂停</a-button
            >
            <a-button
              type="text"
              v-else-if="canResume(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'resume')"
              >继续</a-button
            >
            <a-button
              type="text"
              v-else-if="canWait(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'wait')"
              >继续等待</a-button
            >
          </td>
        </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else
        class="panel empty-state"
      >
        没有匹配的任务，请调整筛选条件或创建新任务。
      </div>
    </a-spin>
    <a-modal
      v-model:open="previewOpen"
      :title="previewMode === 'review' ? '人工审批' : previewMode === 'delivery' ? '下载交付' : '核心内容预览'"
      width="min(1100px, 96vw)"
      :wrap-class-name="`task-preview-modal ${previewOpen ? 'is-open' : ''} ${previewTask?.kind === 'article' ? 'article-preview-modal' : 'video-preview-modal'} ${previewMode}-modal`"
      :footer="null"
      destroy-on-close
    >
      <template v-if="previewTask">
        <TaskReviewPreview
          :task="previewTask"
          :display-mode="previewMode === 'review'
            ? (previewTask.status === 'SUCCESS' ? 'delivery' : 'core')
            : previewMode"
        />
        <section v-if="previewMode === 'review' && previewTask.status === 'REVIEWING'" class="list-review-actions" data-testid="list-review-actions">
          <h3>快捷审核</h3>
          <p id="list-approve-reason">{{ reviewReason('approve') || '审核材料已就绪，可直接通过。' }}</p>
          <p id="list-reject-reason">{{ reviewReason('reject') || '可驳回并保留内容，返回任务后继续返工。' }}</p>
          <div class="row-actions">
            <a-button type="primary" :disabled="!!reviewReason('approve')" @click="review('approve')">人工通过</a-button>
            <a-popconfirm title="确认驳回并保留内容待返工？" :disabled="!!reviewReason('reject')" @confirm="review('reject')">
              <a-button danger :disabled="!!reviewReason('reject')">驳回</a-button>
            </a-popconfirm>
            <RouterLink :to="`/tasks/${previewTask.id}`">进入详情处理</RouterLink>
          </div>
        </section>
      </template>
    </a-modal>
  </div>
</template>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.metric {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.metric strong {
  font-size: 30px;
  color: #635bdb;
}
.filters {
  display: flex;
  gap: 12px;
  padding: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.filters :deep(.ant-input-affix-wrapper) {
  flex: 1;
  min-width: 180px;
}
.filters :deep(.ant-select) {
  min-width: 150px;
}
.count {
  white-space: nowrap;
}
.task-table-wrap {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid #e4e1ef;
  border-radius: 14px;
  background: #fff;
}
.task-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  text-align: left;
}
.task-table th {
  padding: 14px 16px;
  color: #777488;
  background: #faf9fd;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.task-table td {
  padding: 16px;
  border-top: 1px solid #eeedf5;
  vertical-align: middle;
}
.type-column {
  width: 92px;
  min-width: 92px;
  white-space: nowrap;
}
.task-kind-chip {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.task-row:hover {
  background: #fcfbff;
}
.task-title {
  display: block;
  color: #252438;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.task-title:hover {
  color: #635bdb;
}
.identifier {
  display: block;
  margin-top: 5px;
  color: #9691ab;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.progress-cell {
  min-width: 170px;
}
.progress-cell > span {
  display: block;
  margin-bottom: 7px;
  color: #5e5c70;
  font-size: 12px;
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.row-actions a {
  color: inherit;
}
.row-actions .action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #635bdb;
  font-size: 14px;
  line-height: 1.5;
  white-space: nowrap;
  text-decoration: none;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.row-actions .action-button:hover {
  background: #f7f5ff;
  color: #635bdb;
}
.row-actions :deep(.ant-btn-text) {
  min-height: 32px;
  padding: 4px 8px;
  border-radius: 6px;
  color: #635bdb;
}
.row-actions :deep(.ant-btn-text:hover),
.row-actions :deep(.ant-btn-text:focus) {
  background: #f7f5ff;
  color: #5148c7;
}
.row-actions :deep(.ant-btn-text[disabled]),
.row-actions :deep(.ant-btn-text:disabled) {
  background: transparent;
  color: #aaa6b8;
}
.actions-column {
  min-width: 310px;
}
.error {
  display: block;
  margin-top: 6px;
  color: #c44550;
  overflow-wrap: anywhere;
}
.list-review-actions {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid #ddd8f0;
  border-radius: 12px;
  background: #faf9ff;
}
.list-review-actions h3 {
  margin-top: 0;
}
.list-review-actions p {
  margin: 6px 0;
  color: #676879;
  font-size: 13px;
}
.empty-state {
  padding: 48px;
  text-align: center;
}
:global(.task-preview-modal .ant-modal-content) {
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.task-preview-modal.ant-modal-wrap) {
  overflow: hidden;
}
:global(body:has(.task-preview-modal.is-open)) {
  overflow: hidden;
}
:global(html:has(.task-preview-modal.is-open)) {
  overflow: hidden;
}
:global(.task-preview-modal .ant-modal-body) {
  min-height: 0;
  padding: 0 24px 24px;
}
:global(.video-preview-modal .ant-modal) {
  top: 24px;
  margin: 0 auto;
  max-height: calc(100vh - 48px);
}
:global(.video-preview-modal) {
  overflow: hidden;
}
:global(.video-preview-modal .ant-modal-body) {
  max-height: calc(100vh - 132px);
}
:global(.video-preview-modal .ant-modal-body) {
  overflow: hidden;
}
:global(.video-preview-modal .review-preview) {
  padding-top: 8px;
}
:global(.video-preview-modal .video-review-hero) {
  margin-top: 8px;
  margin-bottom: 12px;
}
:global(.video-preview-modal .mock-video-frame) {
  max-height: calc(100vh - 320px);
}
:global(.video-preview-modal .review-preview video) {
  max-height: calc(100dvh - 460px) !important;
  object-fit: contain;
}
:global(.video-preview-modal .review-preview.display-core) {
  padding: 8px 12px;
}
:global(.video-preview-modal .review-preview.display-core h2) {
  margin: 0 0 6px;
  font-size: 18px;
}
:global(.video-preview-modal .review-preview.display-core > .notice) {
  display: none;
}
:global(.video-preview-modal .review-preview.display-core .video-review-hero) {
  padding: 8px;
  margin: 0;
}
:global(.video-preview-modal .review-preview.display-core h3) {
  margin: 0;
  font-size: 16px;
}
:global(.video-preview-modal .review-preview.display-core .notice) {
  margin: 4px 0;
  font-size: 12px;
}
:global(.video-preview-modal .review-preview.display-core .delivery-heading) {
  display: none;
}
:global(.video-preview-modal .review-preview.display-core .delivery-actions) {
  margin-top: 0;
}
:global(.video-preview-modal .list-review-actions) {
  margin-top: 8px;
  padding: 8px;
}
:global(.article-preview-modal .ant-modal-body) {
  max-height: calc(100vh - 150px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
:global(.article-preview-modal .ant-modal) {
  top: 24px;
  margin: 0 auto;
}
:global(.delivery-modal .ant-modal-body) {
  overflow-y: auto;
}
:global(.core-modal .delivery-panel) {
  margin-top: 12px;
  padding: 14px 16px;
  border-width: 1px;
}
:global(.core-modal .delivery-heading h3) {
  font-size: 16px;
}
:global(.core-modal .delivery-heading .saved-note),
:global(.core-modal .delivery-panel > .saved-note),
:global(.core-modal .delivery-panel > .notice) {
  display: none;
}
@media (max-width: 600px) {
  .metrics {
    gap: 8px;
  }
  .metric {
    padding: 14px 10px;
  }
  .metric strong {
    font-size: 24px;
  }
  .filters > * {
    width: 100%;
  }
  .task-table {
    min-width: 760px;
  }
  .task-table th,
  .task-table td {
    padding: 12px;
  }
  :global(.task-preview-modal .ant-modal-content) {
    max-height: calc(100vh - 20px);
  }
  :global(.article-preview-modal .ant-modal-body) {
    max-height: calc(100vh - 120px);
  }
}
</style>
