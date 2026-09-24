<script setup lang="ts">
import PageHeader from '../../components/PageHeader.vue'
import TaskCards from './TaskCards.vue'
</script>

<template>
  <main class="page-stack">
    <PageHeader
      title="任务中心"
      eyebrow="TASK CENTER"
      description="统一管理视频与文章任务，追踪状态、处理异常和查看运行日志。"
    >
      <RouterLink to="/video/new"><a-button type="primary">新建视频任务</a-button></RouterLink>
    </PageHeader>
    <TaskCards />
  </main>
</template>
