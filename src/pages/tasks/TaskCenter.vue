<script setup lang="ts">
import PageHeader from '../../components/PageHeader.vue'
import TaskCards from './TaskCards.vue'
</script>

<template>
  <main class="page-stack">
    <PageHeader
      title="任务中心"
      eyebrow="TASK CENTER"
      description="列表内预览视频与图文、快捷审核和下载交付；需要流水线与日志时再查看详情。"
    >
      <RouterLink to="/video/new"><a-button type="primary">新建视频任务</a-button></RouterLink>
      <RouterLink to="/hot-topics"><a-button>新建图文任务</a-button></RouterLink>
    </PageHeader>
    <TaskCards />
  </main>
</template>
