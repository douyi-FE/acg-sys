<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { assetBlob } from '../api/session'
import SafeMarkdown from './SafeMarkdown.vue'
import JsonCode from './JsonCode.vue'
const props = defineProps<{ id: string; name?: string }>()
const url = ref('')
const mime = ref('')
const text = ref('')
const error = ref('')
const isMarkdown = computed(() => mime.value === 'text/markdown' || mime.value === 'text/x-markdown' ||
  (mime.value === 'text/plain' && /\.(md|markdown)$/i.test(props.name || '')))
let sequence = 0
function revoke() { if (url.value) URL.revokeObjectURL(url.value); url.value = '' }
watch(() => props.id, async (id) => {
  const current = ++sequence
  revoke(); error.value = ''; text.value = ''; mime.value = ''
  try {
    const blob = await assetBlob(id)
    if (current !== sequence) return
    mime.value = blob.type.split(';')[0]!.trim().toLowerCase()
    if (blob.type.startsWith('text/') || blob.type.includes('json')) {
      const content = await blob.text()
      if (current !== sequence) return
      text.value = content
    }
    if (current === sequence) url.value = URL.createObjectURL(blob)
  } catch (cause) { if (current === sequence) error.value = cause instanceof Error ? cause.message : '资产加载失败' }
}, { immediate: true })
onBeforeUnmount(() => { sequence++; revoke() })
</script>
<template>
  <div class="authorized-asset">
    <p v-if="error" role="alert" class="asset-error">{{ error }}</p>
    <template v-else-if="url">
      <div v-if="mime.startsWith('video/')" class="video-frame">
        <video :src="url" controls preload="metadata" @error="error = '实际视频资产无法播放：文件格式不受支持或内容不可用，无替代媒体。'" />
      </div>
      <audio v-else-if="mime.startsWith('audio/')" :src="url" controls />
      <img v-else-if="mime.startsWith('image/')" :src="url" :alt="name || id" @error="error = '实际图片资产无法显示，无替代图片。'" />
      <SafeMarkdown v-else-if="text && isMarkdown" :source="text" />
      <JsonCode v-else-if="text && mime.includes('json')" :value="text" />
      <pre v-else-if="text">{{ text }}</pre>
      <p v-else>资产为空或格式不支持内联预览，可下载原始授权文件；无替代内容。</p>
      <a :href="url" :download="name || id">下载授权资产</a>
    </template>
    <p v-else role="status">正在读取后端资产…</p>
  </div>
</template>
<style scoped>
.authorized-asset { min-width: 0; max-width: 100%; }
video,img,audio { max-width:100%; max-height:520px; display:block; }
.video-frame {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
  background: #181824;
}
video {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(72vh, 720px);
  object-fit: contain;
  background: #181824;
  border-radius: 10px;
}
img { height:auto; object-fit:contain; margin:auto; border-radius:8px; }
.authorized-asset > pre { max-height:380px; overflow:auto; white-space:pre; overflow-wrap:normal; line-height:1.8; }
.authorized-asset > a { display:inline-block; margin-top:16px; font-size:12px; }
.asset-error { color:#b64343; border-left:3px solid #e7aaaa; padding:8px 12px; }
</style>
