import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import { useAuthStore } from '../stores/auth'
import { routePermission } from './permissions'
import { isMockMode } from '../api/mode'
import UnavailablePage from '../pages/auth/UnavailablePage.vue'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/public', component: () => import('../pages/auth/PublicPage.vue') },
    { path: '/login', component: () => import('../pages/auth/SessionPage.vue') },
    { path: '/change-password', component: () => import('../pages/auth/SessionPage.vue') },
    { path: '/access-denied', component: () => import('../pages/auth/AccessDenied.vue') },
    { path: '/unavailable', component: UnavailablePage },
    {
    path: '/',
    component: AppLayout,
    children: [
      { path: 'profile', component: () => import('../pages/auth/ProfilePage.vue') },
      { path: 'users', component: () => import('../pages/admin/AccessManagement.vue') },
      { path: 'roles', component: () => import('../pages/admin/AccessManagement.vue') },
      { path: 'audit-logs', component: () => import('../pages/admin/AccessManagement.vue') },
      { path: 'ai-services', component: () => import('../pages/admin/AiServices.vue') },
      { path: '', component: () => import('../pages/dashboard/Dashboard.vue') },
      { path: 'video', component: () => import('../pages/video/VideoFactory.vue') },
      { path: 'video/new', component: () => isMockMode ? import('../pages/video/CreateVideo.vue') : import('../pages/video/RealCreation.vue') },
      { path: 'video/library/:kind(scripts|characters|storyboards)', component: () => import('../pages/library/ProductionLibrary.vue') },
      { path: 'tasks', component: () => import('../pages/tasks/TaskCenter.vue') },
      { path: 'tasks/:id', component: () => import('../pages/tasks/TaskDetail.vue') },
      { path: 'hot-topics', component: () => import('../pages/hot-topic/HotTopicFactory.vue') },
      { path: 'articles', component: () => import('../pages/library/ArticleList.vue') },
      { path: 'publishing', component: () => import('../pages/library/PublishingCenter.vue') },
      { path: 'articles/:id', component: () => import('../pages/hot-topic/ArticleEditor.vue') },
      { path: 'assets', component: () => import('../pages/assets/AssetCenter.vue') },
      { path: 'workflows', component: () => import('../pages/workflows/WorkflowCenter.vue') },
      { path: 'comfyui', component: () => import('../pages/comfyui/ComfyUICenter.vue') },
      { path: 'comfyui/executions/:id', component: () => import('../pages/comfyui/ExecutionDetail.vue') },
      { path: 'engine', component: () => import('../pages/engine/EngineCenter.vue') },
      { path: 'models', component: () => import('../pages/models/ModelCenter.vue') },
      { path: 'analytics', component: () => import('../pages/analytics/AnalyticsPage.vue') },
      { path: 'settings', component: () => import('../pages/settings/SettingsPage.vue') },
      { path: ':pathMatch(.*)*', component: () => import('../pages/NotFound.vue') },
    ],
  }],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.path === '/login' || to.path === '/access-denied' || to.path === '/public' || to.path === '/unavailable') return true
  try { if (!auth.ready) await auth.load() }
  catch { return '/unavailable' }
  if (!isMockMode && !auth.session) return '/login'
  if (auth.mustChangePassword && to.path !== '/change-password') return '/change-password'
  if (to.path === '/change-password' && !auth.session?.user) return '/login'
  const permission = routePermission(to.path)
  return !permission || auth.can(permission) ? true : '/access-denied'
})
export default router
