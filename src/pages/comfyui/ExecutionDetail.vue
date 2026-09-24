<script setup lang="ts">
import PageHeader from '../../components/PageHeader.vue'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useEngineAdapter } from './engineAdapter'
const route = useRoute()
const { store, executions, queueAvailable } = useEngineAdapter()
const execution = computed(() => executions.value.find((item) => item.id === route.params.id))
const busy = ref(false)
const error = ref('')
const events = ['Submit', 'Queue', 'Node Start', 'Node Complete', 'Error', 'Output', 'Complete']
const selected = ref('')
const logs = computed(
  () => execution.value?.logs?.filter((log) => !selected.value || log.event === selected.value) ?? [],
)
async function cancel() {
  if (!execution.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await store.cancelComfy(execution.value.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '取消失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="执行详情"
      :description="String(route.params.id)"
      eyebrow="执行追踪"
      ><a-button @click="$router.push('/comfyui')">返回队列</a-button></PageHeader
    >
    <a-alert
      v-if="error || store.error"
      type="error"
      :message="error || store.error"
    />
    <a-alert
      type="info"
      message="只展示 store 提供的日志，不补造事件或输出。priority / concurrency 仅为元数据。"
    />
    <div
      v-if="!execution"
      class="empty-state"
    >
      {{
        store.loading
          ? '加载中…'
          : queueAvailable
            ? '执行不存在或已被移除'
            : 'Unavailable：执行详情接口未接入'
      }}
    </div>
    <div
      v-else
      class="detail-grid"
    >
      <section class="panel">
        <div class="section-head">
          <h2>执行时间线</h2>
          <a-tag>{{ execution.state }}{{ execution.mock ? ' / Mock' : '' }}</a-tag>
        </div>
        <a-select
          v-model:value="selected"
          style="width: 100%"
          aria-label="日志事件筛选"
          :options="[
            { value: '', label: '全部事件' },
            ...events.map((event) => ({ value: event, label: event })),
          ]"
        />
        <div
          v-if="!logs.length"
          class="empty-state"
        >
          暂无匹配日志；未记录不等于执行成功。
        </div>
        <div class="log-list">
          <div
            v-for="log in logs"
            :key="log.id"
            class="log-row"
          >
            <span class="time">{{ log.time }}</span
            ><i :class="log.event === 'Error' ? 'warn' : 'info'"></i>
            <div>
              <b>{{ log.event }}</b
              ><a-tag
                v-if="log.errorType"
                :color="log.errorType === 'SYSTEM_ERROR' ? 'red' : 'orange'"
                >{{ log.errorType }}</a-tag
              >
              <p>{{ log.message }}</p>
            </div>
          </div>
        </div>
      </section>
      <aside class="panel summary">
        <h2>元数据</h2>
        <dl>
          <div>
            <dt>工作流</dt>
            <dd>{{ execution.workflow }}</dd>
          </div>
          <div>
            <dt>Instance</dt>
            <dd>{{ execution.instanceId }}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{{ execution.priority ?? 'Unavailable' }}</dd>
          </div>
          <div>
            <dt>Concurrency</dt>
            <dd>{{ execution.concurrency ?? 'Unavailable' }}</dd>
          </div>
          <div>
            <dt>GPU / VRAM</dt>
            <dd>Unavailable</dd>
          </div>
          <div>
            <dt>失败分类</dt>
            <dd>{{ execution.errorType || '未提供' }}</dd>
          </div>
        </dl>
        <p class="muted">取消本地请求不保证远端 GPU 作业停止。</p>
        <a-button
          block
          :loading="busy"
          :disabled="busy || !['RUNNING', 'QUEUED'].includes(execution.state)"
          @click="cancel"
          >取消执行</a-button
        >
      </aside>
    </div>
    <section class="panel failure-note">
      <h2>Failure classification</h2>
      <div class="classifications">
        <span><b>SYSTEM_ERROR</b><small>连接、节点、超时或服务端错误</small></span
        ><span><b>QUALITY_FAILED</b><small>执行完成但质量门禁未通过</small></span>
      </div>
      <p class="muted">分类以 store 记录为准；Complete 不等于质量审核通过。</p>
    </section>
  </div>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 16px;
}
.log-list {
  display: grid;
}
.log-row {
  display: grid;
  grid-template-columns: 75px 12px 1fr;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid #f0f0f4;
}
.time {
  color: #989aa8;
  font-size: 11px;
}
.log-row i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #635bdb;
  margin-top: 4px;
}
.log-row i.ok {
  background: #28b77d;
}
.log-row i.warn {
  background: #e5a04e;
}
.log-row b {
  font-size: 12px;
}
.log-row p {
  margin: 6px 0 0;
  color: #858797;
  font-size: 12px;
}
.summary h2,
.failure-note h2 {
  font-size: 16px;
  margin-top: 0;
}
.summary dl {
  display: grid;
  gap: 14px;
  margin: 22px 0;
}
.summary dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #f0f0f4;
  padding-bottom: 12px;
}
.summary dt {
  color: #858797;
  font-size: 12px;
}
.summary dd {
  margin: 0;
  text-align: right;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.classifications {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.classifications span {
  padding: 14px;
  border-radius: 9px;
  background: #f8f8fb;
}
.classifications b {
  display: block;
  font-size: 11px;
  color: #db6262;
}
.classifications span + span b {
  color: #d78c36;
}
.classifications small {
  display: block;
  color: #858797;
  font-size: 11px;
  margin-top: 6px;
}
@media (max-width: 700px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .classifications {
    grid-template-columns: 1fr;
  }
}
</style>
