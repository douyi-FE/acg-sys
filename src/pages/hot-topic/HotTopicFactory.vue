<script setup lang="ts">
/* global URL */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFactoryStore } from '../../stores/factory'
import type { HotTopic } from '../../types'
import PageHeader from '../../components/PageHeader.vue'
import { isMockMode } from '../../api/mode'
import { useFieldValidation, required } from '../../composables/fieldValidation'
const { vField, validateFields, resetValidation } = useFieldValidation()

const store = useFactoryStore()
const router = useRouter()
const source = ref('')
const query = ref('')
const selectedId = ref('')
const open = ref(false)
const busy = ref('')
const error = ref('')
const title = ref('')
const outline = ref('')
const drafts = new Map<string, { title: string; outline: string }>()
const sources = computed(() => [...new Set(store.db.topics.flatMap((t) => t.sources.map((s) => s.name)))])
const sourceOptions = computed(() => [
  { value: '', label: '全部来源' },
  { value: 'example:no-source', label: '本地示例 / 无原始来源' },
  ...sources.value.map((name) => ({ value: `source:${name}`, label: name })),
])
const topics = computed(() =>
  store.db.topics.filter(
    (t) =>
      (!source.value ||
        (source.value === 'example:no-source'
          ? !t.sources.length
          : t.sources.some((s) => `source:${s.name}` === source.value))) &&
      t.title.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const selected = computed(() => store.db.topics.find((t) => t.id === selectedId.value))
const totalHeat = computed(() => store.db.topics.reduce((sum, t) => sum + t.heat, 0))
function safeUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}
function time(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN')
}
async function refresh() {
  if (busy.value) return
  busy.value = 'refresh'
  error.value = ''
  try {
    await store.refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '刷新失败，请重试'
  } finally {
    busy.value = ''
  }
}
async function inspect(topic: HotTopic) {
  if (busy.value || !isMockMode) return
  if (selectedId.value === topic.id) { open.value = true; return }
  if (selectedId.value) drafts.set(selectedId.value, { title: title.value, outline: outline.value })
  selectedId.value = topic.id
  resetValidation()
  open.value = true
  title.value = drafts.get(topic.id)?.title ?? topic.title
  outline.value = drafts.get(topic.id)?.outline ?? topic.summary
  busy.value = 'analyze'
  error.value = ''
  try {
    await store.analyzeTopic(topic.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '分析失败，请重试'
  } finally {
    busy.value = ''
  }
}
function propose() {
  if (!selected.value) return
  title.value = `${selected.value.title}：发生了什么，影响几何？`
  outline.value = `一、事件背景与已知事实\n${selected.value.summary}\n\n二、可能影响（AI 推断，需核验）\n\n三、不同观点与待核实信息\n\n四、原始来源与时间线`
}
// 创建成功后若保存失败，保留草稿 ID，重试不会重复创建。
const pendingArticle = ref<Awaited<ReturnType<typeof store.createArticle>> | null>(null)
async function create() {
  if (busy.value || !isMockMode || !validateFields() || !selected.value) return
  busy.value = 'create'
  error.value = ''
  try {
    if (!pendingArticle.value || pendingArticle.value.topicId !== selected.value.id)
      pendingArticle.value = await store.createArticle(selected.value.id)
    const article = {
      ...pendingArticle.value,
      title: title.value.trim(),
      outline: outline.value.trim(),
      updatedAt: new Date().toISOString(),
    }
    await store.saveArticle(article)
    pendingArticle.value = null
    await router.push(`/articles/${encodeURIComponent(article.id)}?created=1`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '创建或保存失败，可重试'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="AI 热点工厂"
      description="1 选择热点 → 2 分析与来源核验 → 3 创建热点文章，进入编辑器继续写作。"
      eyebrow="CONTENT INTELLIGENCE"
    >
      <a-button type="primary" :disabled="!isMockMode || !!busy || !selected" @click="selected && inspect(selected)">创建热点文章</a-button>
      <a-button
        :loading="busy === 'refresh' || store.loading"
        :disabled="!!busy"
        @click="refresh"
        >刷新热点</a-button
      >
    </PageHeader>
    <ol class="creation-steps" aria-label="热点文章创作步骤">
      <li><strong>1 选择热点</strong><span>在下方选择一条热点，不会自动创建文章。</span></li>
      <li><strong>2 核验来源</strong><span>查看分析、原始链接与时间；模拟信息不代表已核实。</span></li>
      <li><strong>3 创建草稿</strong><span>填写标题和提纲，再进入编辑器写正文；不会自动发布。</span></li>
    </ol>
    <a-alert
      v-if="!isMockMode"
      type="warning"
      message="真实热点文章暂不可用"
      description="后端尚未提供热点分析与文章存储接口。此处不会生成模拟文章或发送无效请求；真实文本生成请使用“真实内容创作”的 LLM 入口。"
    />
    <router-link v-if="!isMockMode" to="/video/new">前往真实内容创作（LLM 文本生成，不是热点文章存储）</router-link>
    <a-alert
      v-if="error || store.error"
      type="error"
      show-icon
      :message="error || String(store.error)"
    />
    <a-alert
      v-if="isMockMode"
      type="info"
      show-icon
      message="当前为本地 Mock 热点与热度，刷新只重新读取本地数据，不抓取实时新闻。无来源条目归入“本地示例 / 无原始来源”，不补造新闻链接或事实。"
    />
    <div class="stats">
      <div class="panel">
        <span class="muted">追踪热点</span><strong>{{ store.db.topics.length }}</strong>
      </div>
      <div class="panel">
        <span class="muted">已登记来源</span><strong>{{ sources.length }}</strong>
      </div>
      <div class="panel">
        <span class="muted">累计热度</span><strong>{{ totalHeat.toLocaleString() }}</strong>
      </div>
    </div>
    <section class="panel">
      <div class="section-head">
        <h2>1 选择热点{{ isMockMode ? ' · 本地模拟' : '' }}</h2>
        <span class="muted">{{ topics.length }} 个结果</span>
      </div>
      <div class="filters">
        <a-input
          v-model:value="query"
          placeholder="搜索热点标题"
          allow-clear
          aria-label="搜索热点"
        />
        <a-select
          v-model:value="source"
          aria-label="来源筛选"
          :options="sourceOptions"
        />
      </div>
      <div
        v-if="!topics.length"
        class="empty-state"
      >
        {{ isMockMode ? '暂无匹配热点。清空搜索或加载演示数据，再选择热点创建文章。' : '暂无真实热点数据；热点分析与文章存储接口尚未开放。' }}
        <a-button v-if="isMockMode" @click="query = ''; source = ''">清空筛选</a-button>
        <a-button v-if="isMockMode && !store.db.topics.length" @click="store.loadDemo()">加载演示热点</a-button>
      </div>
      <article
        v-for="topic in topics"
        :key="topic.id"
        class="topic"
        :class="{ 'topic-selected': selectedId === topic.id }"
      >
        <div class="topic-main">
          <a-tag v-if="selectedId === topic.id" color="purple">已选择</a-tag>
          <span class="chip">{{ topic.category }}</span>
          <h3>{{ topic.title }}</h3>
          <p class="muted">{{ topic.summary }}</p>
          <div class="meta">
            <span>{{
              topic.sources.map((s) => s.name).join(' · ') || '本地 Mock 示例 · 无原始来源，待核实'
            }}</span
            ><span>风险提示：{{ topic.risk || '尚未评估' }}</span>
          </div>
        </div>
        <div class="topic-action">
          <strong>{{ topic.heat.toLocaleString() }}</strong
          ><span class="muted">热度 · 增长 {{ topic.growth }}%</span
          ><a-button
            :disabled="!!busy || !isMockMode"
            :aria-pressed="selectedId === topic.id"
            @click="inspect(topic)"
            >选择热点并创建文章</a-button
          >
        </div>
      </article>
    </section>
    <a-drawer
      v-model:open="open"
      title="2 分析与来源核验 → 3 创建热点文章"
      width="min(680px, 100vw)"
      :mask-closable="!busy"
      :closable="!busy"
    >
      <div
        v-if="selected"
        class="drawer-body"
      >
        <a-alert
          v-if="error"
          type="error"
          :message="error"
          show-icon
        />
        <h2>{{ selected.title }}</h2>
        <h3>2 分析与来源核验</h3>
        <a-alert
          type="info"
          message="AI 分析与选题为本地模拟，不等于事实核验；请查阅原始来源。"
          show-icon
        />
        <a-spin :spinning="busy === 'analyze'">
          <section
            v-for="type in ['事实', 'AI 推断', '用户观点', '待核实'] as const"
            :key="type"
            class="analysis-group"
          >
            <h3>{{ type }}</h3>
            <div
              v-for="(item, index) in selected.analysis.filter((a) => a.type === type)"
              :key="index"
              class="analysis-item"
            >
              <b>{{ item.label }}</b>
              <p>{{ item.text }}</p>
            </div>
            <p
              v-if="!selected.analysis.some((a) => a.type === type)"
              class="muted"
            >
              暂无此类信息
            </p>
          </section>
        </a-spin>
        <a-alert
          type="warning"
          :message="`风险提示：${selected.risk || '尚未评估'}`"
        />
        <section>
          <h3>原始来源与时间</h3>
          <div
            v-for="(s, index) in selected.sources"
            :key="index"
            class="source"
          >
            <a
              v-if="safeUrl(s.url)"
              :href="safeUrl(s.url)"
              target="_blank"
              rel="noopener noreferrer"
              >{{ s.name }} ↗</a
            ><span v-else>{{ s.name }}（链接无效）</span> <small>发布时间：{{ time(s.publishedAt) }}</small
            ><small>采集时间：{{ time(s.fetchedAt) }}</small>
          </div>
          <a-alert
            v-if="!selected.sources.length"
            type="warning"
            show-icon
            message="暂无原始来源，不可作为真实事实引用。"
            description="示例来源为应用内本地 Mock 数据，仅用于演示操作。没有原始新闻链接、发布时间或真实采集记录，请自行核实并在文章人工核验中记录来源。"
          />
        </section>
        <section>
          <div class="section-head">
            <h3>3 创建热点文章 · 编辑标题与提纲</h3>
            <a-button
              :disabled="!!busy"
              @click="propose"
              >生成选题（模拟）</a-button
            >
          </div>
          <label v-field="required(title, '文章标题')" class="field"
            >文章标题<a-input
              v-model:value="title"
              :disabled="!!busy"
              :maxlength="200"
          /></label>
          <label v-field="required(outline, '创作提纲')" class="field"
            >创作提纲<a-textarea
              v-model:value="outline"
              :disabled="!!busy"
              :rows="7"
          /></label>
        </section>
        <a-button
          type="primary"
          :loading="busy === 'create'"
          :disabled="!!busy"
          @click="create"
          >创建热点文章并进入编辑器</a-button
        >
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.creation-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 0; list-style: none; margin: 0; }
.creation-steps li { display: grid; gap: 8px; padding: 16px; border: 1px solid #e8e9f0; border-radius: 10px; background: white; }
.creation-steps span { font-size: 13px; color: #686b7c; }
.topic-selected { background: #f5f3ff; box-shadow: inset 3px 0 #635bdb; padding-left: 12px; }
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.stats .panel {
  padding: 22px;
}
.stats strong {
  display: block;
  font-size: 30px;
  color: #635bdb;
  margin-top: 8px;
}
.filters {
  display: grid;
  grid-template-columns: 1fr 180px;
  gap: 12px;
  margin: 20px 0;
}
.topic {
  display: flex;
  gap: 24px;
  justify-content: space-between;
  padding: 24px 0;
  border-top: 1px solid #eeeef4;
}
.topic-main {
  min-width: 0;
}
.topic h3 {
  font-size: 18px;
  margin: 12px 0;
}
.topic p {
  line-height: 1.7;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #777889;
}
.topic-action {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
  flex-shrink: 0;
}
.topic-action strong {
  font-size: 24px;
  color: #635bdb;
}
.drawer-body {
  display: grid;
  gap: 20px;
  overflow-wrap: anywhere;
}
.analysis-group {
  margin-top: 20px;
}
.analysis-item {
  padding: 12px;
  background: #f7f7fb;
  border-radius: 8px;
  margin-top: 8px;
}
.analysis-item p {
  margin: 8px 0 0;
  line-height: 1.7;
}
.source {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-bottom: 1px solid #eee;
}
.source small {
  color: #777;
}
.field {
  display: grid;
  gap: 8px;
  margin: 14px 0;
}
h2,
h3 {
  overflow-wrap: anywhere;
}
.panel {
  min-width: 0;
}
@media (max-width: 600px) {
  .creation-steps { grid-template-columns: 1fr; }
  .stats {
    gap: 8px;
  }
  .stats .panel {
    padding: 14px 10px;
  }
  .stats strong {
    font-size: 22px;
  }
  .filters {
    grid-template-columns: 1fr;
  }
  .topic {
    flex-direction: column;
    gap: 12px;
  }
  .topic-action {
    align-items: flex-start;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .section-head {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
