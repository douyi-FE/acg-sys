<script setup lang="ts">
import { computed } from 'vue'
import type { Asset, Database } from '../types'
import { assetRegistry } from '../orchestrator/asset-registry'

const props = defineProps<{ asset: Asset; db: Database }>()
const provenance = computed(() => assetRegistry.resolve(props.db, props.asset).provenance)
</script>

<template>
  <section class="asset-trace">
    <h3>素材来源 · Asset Trace</h3>
    <p v-if="provenance.status === 'legacy unavailable'" class="muted">
      legacy unavailable：历史执行缺失或来源不一致，仅展示素材已记录信息，不从当前任务配置补造来源。
    </p>
    <dl>
      <dt>状态</dt><dd>{{ provenance.status }}</dd>
      <dt>Task</dt><dd>{{ provenance.taskId || '未记录' }}</dd>
      <dt>Pipeline</dt><dd>{{ provenance.pipelineId ?? '未记录' }}</dd>
      <dt>Stage</dt><dd>{{ provenance.stageId ?? '未记录' }}</dd>
      <dt>Provider</dt><dd>{{ provenance.provider ?? '未记录' }}</dd>
      <dt>Execution</dt><dd>{{ provenance.executionId ?? '未记录' }}</dd>
      <dt>Attempt</dt><dd>{{ provenance.attempt ?? '未记录' }}</dd>
      <dt>Trace</dt><dd>{{ provenance.traceId ?? '未记录' }}</dd>
      <dt>工作流</dt><dd>{{ provenance.workflowId ?? '未记录' }}</dd>
      <dt>Version</dt><dd>{{ provenance.workflowVersion ?? '未记录' }}</dd>
      <dt>Model</dt><dd>{{ provenance.model }} ({{ provenance.sources.model }})</dd>
      <dt>Prompt</dt><dd><pre>{{ provenance.prompt ?? '未记录' }}</pre></dd>
      <dt>Seed</dt><dd>{{ provenance.seed ?? '未记录' }}</dd>
    </dl>
  </section>
</template>

<style scoped>
dl { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; }
dt { color: #888; }
dd { margin: 0; overflow-wrap: anywhere; }
pre { margin: 0; white-space: pre-wrap; }
</style>
