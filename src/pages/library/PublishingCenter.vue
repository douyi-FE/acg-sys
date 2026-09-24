<script setup lang="ts">
import { computed } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import PageHeader from '../../components/PageHeader.vue'
const store = useFactoryStore()
const approved = computed(() => store.db.articles.filter((a) => a.status === 'approved'))
const destinations = ['微信公众号', '今日头条', '小红书', '知乎', '百家号', '自定义平台']
function download(id: string) {
  const article = approved.value.find((a) => a.id === id)
  if (!article) return
  const content = `# ${article.title}\n\n${article.body}\n\n---\n人工审核通过的本地制作稿；未自动发布。`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `article-${id}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <div class="page-stack">
    <PageHeader
      title="发布与交付"
      eyebrow="PUBLISHING HUB"
      description="审核与发布分离。当前支持制作稿导出，平台发布连接器尚未配置。"
    />
    <a-alert
      type="info"
      show-icon
      message="不会自动发布任何内容"
      description="真实发布需服务端授权与 PublishingProvider 实现。本地审核成功只表示制作流程完成，不表示外部平台发布成功。"
    />
    <div class="destinations">
      <section
        v-for="(destination, index) in destinations"
        :key="destination"
        class="panel"
      >
        <div class="platform-mark">{{ String(index + 1).padStart(2, '0') }}</div>
        <h3>{{ destination }}</h3>
        <p class="muted">PublishingProvider</p>
        <a-tag>未连接</a-tag
        ><a-tooltip title="等待后端发布 Provider 与平台授权接入"
          ><a-button disabled>连接器未配置</a-button></a-tooltip
        >
      </section>
    </div>
    <section class="panel">
      <div class="section-head">
        <h2>待交付制作稿</h2>
        <span class="muted">{{ approved.length }} 篇已审核</span>
      </div>
      <div
        v-if="!approved.length"
        class="empty-state"
      >
        完成文章核验与人工审核后，可以在这里导出制作稿。<br /><router-link to="/articles"
          >查看文章库 →</router-link
        >
      </div>
      <div
        v-for="article in approved"
        :key="article.id"
        class="deliverable"
      >
        <div>
          <strong>{{ article.title }}</strong>
          <p class="muted">{{ article.platform }} · 已审核，未发布</p>
        </div>
        <a-button @click="download(article.id)">导出 Markdown</a-button>
      </div>
    </section>
  </div>
</template>
<style scoped>
.destinations {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.destinations .panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.destinations h3,
.destinations p {
  width: 100%;
  margin: 3px 0;
}
.platform-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #f0edff;
  color: #726aca;
  display: grid;
  place-items: center;
  font-size: 12px;
  margin-bottom: 10px;
}
.deliverable {
  display: flex;
  gap: 15px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 0;
  border-top: 1px solid #f0f0f5;
}
.deliverable p {
  margin-bottom: 0;
}
@media (max-width: 900px) {
  .destinations {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .destinations {
    grid-template-columns: 1fr;
  }
  .deliverable {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
