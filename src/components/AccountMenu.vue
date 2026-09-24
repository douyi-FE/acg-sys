<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useFactoryStore } from '../stores/factory'
import { developmentOnly, isMockMode, switchDevelopmentMode } from '../api/mode'

const auth = useAuthStore()
const store = useFactoryStore()
const router = useRouter()
const route = useRoute()
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
let pinned = false
const busy = ref(false)
const name = computed(() => isMockMode ? 'Mock 演示账户' : auth.session?.user?.displayName || auth.session?.user?.username || '未登录')
const role = computed(() => isMockMode ? '模拟身份 · 非真实登录' : auth.session?.role?.name || '无角色')
function close(focus = false) { open.value = false; pinned = false; if (focus) trigger.value?.focus() }
function toggle() { if (pinned) close(); else { pinned = true; open.value = true } }
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) close() }
function hover(event: PointerEvent) {
  if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) open.value = true
}
function leave(event: PointerEvent) {
  if (event.pointerType === 'mouse' && !pinned && !root.value?.contains(document.activeElement)) close()
}
async function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  open.value = true
  await nextTick()
  const items = [...root.value!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
    event.key === 'ArrowDown' ? (index + 1) % items.length : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length)
  items[next]?.focus()
}
function focusOut(event: FocusEvent) { if (!root.value?.contains(event.relatedTarget as Node)) close() }
async function go(path: string) { close(); await router.push(path) }
async function logout() {
  if (isMockMode || busy.value) return
  busy.value = true
  store.reset()
  const request = auth.logout()
  close()
  await router.replace('/login')
  try { await request } finally { store.reset(); busy.value = false }
}
watch(() => route.fullPath, () => close())
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="account-menu" @pointerenter="hover" @pointerleave="leave" @keydown="keyboard" @focusout="focusOut">
    <button ref="trigger" class="avatar small" aria-label="账户菜单" aria-haspopup="menu" aria-controls="account-dropdown" :aria-expanded="open" @click="toggle">{{ isMockMode ? '演' : name.slice(0, 1) }}</button>
    <div v-if="open" id="account-dropdown" class="account-dropdown" role="menu" aria-label="账户操作">
      <div class="account-identity"><strong>{{ name }}</strong><span>{{ role }}</span><small v-if="!isMockMode">{{ auth.session?.user?.username }}<br>{{ auth.session?.user?.email }}</small></div>
      <template v-if="!isMockMode && auth.session?.user">
        <button role="menuitem" @click="go('/profile')">个人资料</button>
        <button role="menuitem" @click="go('/change-password')">修改密码</button>
        <button role="menuitem" :disabled="busy" @click="logout">退出登录</button>
      </template>
      <button v-else-if="!isMockMode" role="menuitem" @click="go('/login')">登录</button>
      <p v-if="isMockMode">演示不提供真实资料修改、改密或退出登录。</p>
      <button v-if="developmentOnly" role="menuitem" @click="switchDevelopmentMode(isMockMode ? 'real' : 'demo')">{{ isMockMode ? '切换真实模式' : '选择 Mock 演示' }}</button>
    </div>
  </div>
</template>

<style scoped>
.account-menu { position: relative; }
.account-dropdown { position: absolute; right: 0; top: 100%; z-index: 100; width: min(280px, calc(100vw - 32px)); padding: 12px; background: white; color: #202035; border: 1px solid #dedee8; border-radius: 10px; box-shadow: 0 8px 28px #20203522; }
.account-identity { display: grid; gap: 6px; padding: 8px; overflow-wrap: anywhere; border-bottom: 1px solid #eee; }
.account-dropdown button { display: block; width: 100%; text-align: left; padding: 10px; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
.account-dropdown button:hover, .account-dropdown button:focus-visible { background: #efedff; outline: 2px solid #635bdb; }
.account-dropdown p, .account-identity span, .account-identity small { font-size: 12px; color: #626277; }
</style>
