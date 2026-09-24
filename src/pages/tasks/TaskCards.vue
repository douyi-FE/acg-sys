<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { useFactoryStore } from '../../stores/factory'
import StatusBadge from '../../components/StatusBadge.vue'
import { TASK_STATUS_LABELS } from '../../types'
import type { TaskAction, TaskStatus, VideoTask } from '../../types'
import { allowedActions } from '../../services/pipeline'
import { PlayCircleOutlined, FileTextOutlined } from '@ant-design/icons-vue'

const props = defineProps<{ videoOnly?: boolean }>()
const route = useRoute()
const store = useFactoryStore()
const search = ref('')
const status = ref<TaskStatus | ''>((route.query.status as TaskStatus | undefined) ?? '')
const kind = ref((route.query.kind as string | undefined) ?? '')
const todayOnly = computed(() => route.query.date === 'today')
const pending = ref<Record<string, boolean>>({})
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
    message.success(action === 'pause' ? '任务已暂停' : action === 'resume' ? '任务已继续' : '已继续等待一次')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请重试')
  } finally {
    pending.value[task.id] = false
  }
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
        class="cards"
      >
        <article
          v-for="task in tasks"
          :key="task.id"
          class="panel task-card"
        >
          <RouterLink
            class="task-cover"
            :class="task.kind"
            :to="`/tasks/${task.id}`"
            :aria-label="`查看${task.title}`"
          >
            <img
              v-if="task.cover"
              :src="task.cover"
              :alt="task.title"
            />
            <template v-else
              ><PlayCircleOutlined v-if="task.kind === 'video'" /><FileTextOutlined v-else /><span>{{
                task.kind === 'video' ? 'STORY IN PROGRESS' : 'WORDS INTO STORIES'
              }}</span></template
            >
            <small
              >MOCK ·
              {{
                task.kind === 'video' ? `${task.request.ratio} / ${task.request.duration}s` : '文本制作稿'
              }}</small
            >
          </RouterLink>
          <div class="card-top">
            <span class="chip">{{ task.kind === 'video' ? 'VIDEO / 视频' : 'ARTICLE / 文章' }}</span
            ><StatusBadge :status="task.status" />
          </div>
          <RouterLink
            class="task-title"
            :to="`/tasks/${task.id}`"
            >{{ task.title || '未命名任务' }}</RouterLink
          >
          <p class="muted identifier">{{ task.id }}</p>
          <div class="stage">
            <span>{{
              task.stages[task.stageIndex]?.name || (task.status === 'SUCCESS' ? '制作完成' : '等待处理')
            }}</span
            ><strong>{{ progress(task) }}%</strong>
          </div>
          <a-progress
            :percent="progress(task)"
            :show-info="false"
            stroke-color="#635bdb"
            :status="task.status === 'FAILED' ? 'exception' : undefined"
          />
          <p
            v-if="task.error"
            class="error"
          >
            {{ task.error }}
          </p>
          <p class="muted">耗时 {{ task.elapsed }}s · 预计 {{ task.estimated }}s</p>
          <div class="card-bottom">
            <RouterLink :to="`/tasks/${task.id}`">查看详情</RouterLink>
            <RouterLink :to="`/tasks/${task.id}#logs`">运行日志</RouterLink>
            <RouterLink v-if="task.status === 'REVIEWING'" :to="`/tasks/${task.id}#review-preview`">预览并审核</RouterLink>
            <a-button
              v-if="canPause(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'pause')"
              >暂停</a-button
            >
            <a-button
              v-else-if="canResume(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'resume')"
              >继续</a-button
            >
            <a-button
              v-else-if="canWait(task)"
              :loading="pending[task.id]"
              :disabled="store.loading"
              @click="act(task, 'wait')"
              >继续等待</a-button
            >
          </div>
        </article>
      </div>
      <div
        v-else
        class="panel empty-state"
      >
        没有匹配的任务，请调整筛选条件或创建新任务。
      </div>
    </a-spin>
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
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr));
  gap: 18px;
}
.task-card {
  padding: 22px;
  min-width: 0;
  overflow: hidden;
}
.card-top,
.stage,
.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.task-title {
  display: block;
  font-size: 19px;
  font-weight: 650;
  margin-top: 22px;
  color: #252438;
  overflow-wrap: anywhere;
}
.identifier {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.stage {
  margin-top: 24px;
}
.card-bottom {
  border-top: 1px solid #eeedf5;
  padding-top: 16px;
  margin-top: 18px;
}
.card-bottom a {
  color: #635bdb;
}
.error {
  color: #c44550;
  overflow-wrap: anywhere;
}
.empty-state {
  padding: 48px;
  text-align: center;
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
  .task-card {
    padding: 18px;
  }
}
</style>
<style scoped>
.task-cover {
  height: 145px;
  background: #eeeefa;
  position: relative;
  border-radius: 9px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: #8b85bc;
  overflow: hidden;
}
.task-cover.video {
  background: linear-gradient(125deg, #34384f, #68668c);
  color: #dbd8f3;
}
.task-cover > .anticon {
  font-size: 32px;
  opacity: 0.85;
}
.task-cover > span:not(.anticon) {
  font-size: 8px;
  letter-spacing: 2px;
  opacity: 0.7;
}
.task-cover small {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 9px;
  background: #ffffff22;
  padding: 4px 6px;
  border-radius: 4px;
}
.task-cover img {
  width: 100%;
  height: 100%;
}
</style>
