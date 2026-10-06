<script setup lang="ts">
/* global Blob, URL, document, navigator, window */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import MarkdownIt from 'markdown-it'
import type { VideoTask } from '../types'
import { useFactoryStore } from '../stores/factory'
import { isMockMode } from '../api/mode'
import { assetBlob } from '../api/session'
import AuthorizedAsset from './AuthorizedAsset.vue'
import SafeMarkdown from './SafeMarkdown.vue'
import JsonCode from './JsonCode.vue'

const props = withDefaults(defineProps<{
  task: VideoTask
  dirty?: boolean
  displayMode?: 'full' | 'core' | 'delivery'
}>(), { displayMode: 'full' })
const store = useFactoryStore()
const mockVideoError = ref(false)
const mockVideoUrl = '/mock-assets/f2f33158052b4d898f47826dcd166892.mp4'
const articles = computed(() => store.db.articles.filter((article) => article.taskId === props.task.id))
// Only registered assets associated with this task (directly or via its execution).
// Never interpret provider URLs or stage output strings as media.
const assets = computed(() =>
  store.db.assets.filter(
    (asset) =>
      asset.taskId === props.task.id ||
      (!asset.taskId &&
        !!asset.executionId &&
        store.db.executions?.some((run) => run.id === asset.executionId && run.taskId === props.task.id)),
  ),
)
const videoAssets = computed(() => assets.value.filter((asset) => asset.type === '视频'))
const supportingAssets = computed(() => assets.value.filter((asset) => asset.type !== '视频'))
const executions = computed(() =>
  (store.db.executions ?? []).filter((run) => run.taskId === props.task.id && run.output),
)
const article = computed(() => articles.value[0])
const deliverableReady = computed(() => props.task.approved && props.task.status === 'SUCCESS' && !props.dirty)
const downloading = ref(false)
const subtitle = computed(() => {
  const stage = props.task.stages.find(item => item.key === 'SUBTITLE')
  return stage?.status === 'success' && stage.output.includes('-->') ? stage.output : ''
})
const primaryVideoAsset = computed(() => videoAssets.value[0])
const mockVideoFilename = 'f2f33158052b4d898f47826dcd166892.mp4'
function isJson(value: string) {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function downloadAsset(asset: { id: string; name: string }) {
  if (!deliverableReady.value || downloading.value) return
  downloading.value = true
  try {
    saveBlob(await assetBlob(asset.id), asset.name || asset.id)
    message.success('资产下载已开始')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '资产下载失败')
  } finally {
    downloading.value = false
  }
}
function downloadMockVideo() {
  if (!deliverableReady.value || !isMockMode) return
  const anchor = document.createElement('a')
  anchor.href = mockVideoUrl
  anchor.download = mockVideoFilename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  message.info('已开始下载项目内 Mock 示例视频；该文件不是当前任务生成结果')
}
function downloadText(content: string, filename: string, type: string) {
  if (!deliverableReady.value) return
  saveBlob(new Blob([content], { type }), filename)
  message.success('文件下载已开始')
}
async function copyText(content: string, label: string) {
  if (!deliverableReady.value) return
  try {
    await navigator.clipboard.writeText(content)
    message.success(`${label}已复制`)
  } catch {
    message.error(`无法复制${label}，请手动选择文本复制`)
  }
}
function articleMarkdown() {
  if (!article.value) return ''
  return `# ${article.value.title}\n\n${article.value.body}\n\n---\n人工审核通过的本地制作稿；未自动发布。`
}
function articleHtml() {
  if (!article.value) return ''
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const markdown = new MarkdownIt({ html: false, linkify: false })
  markdown.renderer.rules.image = () => '<span>配图请另行下载已登记资产</span>'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(article.value.title)}</title></head><body><h1>${escape(article.value.title)}</h1>${markdown.render(article.value.body)}</body></html>`
}
function downloadPackage() {
  const content = {
    format: 'ai-content-factory-deliverable',
    version: 1,
    taskId: props.task.id,
    kind: props.task.kind,
    approved: props.task.approved,
    notice: isMockMode
      ? 'Mock 交付包；媒体示例不代表当前任务真实生成结果。'
      : '真实交付包仅包含当前账号有权访问的任务元数据与资产清单。',
    task: props.task,
    article: article.value,
    assets: assets.value.map(asset => ({
      id: asset.id, name: asset.name, type: asset.type,
      createdAt: asset.createdAt, executionId: asset.executionId,
    })),
  }
  downloadText(JSON.stringify(content, null, 2), `${props.task.id}-deliverable.json`, 'application/json;charset=utf-8')
}
const shotFields = [
  ['description', '画面'],
  ['character', '角色'],
  ['camera', '镜头'],
  ['action', '动作'],
  ['emotion', '情绪'],
  ['sound', '声音'],
  ['firstPrompt', '首帧提示词'],
  ['lastPrompt', '尾帧提示词'],
  ['bridge', '剧情桥'],
  ['continuity', '连续性'],
] as const
</script>

<template>
  <section
    id="review-preview"
    class="panel review-preview"
    :class="`display-${props.displayMode}`"
    data-testid="task-review-preview"
    aria-labelledby="review-heading"
  >
    <header v-if="displayMode === 'full'" class="review-header">
      <div>
        <span class="eyebrow">REVIEW PREVIEW</span>
        <h2 id="review-heading">审核内容预览</h2>
        <p>已保存版本 · {{ task.id }}</p>
      </div>
      <span
        class="status-badge"
        :class="task.approved ? 'status-success' : 'status-reviewing'"
        >{{ task.approved ? '已通过' : '尚未通过' }}</span
      >
    </header>
    <h2 v-else id="review-heading">{{ task.title }}</h2>
    <div v-if="displayMode === 'full'" class="review-meta">
      <span>当前阶段 {{ task.stages[task.stageIndex]?.name || '暂无阶段' }}</span
      ><span>更新于 {{ task.updatedAt }}</span
      ><span>状态：{{ task.approved ? '已通过' : '尚未通过' }}</span>
    </div>
    <p
      v-if="displayMode !== 'delivery' && isMockMode"
      class="notice"
    >
      Mock 演示内容，不代表真实生成媒体或已核实事实。
    </p>
    <p v-if="displayMode === 'full'" class="saved-note">仅展示已保存内容；编辑器中的未保存草稿不包含在本预览中。</p>
    <p
      v-if="displayMode === 'full' && dirty"
      role="alert"
      class="notice"
    >
      有未保存修改：下方仍为已保存版本，请保存或放弃修改后再审核。
    </p>
    <p v-if="displayMode === 'full'">
      审核状态：{{ task.approved ? '已通过' : '尚未通过' }}；{{
        task.quality ? '请结合当前质量检查与安全核验结果审核' : '当前内容尚无有效质量评分，需重新质检'
      }}。内容修改后旧审核结论失效。
    </p>

    <template v-if="task.kind === 'article' && displayMode !== 'delivery'">
      <p
        v-if="!articles.length"
        role="status"
        class="review-empty"
      >
        关联文章全文不可用；不会以任务脚本、摘要或阶段输出替代正文。
      </p>
      <article
        v-for="article in articles"
        :key="article.id"
        class="editorial-article"
      >
        <header class="article-header">
          <p v-if="displayMode === 'full'" class="article-meta">
            {{ article.platform }} · {{ article.status }} · 保存时间 {{ article.updatedAt }}
          </p>
          <h3>{{ article.title || '尚未保存标题' }}</h3>
          <div v-if="displayMode === 'full'" class="article-tools">
            <span>文章 {{ article.id }}</span
            ><RouterLink
              :to="{ path: `/articles/${encodeURIComponent(article.id)}`, query: { reviewTask: task.id } }"
              >打开文章与事实核验</RouterLink
            >
          </div>
        </header>
        <SafeMarkdown
          v-if="article.body.trim()"
          :source="article.body"
          :title="article.title"
          data-testid="article-full-body"
        />
        <p
          v-else
          role="status"
        >
          已保存正文为空，请在文章编辑器补充正文。
        </p>
        <aside v-if="displayMode === 'full'" class="safety-summary">
          <h4>安全核验（已保存）</h4>
          <p v-if="!article.safety.length">暂无已保存核验结果。</p>
          <p
            v-for="(check, index) in article.safety"
            :key="index"
          >
            <strong>{{ check.name }} · {{ check.status }}</strong
            ><br />{{ check.reason }}
          </p>
        </aside>
      </article>
      <p v-if="!assets.some((asset) => asset.type === '图片')">
        暂无已登记配图；纯文字文章无需配图。正文中的外部图片地址仅按文字展示，不自动加载。
      </p>
    </template>
    <template v-else-if="task.kind === 'video' && displayMode !== 'delivery'">
      <section
        class="video-review-hero"
        data-testid="video-review-preview"
        aria-label="视频预览"
      >
        <div class="video-review-heading">
          <div>
            <span v-if="displayMode === 'full'" class="eyebrow">PRIMARY REVIEW EVIDENCE</span>
            <h3>视频预览</h3>
            <p v-if="displayMode === 'full'" class="saved-note">人工审核应优先依据已登记的实际视频资产，而不是仅依据脚本或分镜。</p>
          </div>
          <span v-if="videoAssets.length" class="video-count">{{ videoAssets.length }} 个视频资产</span>
        </div>
        <template v-if="!isMockMode && videoAssets.length">
          <article v-for="asset in videoAssets" :key="asset.id" class="video-preview-card">
            <h4>{{ asset.name }}</h4>
            <p v-if="displayMode === 'full'" class="article-meta">{{ asset.id }} · {{ asset.createdAt }}</p>
            <AuthorizedAsset :id="asset.id" :name="asset.name" />
          </article>
        </template>
        <div v-else-if="isMockMode" data-testid="mock-video-preview">
          <p class="notice">用户提供的 Mock 示例视频，非当前任务生成；仅用于预览与审核交互演示，不代表任务已完成。</p>
          <div v-if="!mockVideoError" class="mock-video-frame">
            <video :src="mockVideoUrl" controls playsinline preload="metadata"
              aria-label="Mock 示例视频" @error="mockVideoError = true" />
          </div>
          <p v-else role="alert">项目内 Mock 示例视频不可用或格式不支持；不会替换为其他视频。</p>
        </div>
        <p v-else class="notice">
          暂无可播放的实际视频资产。当前不能以脚本、分镜或占位视频替代人工审核依据。
        </p>
      </section>
      <template v-if="displayMode === 'full'">
      <h3>脚本</h3>
      <div class="saved-body script-body">{{ task.script || '脚本尚未产出或不可用' }}</div>
      <h3>角色</h3>
      <p v-if="!task.characters.length">角色尚未产出或不可用。</p>
      <div class="storyboard-grid">
        <article
          v-for="character in task.characters"
          :key="character.id"
          class="storyboard-card"
        >
          <h4>{{ character.name }}</h4>
          <p>{{ character.age }} · {{ character.gender }} · {{ character.identity }}</p>
          <div class="saved-body">
            {{
              [character.appearance, character.outfit, character.expression, character.pose]
                .filter(Boolean)
                .join('\n')
            }}
          </div>
        </article>
      </div>
      <h3>分镜 / 图像提示词</h3>
      <p v-if="!task.shots.length">分镜尚未产出或不可用。</p>
      <div class="storyboard-grid">
        <article
          v-for="(shot, index) in task.shots"
          :key="shot.id"
          class="storyboard-card"
        >
          <h4>分镜 {{ index + 1 }} · {{ shot.start }}–{{ shot.end }}s</h4>
          <p
            v-for="[key, label] in shotFields"
            :key="key"
            class="saved-body"
          >
            <strong>{{ label }}：</strong>{{ shot[key] || '暂无' }}
          </p>
        </article>
      </div>
      <section
        v-if="displayMode === 'full'"
        class="execution-material"
        aria-label="已保存执行输出"
      >
        <h3>已保存执行输出</h3>
        <p
          v-if="!executions.length"
          class="saved-note"
        >
          暂无已保存执行输出。
        </p>
        <details
          v-for="run in executions"
          :key="run.id"
        >
          <summary>
            已保存执行输出 · {{ run.stageKey || run.stageId }} · {{ run.status }} · {{ run.id }}
          </summary>
          <p>
            产出时间
            {{ run.finishedAt || run.startedAt }}；这是该次执行的原始材料，不替代后续人工保存的创作内容。
          </p>
          <JsonCode v-if="isJson(run.output)" :value="run.output" />
          <div v-else class="saved-body">{{ run.output }}</div>
        </details>
      </section>
      </template>
    </template>
    <section
      v-if="displayMode === 'core' && task.kind === 'article' && supportingAssets.some(item => item.type === '图片')"
      class="article-illustrations"
      aria-label="文章配图"
    >
      <h3>文章配图</h3>
      <template v-for="asset in supportingAssets.filter(item => item.type === '图片')" :key="asset.id">
        <AuthorizedAsset v-if="!isMockMode" :id="asset.id" :name="asset.name" />
        <figure v-else class="article-illustration">
          <img :src="asset.url" :alt="asset.name" />
          <figcaption>{{ asset.name }}</figcaption>
        </figure>
      </template>
    </section>
    <section
      v-if="(displayMode === 'full' || displayMode === 'core' || displayMode === 'delivery') && deliverableReady"
      class="delivery-panel"
      data-testid="task-delivery"
      aria-label="审核后下载与交付"
    >
      <div class="delivery-heading">
        <div>
          <span class="eyebrow">DELIVERY</span>
          <h3>审核后下载与交付</h3>
          <p class="saved-note">任务已审核通过，可以下载或复制到其他平台；系统不会自动发布到外部平台。</p>
        </div>
        <span class="status-badge status-success">已审核，可交付</span>
      </div>
      <div v-if="isMockMode" class="notice">
        Mock 交付：项目内示例视频可以下载，但不代表当前任务真实生成结果。
      </div>
      <div class="delivery-actions">
        <template v-if="task.kind === 'video'">
          <a-button v-if="isMockMode" @click="downloadMockVideo">下载 Mock 示例视频</a-button>
          <a-button v-else-if="primaryVideoAsset" :disabled="downloading" @click="downloadAsset(primaryVideoAsset)">下载视频资产</a-button>
          <span v-else class="saved-note">暂无可下载的真实视频资产。</span>
          <a-button @click="copyText(task.title, '标题')">复制标题</a-button>
          <a-button @click="copyText(task.request.theme, '简介')">复制简介</a-button>
          <a-button v-if="subtitle" @click="downloadText(
            subtitle,
            `${task.id}.srt`,
            'text/plain;charset=utf-8',
          )">下载字幕</a-button>
        </template>
        <template v-else-if="article">
          <a-button @click="copyText(article.title, '标题')">复制标题</a-button>
          <a-button @click="copyText(article.body, '正文')">复制正文</a-button>
          <a-button @click="downloadText(articleMarkdown(), `${article.id}.md`, 'text/markdown;charset=utf-8')">下载 Markdown</a-button>
          <a-button @click="downloadText(articleHtml(), `${article.id}.html`, 'text/html;charset=utf-8')">下载 HTML</a-button>
        </template>
        <a-button type="primary" @click="downloadPackage">下载制作资料（JSON）</a-button>
      </div>
      <p class="saved-note">JSON 包含已保存创作资料和资产清单，不包含视频/图片二进制文件，请单独下载。暂无独立标签、摘要或封面字段，不自动编造。</p>
      <div v-if="!isMockMode" class="delivery-actions">
        <a-button v-for="asset in assets" :key="asset.id" :disabled="downloading"
          @click="downloadAsset(asset)">下载{{ asset.type }}：{{ asset.name }}</a-button>
      </div>
    </section>
    <section
      v-if="displayMode === 'full'"
      class="registered-media"
      aria-label="已登记资产"
    >
      <h3>已登记资产 / 执行产物</h3>
      <p class="saved-note">
        资产是对应执行的产物，不保证反映后续人工修改；请核对执行编号、产出时间与已保存内容。
      </p>
      <p
        v-if="!supportingAssets.length"
        class="review-empty"
      >
        暂无关联的已登记资产，或当前账号无权读取。
      </p>
      <article
        v-for="asset in supportingAssets"
        :key="asset.id"
        class="asset-card"
      >
        <h4>{{ asset.name }} · {{ asset.type }}</h4>
        <p class="article-meta">
          {{ asset.id }} · 执行 {{ asset.executionId || '未记录' }} · 阶段 {{ asset.stageId || '未记录' }} ·
          {{ asset.createdAt }}
        </p>
        <AuthorizedAsset
          v-if="!isMockMode"
          :id="asset.id"
          :name="asset.name"
        />
        <JsonCode
          v-else-if="asset.content && isJson(asset.content)"
          :value="asset.content"
        />
        <SafeMarkdown
          v-else-if="asset.content && /\.(md|markdown)$/i.test(asset.name)"
          :source="asset.content"
        />
        <div
          v-else-if="asset.content"
          class="saved-body"
        >
          {{ asset.content }}
        </div>
        <p v-else>Mock 资产无可预览的实际内容，不加载占位图或示例媒体。</p>
      </article>
    </section>
  </section>
</template>

<style scoped>
.panel.review-preview {
  min-width: 0;
  overflow-wrap: anywhere;
  scroll-margin-top: 24px;
  padding: 28px clamp(18px, 4vw, 52px);
  border: 1px solid #cdc7e6;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 4px 18px #3026570a;
}
.execution-material {
  max-width: 920px;
  margin: 28px auto;
  padding: 0 16px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fafafd;
  min-width: 0;
}
.video-review-hero {
  max-width: 920px;
  margin: 24px auto 32px;
  padding: 24px;
  border: 2px solid #635bdb;
  border-radius: 16px;
  background: linear-gradient(135deg, #f5f2ff, #fff);
  box-shadow: 0 8px 28px #635bdb1a;
}
.video-review-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.video-review-hero h3 {
  margin: 6px 0;
  font-size: clamp(20px, 3vw, 28px);
}
.video-count {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 999px;
  background: #635bdb;
  color: #fff;
  font-size: 12px;
}
.video-preview-card {
  margin-top: 18px;
  padding: 16px;
  border: 1px solid #dcd7f6;
  border-radius: 12px;
  background: #fff;
}
.video-preview-card h4 {
  margin: 0 0 4px;
}
.review-header {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  max-width: 920px;
  margin: 0 auto 12px;
}
.review-header h2 {
  margin: 6px 0 4px;
  font-size: clamp(21px, 3vw, 30px);
  letter-spacing: -0.04em;
}
.review-header p,
.review-meta {
  color: #858797;
  font-size: 12px;
  margin: 0;
}
.review-meta {
  border-bottom: 1px solid #eeeef3;
  border-top: 1px solid #eeeef3;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  max-width: 920px;
  margin: 0 auto 24px;
  padding: 12px 0;
}
.review-preview > p,
.review-preview > h3,
.review-preview > details,
.review-preview > article {
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
}
.review-preview article {
  min-width: 0;
  border-top: 1px solid #eeedf5;
  padding: 20px 0;
}
.review-preview p {
  line-height: 1.8;
}
.saved-note {
  color: #777889;
  font-size: 12px;
}
.saved-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.9;
  margin: 16px 0;
}
.notice {
  color: #93621b;
}
.review-preview h3 {
  margin-top: 28px;
}
.review-preview :deep(.authorized-asset) {
  background: #fafafd;
  border: 1px solid #ecebf2;
  border-radius: 12px;
  padding: 16px;
}
.review-preview :deep(video) {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(72vh, 720px);
  background: #181824;
  border-radius: 10px;
  object-fit: contain;
}
.mock-video-frame {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
  background: #181824;
}
.review-preview :deep(.video-review-hero .mock-video-frame video) {
  max-height: min(68vh, 680px);
}
.review-preview > .editorial-article {
  max-width: 760px;
  padding: 36px 0;
  margin-top: 32px;
}
.article-header {
  margin-bottom: 32px;
}
.article-header h3 {
  font-size: clamp(24px, 3vw, 36px);
  line-height: 1.35;
  letter-spacing: -0.03em;
  margin: 12px 0 20px;
}
.article-meta,
.article-tools {
  font-size: 12px;
  color: #777889;
}
.article-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 24px;
  justify-content: space-between;
}
.safety-summary {
  margin-top: 40px;
  padding: 20px;
  background: #f8f8fb;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 13px;
  color: #676879;
}
.safety-summary h4 {
  margin: 0 0 16px;
  color: var(--ink);
}
.registered-media {
  border-top: 1px solid var(--line);
  margin: 36px auto 0;
  max-width: 920px;
  min-width: 0;
}
.delivery-panel {
  max-width: 920px;
  margin: 32px auto 0;
  padding: 24px;
  border: 2px solid #2d8a6d;
  border-radius: 16px;
  background: linear-gradient(135deg, #f1fbf6, #fff);
}
.delivery-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.delivery-panel h3 {
  margin: 6px 0;
}
.delivery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
.article-illustrations {
  max-width: 920px;
  margin: 28px auto 0;
}
.article-illustration {
  margin: 16px 0;
}
.article-illustration img {
  display: block;
  width: min(100%, 760px);
  max-height: 420px;
  margin: 0 auto;
  object-fit: contain;
  border-radius: 12px;
  background: #f4f2fb;
}
.article-illustration figcaption {
  margin-top: 8px;
  color: #777889;
  font-size: 12px;
  text-align: center;
}
.review-empty {
  padding: 24px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  color: #777889;
  font-size: 13px;
}
.storyboard-grid {
  max-width: 920px;
  margin: 20px auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 16px;
}
.review-preview .storyboard-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
  background: #fafafd;
}
.storyboard-card h4 {
  margin: 0 0 14px;
}
.storyboard-card p {
  font-size: 13px;
  margin: 10px 0;
}
.script-body {
  max-width: 760px;
  margin: 20px auto;
  padding: 24px;
  background: #fafafd;
  border-radius: 12px;
}
.review-preview details {
  padding: 16px 0;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.review-preview summary {
  cursor: pointer;
  color: var(--primary);
}
@media (max-width: 600px) {
  .panel.review-preview {
    padding: 20px 16px;
  }
  .review-header {
    flex-direction: column;
    gap: 10px;
  }
  .review-meta {
    gap: 7px 14px;
  }
  .video-review-hero {
    padding: 16px;
  }
  .video-review-heading {
    flex-direction: column;
  }
  .delivery-panel {
    padding: 16px;
  }
  .delivery-heading {
    flex-direction: column;
  }
  .review-preview :deep(video) {
    max-height: min(68vh, 560px);
  }
}
</style>
