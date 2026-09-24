<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useFactoryStore } from './stores/factory'
import { useAuthStore } from './stores/auth'
import UnavailablePage from './pages/auth/UnavailablePage.vue'
import { useRouter } from 'vue-router'
import { developmentOnly, isMockMode, switchDevelopmentMode } from './api/mode'
const router = useRouter()
const auth = useAuthStore()
const store = useFactoryStore()
const online = ref(navigator.onLine)
const updateNetwork = () => {
  online.value = navigator.onLine
}
onMounted(() => {
  auth.load().then(() => {
    if (!auth.mustChangePassword && auth.can('workspace.read')) return store.init()
  }).catch(() => undefined)
  window.addEventListener('online', updateNetwork)
  window.addEventListener('offline', updateNetwork)
})
onUnmounted(() => {
  window.removeEventListener('online', updateNetwork)
  window.removeEventListener('offline', updateNetwork)
})
</script>
<template>
  <a-config-provider
    :locale="zhCN"
    :auto-insert-space-in-button="false"
    :theme="{ token: { colorPrimary: '#635bdb', borderRadius: 8, fontFamily: 'inherit' } }"
  >
    <div v-if="developmentOnly" class="development-banner" role="status" data-testid="development-mode">
      <strong>{{ isMockMode ? 'DEVELOPMENT DEMO · Mock 模拟数据 · 免登录 / 全部本地权限' : 'DEVELOPMENT REAL · 真实后端 / 必须登录' }}</strong>
      <span>{{ isMockMode ? '不连接真实业务 API，不代表真实生成或发布成功。' : '服务失败不会伪造成功；可主动切换隔离的演示工作区。' }}</span>
      <a-button size="small" @click="switchDevelopmentMode(isMockMode ? 'real' : 'demo')">{{ isMockMode ? '切换真实模式' : '选择 Mock 演示' }}</a-button>
    </div>
    <div
      v-if="!online"
      class="network-banner"
      role="alert"
    >
      网络连接已断开 · 本地编辑仍可使用，外部媒体等待重新连接。
    </div>
    <div
      v-if="store.error"
      class="network-banner error-banner"
      role="alert"
    >
      {{ store.error }}
      <a-button
        size="small"
        @click="store.refresh().catch(() => undefined)"
        >重试加载</a-button
      >
    </div>
    <UnavailablePage v-if="auth.error && router.currentRoute.value.path !== '/unavailable'" />
    <main v-else-if="!isMockMode && !auth.ready && !router.currentRoute.value.matched.length" class="startup-loading" role="status">
      <h1>正在连接应用</h1>
      <p>正在检查后端与会话。服务不可用时将显示离线状态，不会切换到模拟数据。</p>
    </main>
    <router-view v-else />
  </a-config-provider>
</template>
<style scoped>
.startup-loading { padding: 64px 32px; max-width: 760px; margin: auto; }
.development-banner { position: sticky; top: 0; z-index: 90; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 20px; background: #fff3cd; color: #664d03; border-bottom: 2px solid #dca600; }
</style>
