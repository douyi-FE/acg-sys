<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFactoryStore } from '../../stores/factory'
import PageHeader from '../../components/PageHeader.vue'
const store = useFactoryStore()
const query = ref('')
const status = ref('')
const articles = computed(() =>
  store.db.articles.filter(
    (a) => a.title.includes(query.value) && (!status.value || a.status === status.value),
  ),
)
</script>
<template>
  <div class="page-stack">
    <PageHeader
      title="文章库"
      eyebrow="EDITORIAL WORKSPACE"
      description="所有选题、提纲、正文和核验记录集中保存。"
      ><router-link to="/hot-topics"
        ><a-button type="primary">从热点创建文章</a-button></router-link
      ></PageHeader
    >
    <div class="filters">
      <a-input
        v-model:value="query"
        allow-clear
        placeholder="搜索文章标题"
      /><a-select
        v-model:value="status"
        :options="[
          { value: '', label: '全部状态' },
          { value: 'draft', label: '草稿' },
          { value: 'review', label: '核验中' },
          { value: 'approved', label: '已人工审核' },
        ]"
      />
    </div>
    <section
      v-if="articles.length"
      class="article-grid"
    >
      <article
        v-for="article in articles"
        :key="article.id"
        class="panel"
      >
        <span class="eyebrow">{{ article.platform }}</span>
        <h2>{{ article.title }}</h2>
        <p>{{ article.body.slice(0, 160) }}…</p>
        <div class="meta">
          <a-tag :color="article.status === 'approved' ? 'green' : 'purple'">{{
            { draft: '草稿', review: '核验中', approved: '已人工审核' }[article.status]
          }}</a-tag
          ><span>{{ article.body.length }} 字符</span>
        </div>
        <div class="actions">
          <router-link :to="`/articles/${article.id}`"><a-button>打开编辑器</a-button></router-link
          ><router-link :to="`/tasks/${article.taskId}`">生产进度 →</router-link>
        </div>
      </article>
    </section>
    <div
      v-else
      class="panel empty-state"
    >
      <h3>还没有匹配的文章</h3>
      <p>从热点分析创建一份草稿，开始内容生产。</p>
      <router-link to="/hot-topics">前往热点工厂 →</router-link>
    </div>
  </div>
</template>
<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr 180px;
  gap: 12px;
}
.article-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.article-grid h2 {
  font-size: 18px;
  line-height: 1.6;
}
.article-grid p {
  font-size: 12px;
  line-height: 1.9;
  color: #9694a3;
  min-height: 60px;
  white-space: pre-line;
}
.meta,
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: #999;
  margin-top: 18px;
}
.actions {
  justify-content: space-between;
}
@media (max-width: 650px) {
  .article-grid {
    grid-template-columns: 1fr;
  }
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
