<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useEngineAdapter } from '../pages/comfyui/engineAdapter'

const open = ref(false)
const router = useRouter()
function openCenter() {
  open.value = false
  void router.push('/engine')
}
const { summary: statuses } = useEngineAdapter()
</script>

<template>
  <button
    class="engine-status-trigger"
    title="查看全局 AI 引擎状态"
    @click="open = true"
  >
    <span>AI 引擎</span><b>状态</b>
  </button>
  <a-drawer
    v-model:open="open"
    title="全局 AI 引擎状态"
    placement="right"
    width="min(380px, 100vw)"
  >
    <a-alert
      type="info"
      show-icon
      message="状态面板只展示当前前端可获得的信息；GPU/VRAM 未接入真实探针，不伪造数值。"
    />
    <div class="engine-status-list">
      <div
        v-for="item in statuses"
        :key="item.name"
        class="engine-status-row"
      >
        <span>{{ item.name }}</span
        ><strong class="muted">{{ item.value }}</strong>
      </div>
    </div>
    <a-button
      block
      @click="openCenter"
      >打开引擎中心</a-button
    >
  </a-drawer>
</template>

<style scoped>
.engine-status-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #737586;
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 8px;
}
.engine-status-trigger:hover {
  background: #f0effb;
  color: #635bdb;
}
.engine-status-trigger i,
.engine-status-row i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #28b77d;
  display: inline-block;
}
.engine-status-trigger b {
  font-size: 9px;
  color: #989aa8;
  font-weight: 500;
}
.engine-status-list {
  display: grid;
  gap: 4px;
  margin: 22px 0;
}
.engine-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 4px;
  border-bottom: 1px solid #eeeef4;
  font-size: 13px;
}
.engine-status-row span {
  display: flex;
  align-items: center;
  gap: 9px;
}
.engine-status-row i.warn {
  background: #e5a04e;
}
.engine-status-row i.muted {
  background: #aaa;
}
.engine-status-row i.mock {
  background: #8d7fe5;
}
.engine-status-row strong {
  font-size: 12px;
  color: #299b71;
}
.engine-status-row strong.warn {
  color: #d78c36;
}
.engine-status-row strong.muted {
  color: #888;
}
.engine-status-row strong.mock {
  color: #635bdb;
}
</style>
