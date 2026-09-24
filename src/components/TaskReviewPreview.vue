<script setup lang="ts">
import { computed } from 'vue'
import type { VideoTask } from '../types'
import { useFactoryStore } from '../stores/factory'
import { isMockMode } from '../api/mode'
import AuthorizedAsset from './AuthorizedAsset.vue'
import SafeMarkdown from './SafeMarkdown.vue'

const props = defineProps<{ task: VideoTask; dirty?: boolean }>()
const store = useFactoryStore()
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
const hasVideo = computed(() => !isMockMode && assets.value.some((asset) => asset.type === '视频'))
const executions = computed(() =>
  (store.db.executions ?? []).filter((run) => run.taskId === props.task.id && run.output),
)
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
    data-testid="task-review-preview"
    aria-labelledby="review-heading"
  >
    <header class="review-header">
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
    <div class="review-meta">
      <span>当前阶段 {{ task.stages[task.stageIndex]?.name || '暂无阶段' }}</span
      ><span>更新于 {{ task.updatedAt }}</span
      ><span>状态：{{ task.approved ? '已通过' : '尚未通过' }}</span>
    </div>
    <p
      v-if="isMockMode"
      class="notice"
    >
      Mock 演示内容，不代表真实生成媒体或已核实事实。
    </p>
    <p class="saved-note">仅展示已保存内容；编辑器中的未保存草稿不包含在本预览中。</p>
    <p
      v-if="dirty"
      role="alert"
      class="notice"
    >
      有未保存修改：下方仍为已保存版本，请保存或放弃修改后再审核。
    </p>
    <p>
      审核状态：{{ task.approved ? '已通过' : '尚未通过' }}；{{
        task.quality ? '请结合当前质量检查与安全核验结果审核' : '当前内容尚无有效质量评分，需重新质检'
      }}。内容修改后旧审核结论失效。
    </p>

    <template v-if="task.kind === 'article'">
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
          <p class="article-meta">
            {{ article.platform }} · {{ article.status }} · 保存时间 {{ article.updatedAt }}
          </p>
          <h3>{{ article.title || '尚未保存标题' }}</h3>
          <div class="article-tools">
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
        <aside class="safety-summary">
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
    <template v-else>
      <p
        v-if="!hasVideo"
        role="status"
        class="notice"
      >
        暂无可播放的实际视频产物（MP4 等）；不提供示例视频替代。请审核下方已保存脚本、角色与分镜材料。
      </p>
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
          <div class="saved-body">{{ run.output }}</div>
        </details>
      </section>
    </template>
    <section
      class="registered-media"
      aria-label="已登记资产"
    >
      <h3>已登记资产 / 执行产物</h3>
      <p class="saved-note">
        资产是对应执行的产物，不保证反映后续人工修改；请核对执行编号、产出时间与已保存内容。
      </p>
      <p
        v-if="!assets.length"
        class="review-empty"
      >
        暂无关联的已登记资产，或当前账号无权读取。
      </p>
      <article
        v-for="asset in assets"
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
  width: 100%;
  max-height: 520px;
  background: #181824;
  border-radius: 10px;
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
}
</style>
