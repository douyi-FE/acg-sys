<script setup lang="ts">
/* global URL, window, Blob, fetch, AbortSignal, document, setTimeout */
import { computed, ref } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import { taskStatusLabel } from '../../types'
import type { Asset } from '../../types'
import PageHeader from '../../components/PageHeader.vue'
import AssetTracePanel from '../../components/AssetTracePanel.vue'
import AuthorizedAsset from '../../components/AuthorizedAsset.vue'
import { assetBlob } from '../../api/session'
import { isMockMode } from '../../api/mode'

const store = useFactoryStore()
const query = ref('')
const type = ref('')
const tag = ref('')
const busy = ref('')
const error = ref('')
const previewId = ref<string | null>(null)
const preview = computed({
  get: () => store.db.assets.find((asset) => asset.id === previewId.value) ?? null,
  set: (asset: Asset | null) => {
    previewId.value = asset?.id ?? null
  },
})
const open = ref(false)
function openPreview(asset: Asset) {
  preview.value = asset
  open.value = true
}
const tags = computed(() => [...new Set(store.db.assets.flatMap((a) => a.tags))])
const assets = computed(() =>
  store.db.assets.filter(
    (a) =>
      (!type.value || a.type === type.value) &&
      (!tag.value || a.tags.includes(tag.value)) &&
      `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const task = computed(() => store.db.tasks.find((t) => t.id === preview.value?.taskId))
function safeUrl(value: string) {
  if (!isMockMode) return undefined
  if (!value.trim()) return undefined
  try {
    const u = new URL(value, window.location.origin)
    return ['http:', 'https:', 'blob:'].includes(u.protocol) ? u.href : undefined
  } catch {
    return undefined
  }
}
async function remove(asset: Asset) {
  if (busy.value) return
  busy.value = asset.id
  error.value = ''
  try {
    await store.deleteAsset(asset.id)
    if (preview.value?.id === asset.id) {
      open.value = false
      preview.value = null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败，请重试'
  } finally {
    busy.value = ''
  }
}
async function download(asset: Asset) {
  if (busy.value) return
  busy.value = asset.id
  error.value = ''
  try {
    let blob: Blob
    if (!isMockMode) blob = await assetBlob(asset.id)
    else if (asset.content !== undefined) blob = new Blob([asset.content], { type: 'text/plain;charset=utf-8' })
    else {
      const url = safeUrl(asset.url)
      if (!url) throw new Error('素材没有可用下载地址')
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`下载失败（${response.status}）`)
      blob = await response.blob()
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const extension =
      asset.content !== undefined
        ? '.txt'
        : (
            {
              'image/png': '.png',
              'image/jpeg': '.jpg',
              'video/mp4': '.mp4',
              'audio/mpeg': '.mp3',
            } as Record<string, string>
          )[blob.type] || ''
    link.download = asset.name.replace(/[\\/:*?"<>|]/g, '_') + (/\.\w+$/.test(asset.name) ? '' : extension)
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '下载失败，可能是资源不可用或跨域限制'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="素材中心"
      description="统一检索创作资产，追溯来源与关联任务。"
      eyebrow="ASSET LIBRARY"
      ><span class="chip">{{ store.db.assets.length }} 项资产</span></PageHeader
    >
    <a-alert
      v-if="error || store.error"
      type="error"
      show-icon
      :message="error || String(store.error)"
    />
    <section class="panel filters">
      <a-input
        v-model:value="query"
        placeholder="搜索名称或标签"
        allow-clear
        aria-label="搜索素材"
      />
      <a-select
        v-model:value="type"
        aria-label="素材类型"
        :options="[
          { value: '', label: '全部类型' },
          ...['图片', '视频', '音频', '角色', '剧本', '分镜', '文章'].map((v) => ({ value: v, label: v })),
        ]"
      />
      <a-select
        v-model:value="tag"
        aria-label="素材标签"
        :options="[{ value: '', label: '全部标签' }, ...tags.map((v) => ({ value: v, label: v }))]"
      />
    </section>
    <div
      v-if="!assets.length"
      class="panel empty-state"
    >
      {{ store.loading ? '正在加载素材…' : '暂无匹配素材。调整筛选条件，或完成创作任务后再来查看。' }}
    </div>
    <div class="asset-grid">
      <article
        v-for="asset in assets"
        :key="asset.id"
        class="panel asset"
      >
        <button
          class="cover"
          :aria-label="`预览 ${asset.name}`"
          @click="openPreview(asset)"
        >
          <img
            v-if="safeUrl(asset.cover)"
            :src="safeUrl(asset.cover)"
            alt=""
            loading="lazy"
          />
          <span v-else>{{ asset.type }}</span
          ><span class="cover-type">{{ asset.type }}</span>
        </button>
        <div class="details">
          <h3>{{ asset.name }}</h3>
          <div class="tags">
            <span
              v-for="t in asset.tags"
              :key="t"
              class="chip"
              >{{ t }}</span
            >
          </div>
          <p class="muted">
            {{ asset.model || '未标注模型' }} ·
            {{ asset.resolution || (asset.duration ? `${asset.duration}s` : '—') }}
          </p>
          <p class="muted">
            关联任务：{{ store.db.tasks.find((t) => t.id === asset.taskId)?.title || asset.taskId || '无' }}
          </p>
          <div class="actions">
            <a-button
              size="small"
              @click="openPreview(asset)"
              >预览</a-button
            ><a-button
              size="small"
              :loading="busy === asset.id"
              :disabled="!!busy"
              @click="download(asset)"
              >下载</a-button
            >
            <a-popconfirm
              title="确定删除此素材？此操作不可撤销。"
              ok-text="删除"
              cancel-text="取消"
              :disabled="!!busy"
              @confirm="remove(asset)"
              ><a-button
                size="small"
                danger
                :disabled="!!busy"
                >删除</a-button
              ></a-popconfirm
            >
          </div>
        </div>
      </article>
    </div>
    <a-modal
      v-model:open="open"
      :title="preview?.name"
      :footer="null"
      width="min(760px, calc(100vw - 24px))"
      destroy-on-close
    >
      <div
        v-if="preview"
        class="preview"
      >
        <AuthorizedAsset v-if="!isMockMode" :id="preview.id" :name="preview.name" />
        <img
          v-else-if="preview.type === '图片' && safeUrl(preview.url)"
          :src="safeUrl(preview.url)"
          :alt="preview.name"
        />
        <video
          v-else-if="preview.type === '视频' && safeUrl(preview.url)"
          :src="safeUrl(preview.url)"
          controls
          preload="metadata"
        />
        <audio
          v-else-if="preview.type === '音频' && safeUrl(preview.url)"
          :src="safeUrl(preview.url)"
          controls
          preload="metadata"
        />
        <pre v-else-if="preview.content !== undefined">{{ preview.content }}</pre>
        <img
          v-else-if="safeUrl(preview.cover)"
          :src="safeUrl(preview.cover)"
          :alt="preview.name"
        />
        <div
          v-else
          class="empty-state"
        >
          此素材暂无可用预览。
        </div>
        <p class="muted">媒体无法加载时，请确认资源仍然可用。</p>
        <dl>
          <dt>创建时间</dt>
          <dd>{{ preview.createdAt }}</dd>
          <dt>模型</dt>
          <dd>{{ preview.model || '未标注' }}</dd>
          <dt>关联任务</dt>
          <dd>
            <router-link
              v-if="task"
              :to="`/tasks/${encodeURIComponent(task.id)}`"
              >{{ task.title }}</router-link
            ><span v-else>{{ preview.taskId || '未关联' }}</span>
          </dd>
          <template v-if="task"
            ><dt>任务状态</dt>
            <dd>{{ taskStatusLabel(task.status) }} · {{ task.progress }}%</dd></template
          >
        </dl>
        <AssetTracePanel
          :asset="preview"
          :db="store.db"
        />
        <a-button
          :loading="!!busy"
          :disabled="!!busy"
          @click="download(preview)"
          >下载素材</a-button
        >
        <a-alert
          v-if="error"
          class="download-error"
          type="error"
          :message="error"
        />
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px 180px;
  gap: 12px;
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: 20px;
}
.asset {
  overflow: hidden;
  padding: 0;
  min-width: 0;
}
.cover {
  position: relative;
  border: 0;
  background: #f1f0f8;
  width: 100%;
  height: 175px;
  cursor: pointer;
  color: #635bdb;
  font-size: 24px;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-type {
  position: absolute;
  bottom: 10px;
  left: 12px;
  font-size: 12px;
  background: #fff;
  padding: 4px 9px;
  border-radius: 6px;
  color: #555;
}
.details {
  padding: 20px;
}
.details h3 {
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.tags,
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.details p {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.preview {
  padding-top: 16px;
  overflow-wrap: anywhere;
}
.preview img,
.preview video {
  display: block;
  max-width: 100%;
  max-height: 420px;
  margin: auto;
}
.preview audio {
  width: 100%;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f7f7fb;
  padding: 16px;
  max-height: 440px;
  overflow: auto;
}
dl {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 12px;
}
dt {
  color: #888;
}
dd {
  margin: 0;
}
.download-error {
  margin-top: 12px;
}
@media (max-width: 650px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
