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
  <div class="page-stack">
    <PageHeader :title="title || '权限管理'" :description="isMockMode ? 'Mock 本地管理示例；刷新重置，不创建真实账号或权限。请勿输入真实密码。' : '数据与授权来自后端；权限变更后重新读取当前会话。'" />
    <a-alert v-if="error" type="error" :message="error" />
    <section class="panel toolbar">
      <a-input v-model:value="search" aria-label="搜索管理记录" placeholder="搜索" @press-enter="page = 1; load()" />
      <a-button :loading="busy" @click="load">刷新</a-button>
      <a-button v-if="kind !== 'audit-logs' && auth.can(`${kind}.create`)" @click="edit()">新增</a-button>
    </section>
    <div class="admin-cards">
      <article v-for="row in kind === 'users' ? users : kind === 'roles' ? roles : audits" :key="row.id" class="panel">
        <h3>{{ 'username' in row ? row.username : 'name' in row ? row.name : row.action }}</h3>
        <p class="muted">{{ row.id }}</p>
        <template v-if="'action' in row"><p>{{ row.createdAt }}</p><p>操作者：{{ row.userId || '未关联' }}</p></template>
        <template v-else>
          <p>{{ row.enabled ? '启用' : '停用' }}</p>
          <a-button v-if="auth.can(`${kind}.update`)" @click="edit(row)">编辑</a-button>
          <a-popconfirm title="确定删除？后端将校验关联约束。" @confirm="remove(row.id)"><a-button v-if="auth.can(`${kind}.delete`)" danger>删除</a-button></a-popconfirm>
        </template>
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
.toolbar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
.toolbar .ant-input { max-width:320px; }
.editor, label { display:grid; gap:12px; }
.editor { gap:24px; } p { overflow-wrap:anywhere; }
</style>
