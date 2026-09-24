<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useFactoryStore } from '../../stores/factory'
import PageHeader from '../../components/PageHeader.vue'
const store = useFactoryStore()
const route = useRoute()
const search = ref('')
const labels: Record<string, string> = {
  scripts: '剧本库',
  characters: '角色中心',
  storyboards: '分镜时间线',
}
const kind = computed(() => String(route.params.kind))
const tasks = computed(() =>
  store.db.tasks.filter(
    (t) =>
      t.kind === 'video' &&
      `${t.title} ${t.script} ${t.characters.map((c) => c.name).join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
)
const entries = computed(() =>
  tasks.value.filter((t) =>
    kind.value === 'scripts'
      ? !!t.script
      : kind.value === 'characters'
        ? t.characters.length
        : t.shots.length,
  ),
)
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="PRODUCTION LIBRARY"
      :title="labels[kind] || '创作资料'"
      description="跨任务管理创作资料；固定身份、镜头变化与生成过程都有据可查。"
      ><router-link to="/video/new"><a-button type="primary">新建创作</a-button></router-link></PageHeader
    >
    <div class="library-toolbar">
      <div class="library-tabs">
        <router-link
          v-for="(label, key) in labels"
          :key="key"
          :class="{ selected: kind === key }"
          :to="`/video/library/${key}`"
          >{{ label }}</router-link
        >
      </div>
      <a-input
        v-model:value="search"
        allow-clear
        placeholder="搜索任务、角色或剧本"
      />
    </div>
    <a-skeleton
      v-if="store.loading && !entries.length"
      active
    />
    <div
      v-else-if="!entries.length"
      class="panel empty-state"
    >
      <h3>还没有{{ labels[kind] }}内容</h3>
      <p>启动视频生产后，已生成的剧本、角色与分镜会出现在这里。</p>
      <router-link to="/video/new">开始第一次创作 →</router-link>
    </div>
    <section
      v-for="task in entries"
      :key="task.id"
      class="panel"
    >
      <div class="section-head">
        <div>
          <span class="eyebrow">{{ task.id.slice(0, 18) }}</span>
          <h2>{{ task.title }}</h2>
        </div>
        <router-link :to="`/tasks/${task.id}`">查看与编辑 →</router-link>
      </div>
      <pre
        v-if="kind === 'scripts'"
        class="script"
        >{{ task.script }}</pre>
      <div
        v-else-if="kind === 'characters'"
        class="character-grid"
      >
        <article
          v-for="character in task.characters"
          :key="character.id"
          class="character"
        >
          <div class="character-monogram">{{ character.name.slice(0, 1) }}</div>
          <h3>{{ character.name }}</h3>
          <span class="chip">Character Bible</span>
          <h4>固定身份</h4>
          <p>{{ character.age }} 岁 · {{ character.gender }} · {{ character.identity }}</p>
          <p>{{ character.appearance }}</p>
          <h4>可变属性</h4>
          <p>服装：{{ character.outfit }}</p>
          <p>表情：{{ character.expression }} · 姿态：{{ character.pose }}</p>
          <small class="muted">调整镜头属性，不应改变角色固定身份。</small>
        </article>
      </div>
      <div
        v-else
        class="shot-timeline"
      >
        <article
          v-for="(shot, index) in task.shots"
          :key="shot.id"
          class="shot"
        >
          <span class="eyebrow"
            >SHOT {{ String(index + 1).padStart(2, '0') }} · {{ shot.start.toFixed(1) }}–{{
              shot.end.toFixed(1)
            }}s</span
          >
          <h3>{{ shot.camera }}</h3>
          <p>{{ shot.description }}</p>
          <dl>
            <dt>人物 / 情绪</dt>
            <dd>{{ shot.character }} · {{ shot.emotion }}</dd>
            <dt>首帧 → 尾帧</dt>
            <dd>{{ shot.firstPrompt }} → {{ shot.lastPrompt }}</dd>
            <dt>剧情桥</dt>
            <dd>{{ shot.bridge }}</dd>
            <dt>连续性</dt>
            <dd>{{ shot.continuity }}</dd>
          </dl>
        </article>
      </div>
    </section>
  </div>
</template>
<style scoped>
.library-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.library-toolbar > .ant-input-affix-wrapper {
  max-width: 280px;
}
.library-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.library-tabs a {
  padding: 9px 12px;
  border-radius: 8px;
  background: white;
  color: #818292;
}
.library-tabs a.selected {
  background: #eae8fc;
  color: #635bdb;
}
.script {
  font: inherit;
  line-height: 2;
  background: #fafafe;
  padding: 20px;
  border-radius: 10px;
}
.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.character {
  padding: 20px;
  border: 1px solid #eae9f3;
  border-radius: 12px;
  background: #fbfbfe;
  overflow-wrap: anywhere;
}
.character-monogram {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: #eeeafa;
  color: #635bdb;
  font-size: 22px;
}
.character h3 {
  margin: 15px 0 10px;
}
.character h4 {
  color: #696582;
  margin-top: 20px;
}
.character p {
  font-size: 12px;
  color: #858292;
  line-height: 1.8;
}
.shot-timeline {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 12px;
}
.shot {
  flex: 0 0 300px;
  border: 1px solid #e8e7f1;
  border-top: 3px solid #7c75dc;
  padding: 20px;
  border-radius: 12px;
  background: #fcfcff;
}
.shot p,
.shot dd {
  font-size: 12px;
  line-height: 1.8;
  color: #7b7d90;
}
.shot dt {
  font-size: 11px;
  color: #aaa;
  margin-top: 12px;
}
.shot dd {
  margin: 5px 0;
}
@media (max-width: 600px) {
  .library-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .library-toolbar > .ant-input-affix-wrapper {
    max-width: none;
  }
  .shot {
    flex-basis: 260px;
  }
}
</style>
