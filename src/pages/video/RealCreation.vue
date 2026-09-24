<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { serverRequest } from '../../api/session'
import { generateStream, readEventStream, type ServerEvent } from '../../api/stream'
import { segment } from '../../api/http'
import { useAuthStore } from '../../stores/auth'
import PageHeader from '../../components/PageHeader.vue'
import AuthorizedAsset from '../../components/AuthorizedAsset.vue'
import { useFieldValidation, required, numberRange } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
interface Service { id: string; name: string; kind: string; enabled: boolean }
interface Model { id: string; serviceId: string; name: string }
interface Field { nodeId?: string; input?: string; type?: string; required?: boolean; label?: string; description?: string; default?: string | number | boolean; enum?: string[]; minimum?: number; maximum?: number }
interface Workflow { id: string; name: string; version?: string; mapping: Record<string, string | Field>; inputSchema?: { properties: Record<string, Field>; required?: string[] } }
interface Execution { id: string; taskId?: string; status: string; progress?: number; output?: { assets?: string[] }; error?: object }
interface Task { id: string; title: string; status: string }
function fieldError(field: Field & { name: string }) {
  const value = values.value[field.name]
  if (value === undefined || value === '' || value === null)
    return field.required ? `请填写${field.label || field.name}` : undefined
  if (field.enum && !field.enum.includes(String(value))) return '请选择有效选项'
  if (field.type === 'number' || field.type === 'integer')
    return numberRange(value, field.minimum ?? -Number.MAX_VALUE, field.maximum ?? Number.MAX_VALUE, field.type === 'integer')
  if (field.type === 'boolean') return typeof value === 'boolean' ? undefined : '请选择是或否'
  return typeof value === 'string' ? (field.required ? required(value, field.label || field.name) : undefined) : '请输入文本'
}
const auth = useAuthStore()
const kind = ref('comfy')
const services = ref<Service[]>([])
const models = ref<Model[]>([])
const workflows = ref<Workflow[]>([])
const serviceId = ref('')
const modelId = ref('')
const workflowId = ref('')
const title = ref('')
const prompt = ref('')
const purpose = ref('article')
const format = ref('text')
const values = ref<Record<string, string | number | boolean>>({})
const task = ref<Task>()
const execution = ref<Execution>()
const events = ref<ServerEvent[]>([])
const taskEvents = ref<unknown>()
const error = ref('')
const busy = ref(false)
const selectedWorkflow = computed(() => workflows.value.find(row => row.id === workflowId.value))
const availableServices = computed(() => services.value.filter(row => row.enabled && (kind.value === 'comfy' ? row.kind === 'COMFYUI' : row.kind !== 'COMFYUI')))
const availableModels = computed(() => models.value.filter(row => row.serviceId === serviceId.value))
const fields = computed(() => {
  const workflow = selectedWorkflow.value
  if (!workflow) return []
  const schema = workflow.inputSchema
  return Object.entries(schema?.properties ?? workflow.mapping ?? {}).map(([name, value]) => ({
    name, ...(typeof value === 'string' ? { type: 'string', description: value } : value),
    required: schema?.required?.includes(name) || (typeof value !== 'string' && value.required) || false,
  }))
})
watch([selectedWorkflow, kind], () => {
  values.value = {}
  for (const field of fields.value) if (field.default !== undefined) values.value[field.name] = field.default
})
watch(serviceId, () => { modelId.value = '' })
watch(workflowId, async (id) => {
  if (!id) return
  try {
    const detail = await serverRequest<Workflow>(`/workflows/${segment(id)}`)
    workflows.value = workflows.value.map(row => row.id === id ? detail : row)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '工作流读取失败' }
})
let controller: AbortController | undefined
let eventController: AbortController | undefined
async function subscribeEvents() {
  eventController?.abort()
  if (!task.value) return
  const current = new AbortController()
  eventController = current
  try {
    await readEventStream(`/api/tasks/${segment(task.value.id)}/events`, event => {
      taskEvents.value = JSON.parse(event.data)
    }, current.signal)
  } catch (cause) {
    if (!current.signal.aborted) error.value = cause instanceof Error ? cause.message : '事件连接中断'
  }
}
async function discover() {
  busy.value = true; error.value = ''
  try {
    const [s, m, w] = await Promise.all([
      serverRequest<Service[]>('/llm/services'),
      serverRequest<Model[]>('/llm/models'),
      serverRequest<Workflow[]>('/workflows'),
    ])
    services.value = s; models.value = m; workflows.value = w
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '后端发现失败' }
  finally { busy.value = false }
}
async function refreshStatus() {
  try {
    if (execution.value) execution.value = await serverRequest<Execution>(`/comfyui/executions/${segment(execution.value.id)}/status`)
    if (task.value) {
      task.value = await serverRequest<Task>(`/tasks/${segment(task.value.id)}`)
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '状态读取失败' }
}
async function submit() {
  if (busy.value) return
  if (!validateFields()) return
  busy.value = true; error.value = ''; events.value = []; execution.value = undefined; taskEvents.value = undefined
  controller = new AbortController()
  try {
    task.value = await serverRequest<Task>('/tasks', 'POST', { title: title.value, request: { kind: kind.value, purpose: purpose.value } }, controller.signal)
    const body = {
      taskId: task.value.id, serviceId: serviceId.value,
      ...(kind.value === 'comfy' ? { workflowId: workflowId.value, workflowVersion: selectedWorkflow.value?.version } : { modelId: modelId.value }),
      input: kind.value === 'comfy' ? values.value : { prompt: prompt.value, purpose: purpose.value, mode: format.value === 'json' ? 'json' : 'text' },
    }
    if (kind.value !== 'comfy' && format.value === 'stream') {
      let completed = false
      await generateStream(body, event => {
        events.value.push(event)
        if (events.value.length > 2000) events.value.shift()
        if (event.event === 'error') throw new Error(event.data)
        if (event.event === 'done') {
          const data: Execution = JSON.parse(event.data)
          if (!data.id || !data.status) throw new Error('完成事件缺少执行标识与状态')
          execution.value = data
          completed = true
        }
      }, controller.signal)
      if (!completed) throw new Error('流已断开，未收到完成事件；请检查后端任务状态')
    } else {
      execution.value = await serverRequest<Execution>(kind.value === 'comfy' ? '/comfyui/executions/submit' : '/llm/generate', 'POST', body, controller.signal)
    }
    void subscribeEvents()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败' }
  finally { busy.value = false }
}
async function cancel() {
  controller?.abort()
  if (!execution.value) return
  try { await serverRequest(`/comfyui/executions/${segment(execution.value.id)}/cancel`, 'POST'); await refreshStatus() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '取消失败' }
}
onMounted(discover)
onBeforeUnmount(() => { controller?.abort(); eventController?.abort() })
</script>
<template>
  <div class="page-stack">
    <PageHeader title="真实内容创作" description="使用后端发现的服务、模型和工作流。后端不可用时停止，不切换 Mock 或浏览器直连。" />
    <a-alert v-if="error" type="error" :message="error" />
    <section class="panel creation-form">
      <label>创作类型<a-select v-model:value="kind" :options="[{value:'comfy',label:'ComfyUI 图像 / 视频 / 音频'}, {value:'llm',label:'LLM 文章 / 剧本 / Prompt'}]" /></label>
      <label v-field="required(title, '任务名称')">任务名称<a-input v-model:value="title" /></label>
      <label v-field="availableServices.some(row => row.id === serviceId) ? undefined : '请选择可用后端服务'">后端服务<a-select v-model:value="serviceId" :options="availableServices.map(row => ({value:row.id,label:row.name}))" /></label>
      <template v-if="kind === 'comfy'">
        <label v-field="selectedWorkflow && fields.length ? undefined : '请选择具有语义映射的工作流'">工作流<a-select v-model:value="workflowId" :options="workflows.map(row => ({value:row.id,label:row.name}))" /></label>
        <p v-if="!fields.length">无可用语义字段；请在后端配置工作流映射，不自动猜测节点。</p>
        <label v-for="field in fields" :key="field.name" v-field="fieldError(field)">
          {{ field.label || field.name }}{{ field.required ? ' *' : '' }}<small>{{ field.description }}</small>
          <a-select v-if="field.enum" v-model:value="values[field.name]" :options="field.enum.map(value => ({value,label:value}))" />
          <a-input-number v-else-if="field.type === 'number' || field.type === 'integer'" v-model:value="values[field.name]" :min="field.minimum" :max="field.maximum" :precision="field.type === 'integer' ? 0 : undefined" />
          <a-switch v-else-if="field.type === 'boolean'" v-model:checked="values[field.name]" />
          <a-textarea v-else v-model:value="values[field.name]" :rows="3" />
        </label>
      </template>
      <template v-else>
        <label v-field="availableModels.some(row => row.id === modelId) ? undefined : '请选择当前服务的模型'">已发现模型<a-select v-model:value="modelId" :options="availableModels.map(row => ({value:row.id,label:row.name}))" /></label>
        <label>用途<a-select v-model:value="purpose" :options="[{value:'article',label:'文章'},{value:'script',label:'剧本'},{value:'prompt',label:'Prompt'}]" /></label>
        <label>返回格式<a-select v-model:value="format" :options="[{value:'text',label:'普通文本'},{value:'json',label:'JSON'},{value:'stream',label:'SSE Stream'}]" /></label>
        <label v-field="required(prompt, '提示词') || (prompt.length > 100000 ? '提示词最多 100000 字' : undefined)">提示词<a-textarea v-model:value="prompt" :rows="6" /></label>
      </template>
      <div class="actions"><a-button type="primary" :loading="busy" :disabled="!auth.can('executions.create')" @click="submit">提交后端执行</a-button><a-button :disabled="busy" @click="discover">重新发现</a-button><a-button v-if="busy || execution" @click="cancel">取消</a-button></div>
    </section>
    <section v-if="task" class="panel">
      <h2>后端任务与执行</h2><p>Task {{ task.id }} · {{ task.status }}</p>
      <p v-if="execution">Execution {{ execution.id }} · {{ execution.status }} · {{ execution.progress ?? '无进度数据' }}</p>
      <a-button @click="refreshStatus">刷新真实状态 / 事件</a-button>
      <pre v-if="execution">{{ JSON.stringify(execution, null, 2) }}</pre>
      <pre v-if="taskEvents">{{ JSON.stringify(taskEvents, null, 2) }}</pre>
      <AuthorizedAsset v-for="assetId in execution?.output?.assets || []" :id="assetId" :key="assetId" />
    </section>
    <section v-if="events.length" class="panel"><h2>SSE 事件</h2><pre v-for="(event,index) in events" :key="index">{{ event.event }}: {{ event.data }}</pre></section>
  </div>
</template>
<style scoped>
.creation-form,label { display:grid; gap:12px; } .creation-form { max-width:900px; gap:20px; }
.actions { display:flex; flex-wrap:wrap; gap:12px; } pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:500px; overflow:auto; }
</style>
