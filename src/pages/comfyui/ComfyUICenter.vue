<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHeader from '../../components/PageHeader.vue'
import WorkflowVersionsPanel from '../../components/WorkflowVersionsPanel.vue'
import { useEngineAdapter } from './engineAdapter'
import type { Workflow } from '../../types'
import type { JsonValue } from '../../providers/contracts'
import { useFieldValidation, required, jsonObject } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

type ExecutionState = 'RUNNING' | 'QUEUED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
const { store, instances, executions, queueAvailable } = useEngineAdapter()
const submission = ref({ instanceId: '', workflowId: '', taskId: '', stageId: '' })
const semanticJson = ref('{}')
const consent = ref(false)
const tasks = computed(() =>
  store.db.tasks.filter((task) => ['RUNNING', 'WAITING', 'QUEUED'].includes(task.status)),
)
const selectedTask = computed(() => tasks.value.find((task) => task.id === submission.value.taskId))
const stages = computed(
  () => store.db.pipelines?.find((pipeline) => pipeline.kind === selectedTask.value?.kind)?.stages ?? [],
)
function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return typeof value === 'object' && Object.values(value).every(isJson)
}
async function submit() {
  if (busy.value) return
  if (!validateFields()) return
  busy.value = true
  notice.value = ''
  try {
    const parsed: unknown = JSON.parse(semanticJson.value)
    if (!isJson(parsed) || !parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('语义输入必须是 JSON 对象')
    const execution = await store.enqueueComfy(
      { ...submission.value, inputs: parsed },
      { allowNetwork: true },
    )
    await store.runComfy(execution.id, { allowNetwork: true })
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '提交失败'
  } finally {
    busy.value = false
  }
}
const busy = ref(false)
const tab = ref<'queue' | 'registry'>('queue')
const filter = ref<ExecutionState | ''>('')
const notice = ref('')
const registry = computed(() => store.db.workflows)
const rows = computed(() =>
  filter.value ? executions.value.filter((item) => item.state === filter.value) : executions.value,
)
function statusLabel(value: ExecutionState) {
  return {
    RUNNING: 'Running',
    QUEUED: 'Queued',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  }[value]
}
async function save(item: Workflow, copy = false) {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    await store.saveWorkflow(
      copy
        ? {
            ...item,
            id: crypto.randomUUID(),
            name: `${item.name}（副本）`,
            active: false,
            version: '1.0.0',
            mapping: { ...item.mapping },
            history: [
              {
                version: '1.0.0',
                time: new Date().toISOString(),
                description: `复制自 ${item.id} v${item.version}（仅元数据）`,
              },
            ],
          }
        : { ...item, active: !item.active },
    )
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    busy.value = false
  }
}
async function runNext() {
  const item = executions.value.find((row) => row.state === 'QUEUED')
  if (!consent.value) {
    notice.value = '请明确同意真实网络请求'
    return
  }
  if (!item) {
    notice.value = '没有可运行的 Queued 执行'
    return
  }
  busy.value = true
  notice.value = ''
  try {
    await store.runComfy(item.id, { allowNetwork: true })
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '运行失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page-stack">
    <PageHeader
      title="ComfyUI引擎"
      description="统一查看实例、执行队列与工作流注册表。GPU / VRAM 不可用时会明确标记，不展示猜测值。"
      eyebrow="ComfyUI引擎中心"
    >
      <a-button
        :disabled="busy || !consent"
        @click="runNext"
        >运行下一条 Queued</a-button
      >
    </PageHeader>
    <a-alert
      type="info"
      show-icon
      message="仅展示 store 中的执行记录；未接入接口时为 Unavailable，不以生产任务冒充 ComfyUI 执行。priority / concurrency 仅为元数据。"
    />
    <a-alert
      v-if="notice"
      type="warning"
      show-icon
      :message="notice"
    />
    <section class="panel submission">
      <h2>提交执行</h2>
      <p class="muted">
        需先配置实例并通过真实探测；任务当前阶段须绑定 ComfyUI，工作流需有活动 API
        快照。所有校验错误原样显示，不创建假执行。
      </p>
      <label
        v-field="
          required(submission.instanceId, '实例') ||
          (instances.some((i) => i.id === submission.instanceId && i.enabled && i.connected)
            ? undefined
            : '请选择已启用且允许连接的实例')
        "
        >实例<a-select
          v-model:value="submission.instanceId"
          :disabled="busy"
          aria-label="实例"
          :options="[
            { value: '', label: '请选择实例' },
            ...instances.map((instance) => ({ value: instance.id, label: instance.name })),
          ]"
      /></label>
      <label
        v-field="
          required(submission.workflowId, '工作流') ||
          (registry.some((w) => w.id === submission.workflowId && w.active && w.provider === 'ComfyUI')
            ? undefined
            : '请选择已启用的 ComfyUI 工作流')
        "
        >工作流<a-select
          v-model:value="submission.workflowId"
          :disabled="busy"
          aria-label="工作流"
          :options="[
            { value: '', label: '请选择工作流' },
            ...registry.map((workflow) => ({ value: workflow.id, label: workflow.name })),
          ]"
      /></label>
      <label
        v-field="
          required(submission.taskId, '任务') || (selectedTask ? undefined : '任务已不可执行，请重新选择')
        "
        >任务<a-select
          v-model:value="submission.taskId"
          :disabled="busy"
          aria-label="任务"
          :options="[
            { value: '', label: '请选择任务' },
            ...tasks.map((task) => ({ value: task.id, label: task.title })),
          ]"
          @change="submission.stageId = ''"
      /></label>
      <label
        v-field="
          required(submission.stageId, '当前阶段') ||
          (stages.some(
            (s) =>
              s.id === submission.stageId && s.key === selectedTask?.stages[selectedTask.stageIndex]?.key,
          )
            ? undefined
            : '所选阶段不是任务当前阶段')
        "
        >当前阶段<a-select
          v-model:value="submission.stageId"
          :disabled="busy"
          aria-label="当前阶段"
          :options="[
            { value: '', label: '请选择当前阶段' },
            ...stages.map((stage) => ({
              value: stage.id,
              label: `${stage.name} · ${stage.id}`,
              disabled: stage.key !== selectedTask?.stages[selectedTask.stageIndex]?.key,
            })),
          ]"
      /></label>
      <label v-field="jsonObject(semanticJson)"
        >语义输入 JSON<a-textarea
          v-model:value="semanticJson"
          :disabled="busy"
          aria-label="语义输入 JSON"
          :rows="5"
      /></label>
      <div v-field="consent ? undefined : '请明确同意真实网络请求'">
        <a-checkbox
          v-model:checked="consent"
          :disabled="busy"
          >我同意向所选实例发送真实网络请求，可能消耗 GPU 资源</a-checkbox
        >
      </div>
      <a-button
        type="primary"
        :loading="busy"
        :disabled="busy"
        @click="submit"
        >提交并执行</a-button
      >
      <router-link to="/engine">配置实例 / 真实探测</router-link>
    </section>
    <div class="tabs">
      <button
        :class="{ active: tab === 'queue' }"
        @click="tab = 'queue'"
      >
        执行队列</button
      ><button
        :class="{ active: tab === 'registry' }"
        @click="tab = 'registry'"
      >
        工作流注册表</button
      ><router-link to="/engine">实例与健康</router-link>
    </div>
    <section
      v-if="tab === 'queue'"
      class="panel"
    >
      <div class="section-head">
        <div>
          <h2>执行队列</h2>
          <p class="muted">运行中 / 排队中 / 已完成 / 失败 / 已取消</p>
        </div>
        <a-select
          v-model:value="filter"
          class="filter"
          :options="[
            { value: '', label: '全部状态' },
            ...(['RUNNING', 'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED'] as ExecutionState[]).map(
              (value) => ({ value, label: statusLabel(value) }),
            ),
          ]"
        />
      </div>
      <div class="execution-list">
        <div
          v-if="!rows.length"
          class="empty-state"
        >
          {{
            store.loading
              ? '加载中…'
              : queueAvailable
                ? '暂无匹配执行记录'
                : 'Unavailable：store 未提供执行队列接口'
          }}
        </div>
        <article
          v-for="item in rows"
          :key="item.id"
          class="execution-card"
        >
          <div class="execution-main">
            <div class="execution-title">
              <b>{{ item.workflow }}</b
              ><span :class="['status-badge', `status-${item.state.toLowerCase()}`]">{{
                statusLabel(item.state)
              }}</span
              ><a-tag v-if="item.mock">Mock</a-tag>
            </div>
            <p class="muted">{{ item.id }} · {{ item.instanceId }} · {{ item.createdAt || '时间不可用' }}</p>
            <a-tag
              v-if="item.errorType"
              :color="item.errorType === 'SYSTEM_ERROR' ? 'red' : 'orange'"
              >{{ item.errorType }}</a-tag
            >
          </div>
          <div class="execution-meta">
            <span
              >优先级 <b>{{ item.priority ?? '—' }}</b></span
            ><span
              >并发数 <b>{{ item.concurrency ?? '—' }}</b></span
            ><router-link :to="`/comfyui/executions/${encodeURIComponent(item.id)}`">详情</router-link>
          </div>
        </article>
      </div>
    </section>
    <section
      v-else
      class="panel"
    >
      <div class="section-head">
        <div>
          <h2>工作流注册表</h2>
          <p class="muted">画布工作流 / API 工作流 / 参数映射的版本入口</p>
        </div>
        <a-button @click="$router.push('/workflows')">打开工作流中心</a-button>
      </div>
      <a-alert
        type="info"
        show-icon
        message="画布工作流是画布 JSON，不能直接执行；请在下方版本面板导入 API 工作流和参数映射并激活。提交时读取活动快照；未配置则显示真实错误。JSON 编辑建议使用电脑。"
      />
      <p class="muted">元数据启用状态与活动快照独立；快照激活、停用和回滚请使用下方版本面板。</p>
      <div
        v-if="!registry.length"
        class="empty-state"
      >
        暂无工作流
      </div>
      <article
        v-for="item in registry"
        :key="item.id"
        class="registry-row"
      >
        <div>
          <b>{{ item.name }}</b
          ><span class="chip">v{{ item.version }}</span
          ><span class="muted"
            >画布工作流：未配置 · API 工作流：未配置 · 参数映射：{{
              Object.keys(item.mapping).length
            }}
            项</span
          >
        </div>
        <div class="registry-actions">
          <a-tag :color="item.active ? 'green' : 'default'">{{ item.active ? '激活' : '停用' }}</a-tag
          ><a-button
            size="small"
            :disabled="busy"
            @click="save(item)"
            >{{ item.active ? '停用' : '激活' }}</a-button
          ><a-button
            size="small"
            :disabled="busy"
            @click="save(item, true)"
            >复制</a-button
          ><a-button
            size="small"
            disabled
            title="没有历史快照与回滚方法"
            >回滚（不可用）</a-button
          >
        </div>
      </article>
      <WorkflowVersionsPanel :workflows="store.db.workflows" />
    </section>
  </div>
</template>

<style scoped>
.submission {
  display: grid;
  gap: 14px;
}
.submission label {
  display: grid;
  gap: 8px;
}
.submission select {
  width: 100%;
  min-width: 0;
  padding: 9px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
}
.tabs {
  display: flex;
  gap: 6px;
  align-items: center;
  border-bottom: 1px solid #e8e9f0;
}
.tabs button,
.tabs a {
  padding: 11px 14px;
  font-size: 12px;
  color: #818391;
  border-bottom: 2px solid transparent;
}
.tabs button.active {
  color: #635bdb;
  border-color: #635bdb;
}
.tabs a {
  margin-left: auto;
  color: #635bdb;
}
.filter {
  width: 150px;
}
.execution-list {
  display: grid;
  gap: 10px;
}
.execution-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 17px;
  border: 1px solid #eeeef4;
  border-radius: 10px;
  cursor: pointer;
}
.execution-card:hover {
  border-color: #c9c5f3;
  background: #fcfcff;
}
.execution-main {
  min-width: 0;
}
.execution-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.execution-title b {
  font-size: 14px;
}
.execution-main p {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.execution-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #858797;
  font-size: 11px;
  white-space: nowrap;
}
.execution-meta b {
  color: #635bdb;
}
.status-badge {
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 10px;
}
.status-running {
  background: #efedff;
  color: #635bdb;
}
.status-queued {
  background: #f1f1f5;
  color: #838592;
}
.status-completed {
  background: #e6f8f0;
  color: #279a6f;
}
.status-failed {
  background: #ffeded;
  color: #db6262;
}
.status-cancelled {
  background: #eee;
  color: #888;
}
.registry-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 18px 0;
  border-top: 1px solid #eeeef4;
}
.registry-row > div:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.registry-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
@media (max-width: 650px) {
  .execution-card,
  .registry-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .execution-meta {
    width: 100%;
    flex-wrap: wrap;
    white-space: normal;
  }
  .registry-actions {
    justify-content: flex-start;
  }
  .section-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .filter {
    width: 100%;
  }
  .tabs {
    overflow: auto;
    white-space: nowrap;
  }
}
</style>
