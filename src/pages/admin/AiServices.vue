<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminRequest as serverRequest } from '../../services/demo-admin'
import { isMockMode } from '../../api/mode'
import { segment } from '../../api/http'
import { useAuthStore } from '../../stores/auth'
import PageHeader from '../../components/PageHeader.vue'
import { useFieldValidation, textField, endpoint } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
interface Service { id: string; name: string; kind: string; baseUrl: string; enabled: boolean; health?: object }
const auth = useAuthStore()
const services = ref<Service[]>([])
const error = ref('')
const result = ref('')
const busy = ref(false)
const open = ref(false)
const id = ref('')
const form = ref({ name: '', kind: 'OPENAI', baseUrl: '', enabled: true, secret: '' })
async function load() { services.value = await serverRequest<Service[]>('/llm/services') }
async function perform(operation: () => Promise<void>) {
  busy.value = true; error.value = ''; result.value = ''
  try { await operation() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
function edit(row?: Service) {
  id.value = row?.id ?? ''
  form.value = { name: row?.name ?? '', kind: row?.kind ?? 'OPENAI', baseUrl: row?.baseUrl ?? '', enabled: row?.enabled ?? true, secret: '' }
  open.value = true
}
async function save() {
  if (busy.value || !validateFields()) return
  await perform(async () => {
    const { secret, ...values } = form.value
    const base = form.value.kind === 'COMFYUI' ? '/comfyui/instances' : '/llm/services'
    await serverRequest(`${base}${id.value ? `/${segment(id.value)}` : ''}`, id.value ? 'PATCH' : 'POST', { ...values, ...(secret ? { secret } : {}) })
    form.value.secret = ''; open.value = false; await load()
  })
}
async function action(row: Service, sync = false) {
  await perform(async () => {
    const base = row.kind === 'COMFYUI' ? '/comfyui/instances' : '/llm/services'
    const data = await serverRequest(`${base}/${segment(row.id)}/${sync ? 'sync-models' : 'test'}`, 'POST')
    result.value = JSON.stringify(data, null, 2); await load()
  })
}
onMounted(() => perform(load))
</script>
<template>
  <div class="page-stack">
    <PageHeader title="AI 服务配置" :description="isMockMode ? 'Mock 服务示例；不探测真实服务，刷新重置。请勿输入真实密钥。' : '所有探测、模型发现与调用均由后端完成；密钥不保存到浏览器。'" />
    <a-alert v-if="error" type="error" :message="error" />
    <div><a-button :loading="busy" @click="perform(load)">刷新</a-button><a-button v-if="auth.can('providers.create')" @click="edit()">新增服务</a-button></div>
    <div class="service-cards">
      <article v-for="row in services" :key="row.id" class="panel">
        <h3>{{ row.name }}</h3><p>{{ row.kind }} · {{ row.enabled ? '启用' : '停用' }}</p><p>{{ row.baseUrl }}</p>
        <pre>{{ row.health ? JSON.stringify(row.health, null, 2) : '尚未探测' }}</pre>
        <div class="actions">
          <a-button v-if="auth.can('providers.update')" @click="edit(row)">编辑</a-button>
          <a-button :disabled="busy" @click="action(row)">后端连接测试</a-button>
          <a-button v-if="row.kind !== 'COMFYUI' && auth.can('models.create')" :disabled="busy" @click="action(row, true)">同步模型</a-button>
        </div>
      </article>
    </div>
    <pre v-if="result" class="panel">{{ result }}</pre>
    <a-drawer v-model:open="open" title="服务配置" width="min(520px,100vw)" @after-open-change="(value: boolean) => { if (!value) form.secret = '' }">
      <a-alert v-if="error" type="error" :message="error" />
      <form @submit.prevent="save">
        <label v-field="textField(form.name, '名称', 200)">名称<a-input v-model:value="form.name" /></label>
        <label>类型<a-select v-model:value="form.kind" :disabled="!!id" :options="(['OPENAI', 'OLLAMA', 'COMFYUI'] as string[]).map((value: string) => ({ value, label: value }))" /></label>
        <label v-field="textField(form.baseUrl, '后端连接地址', 2048) || endpoint(form.baseUrl)">后端连接地址<a-input v-model:value="form.baseUrl" /></label>
        <label v-field="textField(form.secret, '密钥', 8192, true)">密钥（留空保留）<a-input-password v-model:value="form.secret" autocomplete="off" /></label>
        <a-checkbox v-model:checked="form.enabled">启用</a-checkbox>
        <a-button html-type="submit" type="primary" :loading="busy">{{ isMockMode ? '保存 Mock 示例' : '保存到后端' }}</a-button>
      </form>
    </a-drawer>
  </div>
</template>
<style scoped>
.service-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr)); gap:16px; }
form, label { display:grid; gap:12px; } form { gap:24px; }
.actions { display:flex; flex-wrap:wrap; gap:8px; } pre,p { white-space:pre-wrap; overflow-wrap:anywhere; }
</style>
