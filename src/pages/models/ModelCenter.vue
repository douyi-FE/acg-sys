<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import type { AIModel } from '../../types'
import PageHeader from '../../components/PageHeader.vue'

const store = useFactoryStore()
const capability = ref('')
const query = ref('')
const busy = ref('')
const error = ref('')
const models = computed(() =>
  store.db.models.filter(
    (m) =>
      (!capability.value || m.capability === capability.value) &&
      `${m.name} ${m.provider}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const enabled = computed(() => store.db.models.filter((m) => m.enabled).length)
const calls = computed(() => store.db.models.reduce((sum, m) => sum + m.calls, 0))
function isMock(model: AIModel) {
  return /mock/i.test(`${model.provider} ${model.name}`)
}
async function toggle(model: AIModel) {
  if (busy.value) return
  busy.value = model.id
  error.value = ''
  try {
    await store.toggleModel(model.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '模型状态保存失败，请重试'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="page-stack model-center">
    <PageHeader
      title="模型中心"
      description="按能力管理模型配置，观察模拟调用与可用状态。"
      eyebrow="MODEL REGISTRY"
      ><span class="chip">Mock 环境</span></PageHeader
    >
    <a-alert
      type="info"
      show-icon
      message="当前为 Mock 环境。Mock 模型无需真实连接即可本地模拟；connected=false 不代表模拟不可用。调用指标是模拟数据，开关仅保存本地启用配置，不会连接真实服务。"
    />
    <a-alert
      v-if="error || store.error"
      type="error"
      show-icon
      :message="error || String(store.error)"
    />
    <div class="stats">
      <section class="panel">
        <span class="muted">已注册模型</span><strong>{{ store.db.models.length }}</strong>
      </section>
      <section class="panel">
        <span class="muted">已启用</span><strong>{{ enabled }}</strong>
      </section>
      <section class="panel">
        <span class="muted">模拟总调用</span><strong>{{ calls.toLocaleString() }}</strong>
      </section>
    </div>
    <section class="panel model-directory">
      <div class="directory-heading">
        <div><span class="section-kicker">MODEL DIRECTORY</span><h2>模型目录</h2><p class="muted">按能力筛选并控制当前工作区可用模型。</p></div>
        <span class="directory-count">{{ models.length }} 个结果</span>
      </div>
      <div class="filters">
        <a-input
          v-model:value="query"
          placeholder="搜索模型或提供方"
          allow-clear
          aria-label="搜索模型"
        /><a-select
          v-model:value="capability"
          aria-label="能力筛选"
          :options="[
            { value: '', label: '全部能力' },
            ...['LLM', 'Vision', 'Image', 'Video', 'Audio', 'Embedding'].map((v) => ({ value: v, label: v })),
          ]"
        />
      </div>
      <div
        v-if="!models.length"
        class="empty-state"
      >
        {{ store.loading ? '正在加载模型…' : '暂无匹配的模型，请调整搜索或能力筛选。' }}
      </div>
      <div class="models">
        <article
          v-for="model in models"
          :key="model.id"
          class="model"
        >
          <div class="section-head">
            <span class="capability">{{ model.capability }}</span
            ><a-switch
              :checked="model.enabled"
              :loading="busy === model.id"
              :disabled="!!busy"
              :aria-label="`启用 ${model.name}`"
              @change="toggle(model)"
            />
          </div>
          <h3>{{ model.name }}</h3>
          <p class="muted">{{ model.provider }} · {{ model.enabled ? '已启用' : '已禁用' }}</p>
          <a-tag
            v-if="isMock(model)"
            :color="model.enabled ? 'purple' : 'default'"
            >{{ model.enabled ? '模拟可用（Mock）' : '模拟已禁用（Mock）' }}</a-tag
          >
          <a-tag
            v-else
            :color="model.connected ? 'blue' : 'orange'"
            >{{ model.connected ? '连接标记已设置（未实测）' : '未连接真实服务' }}</a-tag
          >
          <p class="muted">
            {{
              isMock(model)
                ? '仅本地模拟，不依赖真实服务连接。'
                : '非 Mock 提供方配置；本页面不验证真实服务可用性。'
            }}
          </p>
          <dl>
            <div>
              <dt>模拟调用</dt>
              <dd>{{ model.calls.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>延迟</dt>
              <dd>{{ model.latency }} <small>ms</small></dd>
            </div>
            <div>
              <dt>失败率</dt>
              <dd>{{ model.failureRate }}<small>%</small></dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.stats strong {
  display: block;
  color: #635bdb;
  font-size: 28px;
  margin-top: 10px;
}
.filters {
  display: grid;
  grid-template-columns: 1fr 180px;
  gap: 12px;
  margin-bottom: 24px;
}
.models {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: 16px;
}
.model {
  border: 1px solid #eeeef4;
  border-radius: 12px;
  padding: 22px;
  min-width: 0;
}
.model h3 {
  font-size: 18px;
  margin: 18px 0 8px;
  overflow-wrap: anywhere;
}
.model p {
  overflow-wrap: anywhere;
}
.capability {
  color: #635bdb;
  background: #f1efff;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
}
dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  border-top: 1px solid #eeeef4;
  margin: 20px 0 0;
  padding-top: 16px;
}
dt {
  color: #858598;
  font-size: 12px;
}
dd {
  margin: 8px 0 0;
  font-size: 18px;
  overflow-wrap: anywhere;
}
small {
  font-size: 11px;
  color: #888;
}
.panel {
  min-width: 0;
}
.directory-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; }
.directory-heading h2 { margin:6px 0 4px; color:#29263f; font-size:20px; }.directory-heading p { margin:0; font-size:12px; }
.section-kicker { color:#7770d8; font-size:10px; font-weight:750; letter-spacing:.16em; }.directory-count { color:#77738d; font-size:12px; white-space:nowrap; }
.model { background:linear-gradient(135deg,#fff,#fbfaff); box-shadow:0 4px 14px rgba(57,45,120,.04); transition:transform .2s, box-shadow .2s, border-color .2s; }.model:hover { transform:translateY(-2px); border-color:#c9c3f0; box-shadow:0 12px 26px rgba(57,45,120,.09); }
.model .section-head { align-items:center; }.model .section-head :deep(.ant-switch-checked) { background:#635bdb; }
@media (max-width: 600px) {
  .directory-heading { flex-direction:column; gap:8px; }
  .filters {
    grid-template-columns: 1fr;
  }
  .stats {
    gap: 8px;
  }
  .stats .panel {
    padding: 14px 10px;
  }
  .stats strong {
    font-size: 22px;
  }
}
</style>
