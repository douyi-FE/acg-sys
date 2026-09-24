<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  ArrowRightOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons-vue'
import PageHeader from '../../components/PageHeader.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { useFactoryStore } from '../../stores/factory'
import { useAuthStore } from '../../stores/auth'
const store = useFactoryStore()
const auth = useAuthStore()
const router = useRouter()
const demoLoading = ref(false)
async function loadDemo() {
  demoLoading.value = true
  try {
    await store.loadDemo()
    message.success('示例生产任务已加入队列，不会覆盖已有内容')
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '示例加载失败')
  } finally {
    demoLoading.value = false
  }
}
const running = computed(() =>
  store.db.tasks.filter((t) => t.status === 'RUNNING' || t.status === 'REVIEWING').slice(0, 4),
)
const videos = computed(() => store.db.tasks.filter((t) => t.kind === 'video'))
const articles = computed(() => store.db.articles)
const engineOverview = computed(() => {
  const instances = store.db.comfyInstances ?? []
  const healthy = instances.filter(
    (instance) =>
      instance.enabled &&
      instance.connected &&
      instance.health.status === 'healthy' &&
      !instance.health.simulated,
  ).length
  const queued = (store.db.comfyExecutions ?? []).filter((execution) => execution.status === 'QUEUED').length
  return `${instances.length} 个配置实例 · ${healthy} 个最近探测健康 · ${queued} 个本地排队执行`
})
const todayTasks = computed(() =>
  store.db.tasks.filter((task) => new Date(task.createdAt).toDateString() === new Date().toDateString()),
)
const stats = computed(() => [
  {
    label: '今日视频任务',
    value: todayTasks.value.filter((task) => task.kind === 'video').length,
    hint: 'Video Production',
    icon: PlayCircleOutlined,
    tone: 'purple',
    to: { path: '/tasks', query: { kind: 'video', date: 'today' } },
    permission: 'tasks.read',
  },
  {
    label: '今日文章任务',
    value: todayTasks.value.filter((task) => task.kind === 'article').length,
    hint: 'Article Production',
    icon: FileTextOutlined,
    tone: 'blue',
    to: { path: '/tasks', query: { kind: 'article', date: 'today' } },
    permission: 'tasks.read',
  },
  {
    label: '已收录热点',
    value: store.db.topics.length,
    hint: 'Demo Data · 非实时采集',
    icon: ThunderboltOutlined,
    tone: 'orange',
    to: '/hot-topics',
    permission: 'workspace.read',
  },
  {
    label: '正在生产',
    value: store.db.tasks.filter((task) => task.status === 'RUNNING').length,
    hint: 'Running Tasks',
    icon: PlayCircleOutlined,
    tone: 'purple',
    to: { path: '/tasks', query: { status: 'RUNNING' } },
    permission: 'tasks.read',
  },
  {
    label: '等待审核',
    value: store.db.tasks.filter((task) => task.status === 'REVIEWING').length,
    hint: 'Human Review',
    icon: ClockCircleOutlined,
    tone: 'orange',
    to: { path: '/tasks', query: { status: 'REVIEWING' } },
    permission: 'tasks.read',
  },
  {
    label: '任务成功率',
    value: successRate.value,
    hint: '已结束任务 / 本地记录',
    icon: ThunderboltOutlined,
    tone: 'green',
    to: '/analytics',
    permission: 'workspace.read',
  },
])
const canOpenStat = (stat: (typeof stats.value)[number]) => auth.can(stat.permission)
const statAriaLabel = (stat: (typeof stats.value)[number]) =>
  canOpenStat(stat) ? `查看${stat.label}` : `${stat.label}，当前账号无权查看明细`
const successRate = computed(() => {
  const finished = store.db.tasks.filter((t) => ['SUCCESS', 'FAILED'].includes(t.status))
  return finished.length
    ? `${Math.round((finished.filter((t) => t.status === 'SUCCESS').length / finished.length) * 100)}%`
    : '—'
})
const dateLabel = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
  .format(new Date())
  .toUpperCase()
const statusText = (progress: number) =>
  progress > 0 ? `正在生成第 ${Math.max(1, Math.floor(progress / 18))} 个镜头` : '等待调度'
</script>
<template>
  <div class="page-stack dashboard">
    <PageHeader
      :eyebrow="dateLabel"
      title="今天，AI 正在生产什么？"
      description="欢迎回来。让创意成为内容，让生产有迹可循。"
      ><a-button
        v-if="!store.db.tasks.length"
        :loading="demoLoading"
        :disabled="store.loading"
        @click="loadDemo"
        >体验示例流水线</a-button
      ><button
        class="button primary"
        @click="router.push('/video/new')"
      >
        <PlusOutlined />创建内容
      </button></PageHeader
    >
    <section class="hero-panel">
      <div>
        <span class="hero-kicker"
          >AI CONTENT FACTORY <span class="live-badge"><i></i> LIVE</span></span
        >
        <h2>让创意进入流水线<br /><em>让内容自己长出来。</em></h2>
        <p>从一个主题开始，AI 将协助你完成策划、生产与审核。</p>
        <div class="hero-actions">
          <button
            class="button white"
            @click="router.push('/video/new')"
          >
            启动 AI 创作 <ArrowRightOutlined /></button
          ><button
            class="text-button"
            @click="router.push('/tasks')"
          >
            查看生产队列 <ArrowRightOutlined />
          </button>
        </div>
      </div>
      <div class="hero-orbit">
        <div class="orbit-ring ring-one"></div>
        <div class="orbit-ring ring-two"></div>
        <div class="orbit-core">✦<small>AI</small></div>
        <span class="orbit-node n1">剧本</span><span class="orbit-node n2">分镜</span
        ><span class="orbit-node n3">审核</span><span class="orbit-node n4">成片</span>
      </div>
    </section>
    <section
      aria-label="Production Overview"
      class="metric-grid"
    >
      <template
        v-for="stat in stats"
        :key="stat.label"
      >
        <RouterLink
          v-if="canOpenStat(stat)"
          class="metric-card metric-card-link"
          :to="stat.to"
          :aria-label="statAriaLabel(stat)"
        >
          <div
            class="metric-icon"
            :class="stat.tone"
          >
            <component :is="stat.icon" />
          </div>
          <div class="metric-label">{{ stat.label }}</div>
          <strong class="metric-number">{{ stat.value }}</strong
          ><span class="metric-trend">{{ stat.hint }}</span>
        </RouterLink>
        <article
          v-else
          class="metric-card metric-card-disabled"
          :aria-label="statAriaLabel(stat)"
          :title="statAriaLabel(stat)"
        >
          <div
            class="metric-icon"
            :class="stat.tone"
          >
            <component :is="stat.icon" />
          </div>
          <div class="metric-label">{{ stat.label }}</div>
          <strong class="metric-number">{{ stat.value }}</strong
          ><span class="metric-trend">{{ stat.hint }} · 无明细权限</span>
        </article>
      </template>
    </section>
    <div class="engine-overview panel">
      <div>
        <span class="eyebrow">AI 引擎状态</span>
        <h3>统一执行引擎</h3>
        <p>{{ engineOverview }}</p>
        <p class="muted">提供方、工作流与实例状态独立管理。真实 GPU 与连接状态以引擎探测结果为准。</p>
      </div>
      <router-link to="/engine"><a-button>查看引擎与流水线</a-button></router-link
      ><router-link to="/comfyui"><a-button>ComfyUI 实例与队列</a-button></router-link>
    </div>
    <div class="dashboard-grid">
      <section class="panel activity-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow">LIVE PIPELINE</span>
            <h2>AI 正在工作</h2>
          </div>
          <button
            class="link-button"
            @click="router.push('/tasks')"
          >
            全部任务 <ArrowRightOutlined />
          </button>
        </div>
        <div
          v-if="running.length"
          class="activity-list"
        >
          <article
            v-for="task in running"
            :key="task.id"
            class="activity-item"
            tabindex="0"
            @keydown.enter="router.push(`/tasks/${task.id}`)"
            @click="router.push(`/tasks/${task.id}`)"
          >
            <div
              class="activity-icon"
              :class="task.kind"
            >
              <PlayCircleOutlined v-if="task.kind === 'video'" /><FileTextOutlined v-else />
            </div>
            <div class="activity-main">
              <div class="activity-title">
                <strong>{{ task.title }}</strong
                ><StatusBadge :status="task.status" />
              </div>
              <p>
                {{ task.stages[task.stageIndex]?.name || statusText(task.progress) }}
                <span>· {{ task.elapsed.toFixed(0) }}s 已耗时</span>
              </p>
              <div class="progress-track"><i :style="{ width: `${task.progress || 6}%` }"></i></div>
            </div>
            <div class="activity-percent">{{ task.progress }}%</div>
          </article>
        </div>
        <div
          v-else
          class="empty-state"
        >
          当前没有运行中的任务，启动下一次创作吧。
        </div>
      </section>
      <section class="panel quick-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow">PRODUCTION PULSE</span>
            <h2>生产概览</h2>
          </div>
        </div>
        <div class="pulse-ring">
          <div>
            <strong>{{ successRate }}</strong
            ><span>已结束任务成功率</span>
          </div>
        </div>
        <div class="pulse-row">
          <span><i class="dot purple"></i>视频任务</span><strong>{{ videos.length }}</strong>
        </div>
        <div class="pulse-row">
          <span><i class="dot orange"></i>文章任务</span><strong>{{ articles.length }}</strong>
        </div>
        <div class="pulse-row">
          <span><i class="dot blue"></i>已沉淀资产</span><strong>{{ store.db.assets.length }}</strong>
        </div>
      </section>
    </div>
    <section class="lower-grid">
      <div class="mini-panel">
        <span class="eyebrow">AUTOMATION</span>
        <h3>质量门正在守护内容</h3>
        <p>所有 AI 产出都经过可解释的 Quality Gate，关键节点保留人工确认入口。</p>
        <button
          class="link-button"
          @click="router.push('/settings')"
        >
          配置审核阈值 <ArrowRightOutlined />
        </button>
      </div>
      <div class="mini-panel accent">
        <span class="eyebrow">QUICK START</span>
        <h3>从一个想法开始</h3>
        <p>视频、文章、热点选题，选择一条生产线快速启动。</p>
        <div class="mini-actions">
          <button @click="router.push('/video/new')"><PlayCircleOutlined /> AI 视频</button
          ><button @click="router.push('/hot-topics')"><ThunderboltOutlined /> 热点文章</button>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.metric-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.metric-trend {
  position: static;
  display: block;
  margin-top: 9px;
  color: #9692ac;
  font-size: 10px;
}
.metric-card-link {
  color: inherit;
  text-decoration: none;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}
.metric-card-link:hover,
.metric-card-link:focus-visible {
  color: inherit;
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgb(55 48 120 / 12%);
}
.metric-card-link:focus-visible {
  outline: 3px solid rgb(99 91 219 / 35%);
  outline-offset: 3px;
}
.metric-card-disabled {
  cursor: not-allowed;
  opacity: 0.82;
}
.engine-overview {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.engine-overview > div {
  flex: 1;
  min-width: 200px;
}
.engine-overview h3 {
  margin: 7px 0;
  font-size: 16px;
}
.engine-overview p {
  margin: 0;
  line-height: 1.7;
}
@media (max-width: 700px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .engine-overview > a {
    width: 100%;
  }
  .engine-overview button {
    width: 100%;
  }
}
</style>
