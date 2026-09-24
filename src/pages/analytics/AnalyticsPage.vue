<script setup lang="ts">
import { computed } from 'vue'
import PageHeader from '../../components/PageHeader.vue'
import { useFactoryStore } from '../../stores/factory'
import { TASK_STATUS_LABELS, TASK_STATUS_VALUES } from '../../types'
const store = useFactoryStore()
const finished = computed(() => store.db.tasks.filter((t) => ['SUCCESS', 'FAILED'].includes(t.status)))
const success = computed(() =>
  finished.value.length
    ? `${Math.round((finished.value.filter((t) => t.status === 'SUCCESS').length / finished.value.length) * 100)}%`
    : '—',
)
const average = computed(() =>
  Math.round(store.db.tasks.reduce((sum, t) => sum + t.elapsed, 0) / (store.db.tasks.length || 1)),
)
const days = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const day = new Date()
    day.setDate(day.getDate() - 6 + index)
    const date = day.toLocaleDateString()
    return {
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      count: store.db.tasks.filter((t) => new Date(t.createdAt).toLocaleDateString() === date).length,
    }
  }),
)
const max = computed(() => Math.max(1, ...days.value.map((d) => d.count)))
const status = computed(() =>
  TASK_STATUS_VALUES.map((key) => ({
    key,
    label: TASK_STATUS_LABELS[key],
    count: store.db.tasks.filter((t) => t.status === key).length,
  })),
)
const failures = computed(() =>
  ['quality', 'system', 'timeout'].map((key) => ({
    key,
    count: store.db.tasks.filter((t) => t.errorType === key && t.status === 'FAILED').length,
  })),
)
function exportStats() {
  const blob = new Blob(
    [JSON.stringify({ days: days.value, statuses: status.value, failures: failures.value }, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'factory-statistics.json'
  a.click()
  URL.revokeObjectURL(url)
}
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="OBSERVABILITY"
      title="数据统计"
      description="本地工作空间的真实任务统计 · AI 运行与调用为模拟数据。"
      ><a-button @click="exportStats">导出统计</a-button></PageHeader
    >
    <section class="metric-grid">
      <article class="metric-card">
        <div class="metric-label">任务总量</div>
        <strong class="metric-number">{{ store.db.tasks.length }}</strong>
      </article>
      <article class="metric-card">
        <div class="metric-label">已结束任务成功率</div>
        <strong class="metric-number">{{ success }}</strong>
      </article>
      <article class="metric-card">
        <div class="metric-label">已沉淀资产</div>
        <strong class="metric-number">{{ store.db.assets.length }}</strong>
      </article>
      <article class="metric-card">
        <div class="metric-label">平均任务耗时</div>
        <strong class="metric-number">{{ average }}s</strong>
      </article>
    </section>
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">PRODUCTION TREND</span>
          <h2>近 7 天任务创建量</h2>
        </div>
        <span class="chip">浏览器本地数据</span>
      </div>
      <div class="bar-chart">
        <div
          v-for="day in days"
          :key="day.label"
          class="bar-item"
        >
          <strong>{{ day.count }}</strong
          ><i :style="{ height: `${(day.count / max) * 135 + 2}px` }"></i><span>{{ day.label }}</span>
        </div>
      </div>
    </section>
    <div class="analytics-grid">
      <section class="panel">
        <h3>任务状态分布</h3>
        <div
          v-for="item in status"
          :key="item.key"
          class="analytics-row"
          role="group"
          :aria-label="`${item.label}：${item.count} 个任务，占比 ${Math.round((item.count / (store.db.tasks.length || 1)) * 100)}%`"
          :title="`${item.label}：${item.count} 个任务`"
        >
          <span>{{ item.label }}</span
          ><a-progress
            :percent="Math.round((item.count / (store.db.tasks.length || 1)) * 100)"
            :show-info="false"
          /><strong>{{ item.count }}</strong>
        </div>
      </section>
      <section class="panel">
        <h3>失败原因</h3>
        <div
          v-for="item in failures"
          :key="item.key"
          class="failure-row"
        >
          <span>{{ { quality: 'AI 质量不通过', system: '系统错误', timeout: '生成超时' }[item.key] }}</span
          ><strong>{{ item.count }}</strong>
        </div>
        <h3>内容类型</h3>
        <div class="failure-row">
          <span>视频 / 文章</span
          ><strong
            >{{ store.db.tasks.filter((t) => t.kind === 'video').length }} /
            {{ store.db.tasks.filter((t) => t.kind === 'article').length }}</strong
          >
        </div>
      </section>
      <section class="panel model-chart">
        <h3>模型调用 · 模拟统计</h3>
        <div
          v-for="model in store.db.models"
          :key="model.id"
          class="failure-row"
        >
          <span>{{ model.name }}</span
          ><strong>{{ model.calls }} 次 · {{ model.latency }}s</strong>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.bar-chart {
  height: 210px;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 12px 10px 0;
  border-bottom: 1px solid #ededf2;
}
.bar-item {
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 9px;
}
.bar-item i {
  width: 100%;
  max-width: 42px;
  background: #7770d8;
  border-radius: 5px 5px 0 0;
}
.bar-item span,
.bar-item strong {
  font-size: 11px;
  color: #898b9a;
}
.analytics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.analytics-row {
  display: grid;
  grid-template-columns: 86px 1fr 25px;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: #7d7f8d;
  margin: 19px 0;
}
.analytics-row strong {
  color: #333442;
  text-align: right;
}
.failure-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #f0f0f4;
  font-size: 12px;
  color: #7d7f8d;
}
.failure-row strong {
  color: #655dd0;
}
.model-chart {
  grid-column: 1/-1;
}
@media (max-width: 600px) {
  .analytics-grid {
    grid-template-columns: 1fr;
  }
  .bar-chart {
    gap: 9px;
  }
}
</style>
