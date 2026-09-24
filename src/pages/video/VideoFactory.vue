<script setup lang="ts">
import PageHeader from '../../components/PageHeader.vue'
import TaskCards from '../tasks/TaskCards.vue'
</script>

<template>
  <main class="page-stack">
    <PageHeader
      title="视频工厂"
      eyebrow="VIDEO FACTORY"
      description="从灵感到制作包，让每一步创作进度清晰可见。"
    >
      <RouterLink to="/video/new"><a-button type="primary">创建视频任务</a-button></RouterLink>
    </PageHeader>
    <a-alert
      type="info"
      show-icon
      message="Mock 演示环境：流程、素材与结果为模拟数据，不会生成真实视频。"
    />
    <TaskCards video-only />
  </main>
</template>
