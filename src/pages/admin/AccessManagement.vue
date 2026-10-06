<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { adminRequest as serverRequest } from '../../services/demo-admin'
import { isMockMode } from '../../api/mode'
import { segment } from '../../api/http'
import { useAuthStore } from '../../stores/auth'
import PageHeader from '../../components/PageHeader.vue'
import { useFieldValidation, textField, usernameError, passwordError } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
interface Permission { id: string; name?: string; description?: string }
interface Role { id: string; name: string; description?: string; enabled: boolean; permissions?: (Permission | { permissionId: string })[] }
interface User { id: string; username: string; displayName?: string; roleId: string; enabled: boolean; forceChangePassword: boolean }
interface Audit { id: string; action: string; userId?: string; createdAt: string; resource?: string }
const route = useRoute()
const auth = useAuthStore()
const kind = computed(() => route.path.slice(1))
const title = computed(() => ({ users: '用户管理', roles: '角色与权限', 'audit-logs': '审计日志' })[kind.value])
const users = ref<User[]>([])
const roles = ref<Role[]>([])
const permissions = ref<Permission[]>([])
const audits = ref<Audit[]>([])
const error = ref('')
const busy = ref(false)
const open = ref(false)
const id = ref('')
const form = ref({ username: '', displayName: '', password: '', roleId: '', enabled: true, forceChangePassword: true, name: '', description: '', permissionIds: [] as string[] })
const search = ref('')
const page = ref(1)
const total = ref(0)
type List<T> = T[] | { items: T[]; total: number }
const items = <T,>(value: List<T>) => Array.isArray(value) ? value : value.items
const roleName = (roleId: string) => roles.value.find(role => role.id === roleId)?.name || '未分配角色'
const userStats = computed(() => ({
  total: total.value,
  enabled: users.value.filter(user => user.enabled).length,
  pending: users.value.filter(user => user.forceChangePassword).length,
}))
const roleStats = computed(() => ({
  total: roles.value.length,
  enabled: roles.value.filter(role => role.enabled).length,
  permissions: new Set(roles.value.flatMap(role => role.permissions ?? []).map(permission => 'permissionId' in permission ? permission.permissionId : permission.id)).size,
}))
async function load() {
  busy.value = true; error.value = ''
  try {
    if (kind.value === 'users') {
      const result = items(await serverRequest<List<User>>('/users')).filter(row => row.username.includes(search.value))
      users.value = result.slice((page.value - 1) * 20, page.value * 20); total.value = result.length
      if (auth.can('roles.read')) roles.value = items(await serverRequest<List<Role>>('/roles'))
    } else if (kind.value === 'roles') {
      roles.value = items(await serverRequest<List<Role>>('/roles'))
      if (auth.can('permissions.read')) permissions.value = items(await serverRequest<List<Permission>>('/permissions'))
    } else {
      const result = items(await serverRequest<List<Audit>>('/audit-logs')).filter(row => row.action.includes(search.value))
      audits.value = result.slice((page.value - 1) * 20, page.value * 20); total.value = result.length
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载失败' }
  finally { busy.value = false }
}
function edit(row?: User | Role) {
  id.value = row?.id ?? ''
  form.value = { username: '', displayName: '', password: '', roleId: '', enabled: true, forceChangePassword: true, name: '', description: '', permissionIds: [] }
  if (row && 'username' in row) Object.assign(form.value, { username: row.username, displayName: row.displayName ?? '', roleId: row.roleId, enabled: row.enabled, forceChangePassword: row.forceChangePassword })
  if (row && 'name' in row) Object.assign(form.value, { name: row.name, description: row.description ?? '', enabled: row.enabled, permissionIds: row.permissions?.map(p => 'permissionId' in p ? p.permissionId : p.id) ?? [] })
  open.value = true
}
async function save() {
  if (busy.value || !validateFields()) return
  busy.value = true; error.value = ''
  try {
    const f = form.value
    const payload = kind.value === 'users'
      ? id.value ? { roleId: f.roleId, enabled: f.enabled } : { username: f.username, roleId: f.roleId, password: f.password }
      : { name: f.name, ...(f.description ? { description: f.description } : {}), enabled: f.enabled, permissions: f.permissionIds }
    await serverRequest(`/${kind.value}${id.value ? `/${segment(id.value)}` : ''}`, id.value ? 'PATCH' : 'POST', payload)
    form.value.password = ''; open.value = false
    await auth.load(); await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
async function remove(rowId: string) {
  try { await serverRequest(`/${kind.value}/${segment(rowId)}`, 'DELETE'); await auth.load(); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' }
}
watch(kind, () => { page.value = 1; open.value = false; void load() }, { immediate: true })
</script>
<template>
  <div class="page-stack" :class="{ 'users-page': kind === 'users' }">
    <PageHeader :title="title || '权限管理'" :description="isMockMode ? 'Mock 本地管理示例；刷新重置，不创建真实账号或权限。请勿输入真实密码。' : '数据与授权来自后端；权限变更后重新读取当前会话。'" />
    <a-alert v-if="error" type="error" :message="error" />
    <section v-if="kind === 'users'" class="user-stats">
      <article class="stat-card"><span>用户总数</span><strong>{{ userStats.total }}</strong><small>当前工作空间</small></article>
      <article class="stat-card"><span>已启用</span><strong>{{ userStats.enabled }}</strong><small>可正常登录</small></article>
      <article class="stat-card"><span>待改密</span><strong>{{ userStats.pending }}</strong><small>首次登录需修改</small></article>
    </section>
    <section v-if="kind === 'roles'" class="user-stats role-stats">
      <article class="stat-card"><span>角色总数</span><strong>{{ roleStats.total }}</strong><small>当前工作空间</small></article>
      <article class="stat-card"><span>已启用</span><strong>{{ roleStats.enabled }}</strong><small>可被分配</small></article>
      <article class="stat-card"><span>已使用权限</span><strong>{{ roleStats.permissions }}</strong><small>去重后权限项</small></article>
    </section>
    <section class="panel toolbar management-toolbar">
      <div class="toolbar-title">
        <span class="toolbar-kicker">{{ kind === 'users' ? 'TEAM DIRECTORY' : kind === 'roles' ? 'ACCESS CONTROL' : 'AUDIT TRAIL' }}</span>
        <strong>{{ kind === 'users' ? '团队成员' : kind === 'roles' ? '权限角色' : '操作记录' }}</strong>
      </div>
      <a-input v-model:value="search" aria-label="搜索管理记录" placeholder="搜索" @press-enter="page = 1; load()" />
      <a-button :loading="busy" @click="load">刷新</a-button>
      <a-button v-if="kind !== 'audit-logs' && auth.can(`${kind}.create`)" type="primary" @click="edit()">{{ kind === 'users' ? '添加成员' : '新增' }}</a-button>
    </section>
    <div class="admin-cards" :class="{ 'user-cards': kind === 'users', 'role-cards': kind === 'roles' }">
      <article v-for="row in kind === 'users' ? users : kind === 'roles' ? roles : audits" :key="row.id" class="panel">
        <template v-if="'username' in row">
          <div class="user-card-head">
            <div class="avatar">{{ (row.displayName || row.username).slice(0, 1).toUpperCase() }}</div>
            <div><h3>{{ row.displayName || row.username }}</h3><p class="username">@{{ row.username }}</p></div>
            <span class="status-pill" :class="row.enabled ? 'is-enabled' : 'is-disabled'">{{ row.enabled ? '已启用' : '已停用' }}</span>
          </div>
          <div class="user-card-meta">
            <span><small>角色</small><b>{{ roleName(row.roleId) }}</b></span>
            <span><small>账户状态</small><b>{{ row.forceChangePassword ? '待完成首次改密' : '密码已设置' }}</b></span>
          </div>
          <p class="muted user-id">{{ row.id }}</p>
        </template>
        <template v-else>
          <template v-if="'name' in row">
            <div class="role-card-head">
              <div class="role-icon">◆</div>
              <div><h3>{{ row.name }}</h3><p class="muted">{{ row.description || '暂无角色说明' }}</p></div>
              <span class="status-pill" :class="row.enabled ? 'is-enabled' : 'is-disabled'">{{ row.enabled ? '已启用' : '已停用' }}</span>
            </div>
            <p class="muted role-id">{{ row.id }}</p>
          </template>
          <template v-else>
            <h3>{{ row.action }}</h3>
            <p class="muted">{{ row.id }}</p>
          </template>
        </template>
        <template v-if="'action' in row"><p>{{ row.createdAt }}</p><p>操作者：{{ row.userId || '未关联' }}</p></template>
        <template v-else-if="'name' in row">
          <p>{{ row.enabled ? '启用' : '停用' }}</p>
          <div class="role-actions">
            <a-button v-if="auth.can(`${kind}.update`)" @click="edit(row)">编辑角色</a-button>
            <a-popconfirm title="确定删除？后端将校验关联约束。" @confirm="remove(row.id)"><a-button v-if="auth.can(`${kind}.delete`)" danger>删除角色</a-button></a-popconfirm>
          </div>
        </template>
        <div v-else class="card-actions">
          <a-button v-if="auth.can(`${kind}.update`)" type="text" @click="edit(row)">编辑成员</a-button>
          <a-popconfirm title="确定删除该成员？后端将校验关联约束。" @confirm="remove(row.id)"><a-button v-if="auth.can(`${kind}.delete`)" type="text" danger>删除成员</a-button></a-popconfirm>
        </div>
      </article>
    </div>
    <div v-if="kind !== 'roles'" class="toolbar"><a-button :disabled="page <= 1" @click="page--; load()">上一页</a-button><span>第 {{ page }} 页 / 共 {{ total }} 条</span><a-button :disabled="page * 20 >= total" @click="page++; load()">下一页</a-button></div>
    <a-drawer v-model:open="open" :title="id ? '编辑' : '新增'" width="min(520px,100vw)">
      <a-alert v-if="error" type="error" :message="error" />
      <form class="editor" @submit.prevent="save">
        <template v-if="kind === 'users'">
          <label v-field="usernameError(form.username)">用户名<a-input v-model:value="form.username" :disabled="!!id" /></label>
          <label v-if="!id" v-field="passwordError(form.password)">初始密码<a-input-password v-model:value="form.password" autocomplete="new-password" /></label>
          <label v-field="roles.some(r => r.id === form.roleId && r.enabled) ? undefined : '请选择已启用角色'">角色<a-select v-model:value="form.roleId" :options="roles.map(r => ({ value: r.id, label: r.name, disabled: !r.enabled }))" /></label>
          <p v-if="!id">新账户首次登录必须修改密码。</p>
        </template>
        <template v-else>
          <label v-field="textField(form.name, '角色名称', 100) || (['ADMIN', 'GUEST'].includes(form.name.trim().toUpperCase()) ? '不可使用保留角色名' : undefined)">角色名称<a-input v-model:value="form.name" /></label>
          <label v-field="textField(form.description, '说明', 500, true)">说明<a-textarea v-model:value="form.description" /></label>
          <label>权限<a-select v-model:value="form.permissionIds" mode="multiple" :options="permissions.map(p => ({ value: p.id, label: p.description || p.name || p.id }))" /></label>
        </template>
        <a-checkbox v-if="id || kind === 'roles'" v-model:checked="form.enabled">启用</a-checkbox>
        <a-button type="primary" html-type="submit" :loading="busy">{{ isMockMode ? '保存 Mock 示例' : '保存到后端' }}</a-button>
      </form>
    </a-drawer>
  </div>
</template>
<style scoped>
.admin-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr)); gap:16px; }
.user-cards { grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)); }
.toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
.management-toolbar { padding: 18px 20px; border: 1px solid #e5e2f0; }
.toolbar-title { display: grid; gap: 5px; flex: 1; min-width: 180px; }
.toolbar-kicker { color: #7770d8; font-size: 10px; font-weight: 750; letter-spacing: .16em; }
.toolbar-title strong { color: #29263f; font-size: 18px; }
.toolbar .ant-input { max-width:320px; }
.editor, label { display:grid; gap:12px; }
.editor { gap:24px; } p { overflow-wrap:anywhere; }
.user-stats { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; }
.stat-card { padding:20px 22px; border:1px solid #e5e2f0; border-radius:14px; background:linear-gradient(135deg,#fff,#faf9ff); }
.stat-card span, .stat-card small { display:block; color:#89869b; font-size:12px; }
.stat-card strong { display:block; margin:7px 0 4px; color:#635bdb; font-size:30px; letter-spacing:-.04em; }
.user-cards > article { padding:22px; border:1px solid #e5e2f0; transition:transform .2s, box-shadow .2s, border-color .2s; }
.user-cards > article:hover { transform:translateY(-2px); border-color:#c9c3f0; box-shadow:0 12px 28px rgba(74,63,145,.09); }
.role-cards > article { padding:22px; border:1px solid #e5e2f0; }
.role-cards > article:hover { border-color:#c9c3f0; box-shadow:0 12px 28px rgba(74,63,145,.08); }
.role-card-head { display:flex; align-items:flex-start; gap:12px; min-width:0; }
.role-card-head > div:nth-child(2) { min-width:0; flex:1; }.role-card-head h3 { margin:0 0 5px; color:#29263f; }.role-card-head p { margin:0; font-size:12px; line-height:1.6; }
.role-icon { display:grid; flex:none; place-items:center; width:40px; height:40px; border-radius:12px; color:#635bdb; background:#f0eeff; }
.role-id { margin:20px 0 0; padding-top:14px; border-top:1px solid #efedf5; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px; }
.role-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:18px; padding-top:14px; border-top:1px solid #efedf5; }
.user-card-head { display:flex; align-items:center; gap:13px; min-width:0; }
.user-card-head h3 { margin:0 0 4px; color:#28253d; }
.avatar { display:grid; flex:none; place-items:center; width:44px; height:44px; border-radius:13px; color:#fff; background:linear-gradient(135deg,#7568f4,#9b72db); font-size:18px; font-weight:700; }
.username { margin:0; color:#918da4; font-size:12px; }
.status-pill { margin-left:auto; padding:5px 9px; border-radius:999px; font-size:11px; white-space:nowrap; }
.is-enabled { color:#16734d; background:#e7f7ee; }.is-disabled { color:#9b4c4c; background:#fcecec; }
.user-card-meta { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:22px 0 16px; padding:14px 0; border-top:1px solid #efedf5; border-bottom:1px solid #efedf5; }
.user-card-meta span { display:grid; gap:5px; min-width:0; }.user-card-meta small { color:#9692a7; font-size:11px; }.user-card-meta b { overflow:hidden; color:#4d4a61; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.user-id { margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px; }
.card-actions { display:flex; gap:4px; margin-top:16px; padding-top:12px; border-top:1px solid #efedf5; }
@media (max-width: 600px) { .user-stats { gap:8px; }.stat-card { padding:14px 12px; }.stat-card strong { font-size:24px; }.user-card-meta { grid-template-columns:1fr; }.management-toolbar { align-items:stretch; }.management-toolbar .ant-input { max-width:none; flex:1 1 100%; } }
</style>
