<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MenuOutlined, BellOutlined, AppstoreOutlined, VideoCameraOutlined, FireOutlined, UnorderedListOutlined, PictureOutlined, DeploymentUnitOutlined, ApiOutlined, SettingOutlined, BarChartOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons-vue'
import { useFactoryStore } from '../stores/factory'
import EngineStatus from '../components/EngineStatus.vue'
import AccountMenu from '../components/AccountMenu.vue'
import { isMockMode } from '../api/mode'
import { useAuthStore } from '../stores/auth'
import { routePermission } from '../router/permissions'
const auth = useAuthStore()
const route = useRoute(); const router = useRouter(); const drawer = ref(false)
const store = useFactoryStore()
const activeTasks = computed(() => store.db.tasks.filter(t => ['RUNNING', 'QUEUED', 'REVIEWING'].includes(t.status)).length)
const navigationPath = computed(() => route.path.startsWith('/articles') || route.path === '/publishing' ? '/hot-topics' : route.path)
const nav = computed(() => [
  { label: '工作台', path: '/', icon: AppstoreOutlined },
  { label: 'AI 视频工厂', path: '/video', icon: VideoCameraOutlined },
  { label: 'AI 热点工厂', path: '/hot-topics', icon: FireOutlined },
  { label: '任务中心', path: '/tasks', icon: UnorderedListOutlined },
  { label: '内容资产', path: '/assets', icon: PictureOutlined },
  { label: '工作流', path: '/workflows', icon: DeploymentUnitOutlined },
  { label: 'ComfyUI引擎', path: '/comfyui', icon: ThunderboltOutlined },
  { label: 'AI 模型', path: '/models', icon: ApiOutlined },
  { label: '数据统计', path: '/analytics', icon: BarChartOutlined },
    ...[
    { label: '用户管理', path: '/users', icon: SettingOutlined },
    { label: '角色权限', path: '/roles', icon: SettingOutlined },
    { label: 'AI 服务配置', path: '/ai-services', icon: ApiOutlined },
    { label: '审计日志', path: '/audit-logs', icon: UnorderedListOutlined },
  ],
].filter(item => auth.can(routePermission(item.path) ?? '')))
const go = (path: string) => { router.push(path); drawer.value = false }
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ open: drawer }">
      <div class="brand"><div class="brand-mark">✦</div><div><strong>AI 内容</strong><span>创作工厂</span></div><button aria-label="关闭导航" class="mobile-close" @click="drawer = false"><CloseOutlined /></button></div>
      <div class="system-pill"><span class="online-dot"></span><span>{{ isMockMode ? '模拟引擎 · 本地演示' : '后端接口 · 真实模式' }}</span><small>{{ isMockMode ? '本地' : '服务端' }}</small></div>
      <div class="nav-label">生产空间</div>
      <nav><button v-for="item in nav" :key="item.path" :class="{ active: navigationPath === item.path || (item.path !== '/' && navigationPath.startsWith(item.path)) }" @click="go(item.path)"><component :is="item.icon" aria-hidden="true" /><span>{{ item.label }}</span><span v-if="item.path === '/tasks'" class="nav-count">{{ activeTasks }}</span></button></nav>
      <div class="sidebar-bottom"><div class="nav-label">系统</div><button v-if="auth.can('providers.read')" :class="{ active: route.path === '/settings' }" @click="go('/settings')"><SettingOutlined aria-hidden="true" /><span>系统设置</span></button><div class="user-card"><div class="avatar">{{ isMockMode ? '演' : '我' }}</div><div><strong>{{ isMockMode ? 'Mock 演示账户' : auth.session?.user?.displayName || auth.session?.user?.username || '游客' }}</strong><small>{{ isMockMode ? '模拟身份 · 非真实登录' : auth.session?.role?.name || '未登录' }}</small></div></div></div>
    </aside>
    <div v-if="drawer" class="scrim" @click="drawer = false"></div>
    <main class="main-shell">
      <div class="topbar"><button aria-label="打开导航" class="menu-trigger" @click="drawer = true"><MenuOutlined /></button><div class="breadcrumbs"><span>内容工厂</span><b>/</b><strong>{{ route.path === '/engine' ? '引擎中心' : route.path === '/settings' ? '系统设置' : route.path === '/profile' ? '个人资料' : route.path === '/change-password' ? '修改密码' : nav.find(item => route.path === item.path || (item.path !== '/' && route.path.startsWith(item.path)))?.label || '工作台' }}</strong></div><div class="top-actions"><EngineStatus v-if="auth.can('providers.read')" /><button v-if="auth.can('tasks.read')" aria-label="查看任务通知" class="icon-button" @click="go('/tasks')"><BellOutlined /><em></em></button><AccountMenu /></div></div>
      <div class="page-content">
        <div v-if="route.path.startsWith('/video') && auth.can('tasks.read')" class="production-subnav">
          <router-link to="/video">视频任务</router-link>
          <router-link to="/video/library/scripts">剧本</router-link>
          <router-link to="/video/library/characters">角色</router-link>
          <router-link to="/video/library/storyboards">分镜</router-link>
          <router-link v-if="auth.can('assets.read')" to="/assets">视频素材 / 成片</router-link>
        </div>
        <div v-if="route.path.startsWith('/hot-topics') || route.path.startsWith('/articles') || route.path === '/publishing'" class="production-subnav">
          <router-link to="/hot-topics">热点 / 分析 / 选题</router-link>
          <router-link to="/articles">文章库</router-link>
          <router-link v-if="auth.can('assets.read')" to="/assets">内容配图</router-link>
          <router-link to="/publishing">发布与交付</router-link>
        </div>
        <router-view />
      </div>
    </main>
  </div>
</template>
