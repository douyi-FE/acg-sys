<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHeader from '../../components/PageHeader.vue'
import { healthKeys, states, useEngineAdapter } from '../comfyui/engineAdapter'
import type { EngineInstance, HealthReading } from '../comfyui/engineAdapter'
import { useFieldValidation, required, endpoint } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

const { store, instances, executions, queueAvailable, summary } = useEngineAdapter()
const showForm = ref(false)
const notice = ref('')
const busy = ref(false)
const form = ref<{ id?: string; name: string; endpoint: string; enabled: boolean; connected: boolean }>({
  name: '',
  endpoint: '',
  enabled: true,
  connected: false,
})
const healthLabels = healthKeys
const enabledCount = computed(() => instances.value.filter((item) => item.enabled).length)
function addDraft(instance?: EngineInstance) {
  showForm.value = true
  form.value = instance
    ? {
        id: instance.id,
        name: instance.name,
        endpoint: instance.endpoint,
        enabled: instance.enabled,
        connected: instance.connected,
      }
    : { name: '', endpoint: '', enabled: true, connected: false }
  notice.value = ''
}
async function run(operation: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    await operation()
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '操作失败'
  } finally {
    busy.value = false
  }
}
async function saveDraft() {
  if (!validateFields()) return
  await run(async () => {
    const url = new URL(form.value.endpoint)
    const input = {
      id: form.value.id || crypto.randomUUID(),
      name: form.value.name.trim(),
      baseUrl: url.toString().replace(/\/$/, ''),
      enabled: form.value.enabled,
      connected: form.value.connected,
    }
    if (form.value.id) {
      const original = store.db.comfyInstances?.find((item) => item.id === form.value.id)
      if (!original) throw new Error('实例已被删除，请重新加载')
      await store.updateComfyInstance({ ...original, ...input })
    } else await store.createComfyInstance(input)
    showForm.value = false
  })
}
function toggle(instance: EngineInstance) {
  void run(async () => {
    const original = store.db.comfyInstances?.find((item) => item.id === instance.id)
    if (!original) throw new Error('实例已被删除')
    await store.updateComfyInstance({ ...original, enabled: !instance.enabled })
  })
}
function check(instance: EngineInstance) {
  void run(async () => {
    await store.probeComfyHealth(instance.id)
  })
}
function remove(instance: EngineInstance) {
  void run(async () => {
    await store.deleteComfyInstance(instance.id)
  })
}
function healthText(value?: HealthReading) {
  return value?.status ?? 'Unavailable'
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="引擎中心"
      description="管理 ComfyUI 实例与引擎运行边界；真实健康探测接入前不会展示虚构资源数据。"
      eyebrow="AI 引擎管理"
    >
      <a-button
        type="primary"
        @click="addDraft()"
        >创建实例</a-button
      >
    </PageHeader>
    <a-alert
      type="warning"
      show-icon
      message="GPU / VRAM 明确标记为 Unavailable：当前没有真实 GPU 探针。Queue 的 priority / concurrency 仅作为执行元数据。"
    />
    <a-alert
      v-if="notice || store.error"
      type="error"
      show-icon
      :message="notice || store.error"
    />
    <section class="panel">
      <div
        v-for="item in summary"
        :key="item.name"
        class="section-head"
      >
        <b>{{ item.name }}</b
        ><span class="muted">{{ item.value }}</span>
      </div>
    </section>
    <div class="engine-overview">
      <section class="metric-card">
        <span class="metric-label">实例</span><strong>{{ instances.length }}</strong
        ><small>{{ enabledCount }} 个启用</small>
      </section>
      <section class="metric-card">
        <span class="metric-label">ComfyUI</span
        ><strong>{{ instances.length ? '已配置' : 'Unavailable' }}</strong
        ><small>配置不代表真实连接</small>
      </section>
      <section class="metric-card">
        <span class="metric-label">GPU / VRAM</span><strong>Unavailable</strong><small>无硬件数据</small>
      </section>
    </div>
    <section class="panel">
      <div class="section-head"><h2>ComfyUI 实例</h2></div>
      <div
        v-if="!instances.length"
        class="empty-state"
      >
        {{ store.loading ? '加载中…' : '暂无实例；不创建虚构的 Local ComfyUI。' }}
      </div>
      <div class="instance-grid">
        <article
          v-for="instance in instances"
          :key="instance.id"
          class="instance-card"
        >
          <div class="instance-title">
            <div>
              <h3>{{ instance.name }}</h3>
              <p class="muted">{{ instance.endpoint }}</p>
            </div>
            <a-switch
              :checked="instance.enabled"
              :disabled="busy"
              :aria-label="`${instance.name}启用状态`"
              @change="toggle(instance)"
            />
          </div>
          <div class="health-grid">
            <div
              v-for="key in healthLabels"
              :key="key"
            >
              <span>{{ key === 'Workflow' ? '工作流' : key === 'Model' ? '模型' : key }}</span
              ><b
                class="unavailable"
                :title="instance.health?.[key]?.detail"
                >{{ healthText(instance.health?.[key])
                }}<small v-if="instance.health?.[key]?.checkedAt">{{
                  instance.health?.[key]?.checkedAt
                }}</small></b
              >
            </div>
          </div>
          <p class="muted">
            {{ instance.health?.API?.detail || '尚未探测' }} · 连接授权：{{
              instance.connected ? '已允许' : '未允许'
            }}
          </p>
          <div class="actions">
            <a-button
              :disabled="busy"
              @click="addDraft(instance)"
              >编辑</a-button
            ><a-button
              :disabled="busy"
              @click="check(instance)"
              >真实 HTTP 探测</a-button
            ><a-popconfirm
              title="确认删除实例？队列中实例不可删除。"
              @confirm="remove(instance)"
              ><a-button
                danger
                :disabled="busy"
                >删除</a-button
              ></a-popconfirm
            >
          </div>
        </article>
      </div>
    </section>
    <section class="panel queue-summary">
      <div class="section-head">
        <h2>执行队列</h2>
        <a-button
          type="link"
          @click="$router.push('/comfyui')"
          >查看队列</a-button
        >
      </div>
      <div class="queue-stats">
        <span
          v-for="state in states"
          :key="state"
          ><b>{{ queueAvailable ? executions.filter((item) => item.state === state).length : '—' }}</b>
          {{ state }}</span
        >
      </div>
      <p class="muted">
        {{ queueAvailable ? '数据来自 store。' : 'Unavailable：store 未提供执行队列。' }} priority /
        concurrency 只展示元数据，不代表真实调度。
      </p>
    </section>
    <a-drawer
      v-model:open="showForm"
      :title="form.id ? '编辑 ComfyUI 实例' : '创建 ComfyUI 实例'"
      :closable="!busy"
      :mask-closable="false"
      :keyboard="!busy"
      width="min(480px, 100vw)"
    >
      <a-alert
        v-if="notice"
        type="error"
        :message="notice"
      />
      <label
        v-field="required(form.name, '实例名称')"
        class="field"
        >名称<a-input
          v-model:value="form.name"
          :disabled="busy"
          placeholder="例如 Local ComfyUI"
      /></label>
      <label
        v-field="endpoint(form.endpoint)"
        class="field"
        >连接地址<a-input
          v-model:value="form.endpoint"
          :disabled="busy"
          placeholder="http://localhost:8188"
      /></label>
      <div class="field field-toggle">
        <label
          for="engine-enabled"
          class="field-label"
          >启用配置</label
        >
        <a-switch
          id="engine-enabled"
          v-model:checked="form.enabled"
          :disabled="busy"
          aria-label="启用配置"
          aria-describedby="engine-enabled-help"
        />
        <p
          id="engine-enabled-help"
          class="field-help"
        >
          保存实例的启用设置；启用不代表已授权连接或健康探测成功。
        </p>
      </div>
      <div class="field field-consent">
        <a-checkbox
          v-model:checked="form.connected"
          :disabled="busy"
          aria-describedby="engine-consent-help"
          >允许连接此地址</a-checkbox
        >
        <p
          id="engine-consent-help"
          class="field-help"
        >
          这是向该地址发起网络请求的明确授权，不代表健康探测成功，也不等同于实例健康状态。
          真实探测仅由后端执行，浏览器不会直连 AI 服务；Mock 模式明确拒绝真实探测。仅配置你信任的服务。
        </p>
      </div>
      <a-button
        type="primary"
        :loading="busy"
        :disabled="busy"
        @click="saveDraft"
        >保存实例</a-button
      >
    </a-drawer>
  </div>
</template>

<style scoped>
.actions {
  flex-wrap: wrap;
}
.health-grid b {
  flex-wrap: wrap;
  overflow-wrap: anywhere;
}
.instance-title > div {
  min-width: 0;
}
.engine-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.metric-card small {
  display: block;
  color: #9698a6;
  font-size: 11px;
  margin-top: 8px;
}
.metric-card strong {
  display: block;
  font-size: 23px;
  margin-top: 9px;
  color: #635bdb;
  overflow-wrap: anywhere;
}
.instance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(390px, 100%), 1fr));
  gap: 16px;
}
.instance-card {
  border: 1px solid #eeeef4;
  border-radius: 12px;
  padding: 20px;
}
.instance-title {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}
.instance-title h3 {
  margin: 0;
  font-size: 17px;
}
.instance-title p {
  margin: 7px 0 0;
  overflow-wrap: anywhere;
}
.health-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 22px 0;
}
.health-grid div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  background: #f8f8fb;
  border-radius: 7px;
  font-size: 11px;
  color: #757787;
}
.health-grid b {
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 5px;
}
.health-grid i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #28b77d;
}
.health-grid b.warn {
  color: #d78c36;
}
.health-grid b.warn i {
  background: #e5a04e;
}
.health-grid b.unavailable {
  color: #888;
}
.health-grid b.unavailable i {
  background: #aaa;
}
.actions {
  display: flex;
  gap: 8px;
}
.queue-stats {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.queue-stats b {
  color: #635bdb;
  font-size: 21px;
  margin-right: 5px;
}
.field {
  display: grid;
  gap: 8px;
  margin: 18px 0;
}
.field-toggle {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 16px;
}
.field-consent {
  gap: 8px;
}
.field-label {
  color: #686b7c;
  font-size: 12px;
  font-weight: 600;
}
.field-help {
  grid-column: 1 / -1;
  margin: 0;
  color: #858797;
  font-size: 12px;
  line-height: 1.6;
}
.field-consent :deep(.ant-checkbox-wrapper) {
  width: fit-content;
  max-width: 100%;
}
.queue-summary {
  margin-bottom: 8px;
}
@media (max-width: 600px) {
  .engine-overview {
    grid-template-columns: 1fr 1fr;
  }
  .engine-overview .metric-card:last-child {
    grid-column: span 2;
  }
  .health-grid {
    grid-template-columns: 1fr;
  }
  .queue-stats {
    gap: 12px 18px;
  }
}
</style>
