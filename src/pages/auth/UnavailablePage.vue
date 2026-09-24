<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()
const retrying = ref(false)
const backend = ref('检查中')
const database = ref('未知')
const preview = ref(false)
const selected = ref('工作台')
const pages = ['工作台', '视频工厂', '任务中心', '热点工厂', '文章库', '发布中心', '内容资产', '工作流', 'ComfyUI', '模型中心', '统计分析', '系统设置', '用户与权限']
async function health() {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) })
    const payload = await response.json()
    if (payload?.data?.backend !== 'up') throw new Error('Unavailable')
    backend.value = '可连接'
    database.value = payload.data.database === 'up' ? '已就绪' : '未就绪 (503)'
  } catch {
    backend.value = '不可连接'
    database.value = '未知（后端不可连接）'
  }
}
onMounted(health)
async function retry() {
  retrying.value = true
  try {
    await health()
    await auth.load()
    await router.replace(auth.session ? '/' : '/public')
  } catch {
    // The page remains visible with the latest backend error.
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <main class="unavailable-shell" role="status">
    <section class="unavailable-card">
      <p class="eyebrow">ACG CONTENT FACTORY</p>
      <h1>应用暂时不可用</h1>
      <p class="lead">前端已经启动，但后端依赖尚未就绪。没有创建模拟登录，也没有展示私有数据。</p>
      <div class="dependency-list">
        <div>后端：{{ backend }}</div>
        <div>数据库：{{ database }}</div>
        <div>ComfyUI / LLM：未探测，不影响页面启动</div>
        <div><span class="status-dot readonly" />当前页面：离线只读</div>
      </div>
      <p v-if="auth.error" class="error-copy">{{ auth.error }}</p>
      <div class="actions">
        <a-button type="primary" :loading="retrying" @click="retry">重试连接</a-button>
        <a-button @click="preview = !preview">{{ preview ? '关闭预览' : '选择浏览离线布局预览' }}</a-button>
      </div>
      <p class="footnote">预览仅展示导航和空布局，不加载业务页面、私有数据或模拟数据；所有功能操作均不可用。</p>
    </section>
    <section v-if="preview" class="preview" aria-label="离线布局预览">
      <nav aria-label="系统页面">
        <button v-for="page in pages" :key="page" :aria-current="selected === page ? 'page' : undefined" @click="selected = page">{{ page }}</button>
      </nav>
      <article>
        <p>离线 / 只读布局预览 · 未登录</p>
        <h2>{{ selected }}</h2>
        <p>连接恢复并通过权限校验后才能查看实际内容。</p>
        <p>暂无可显示数据。生成、编辑、导出和管理功能不可用。</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.unavailable-shell { min-height: 100vh; display: grid; place-items: center; padding: 32px; background: #f6f7fb; }
.unavailable-card { width: min(620px, 100%); padding: 40px; border: 1px solid #e6e8f0; border-radius: 18px; background: #fff; box-shadow: 0 18px 60px rgba(31, 35, 55, .08); }
.eyebrow { margin: 0 0 12px; color: #635bdb; font-size: 12px; font-weight: 700; letter-spacing: .12em; }
h1 { margin: 0 0 12px; color: #171925; font-size: 32px; }
.lead, .footnote { color: #697084; line-height: 1.7; }
.dependency-list { display: grid; gap: 12px; margin: 28px 0; padding: 18px; border-radius: 12px; background: #f8f9fc; color: #34394a; }
.status-dot { display: inline-block; width: 9px; height: 9px; margin-right: 10px; border-radius: 50%; }
.backend { background: #35a56a; } .database { background: #e49a36; } .readonly { background: #7d8498; }
.error-copy { color: #b42318; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; }
.footnote { margin: 20px 0 0; font-size: 12px; }
.preview { width: min(1100px, 100%); display: flex; gap: 32px; margin-top: 24px; padding: 24px; background: white; border-radius: 12px; }
.preview nav { display: grid; gap: 8px; min-width: 130px; }
.preview button { border: 1px solid #ddd; border-radius: 6px; padding: 8px; cursor: pointer; background: #fafafa; }
.preview button[aria-current] { color: #635bdb; border-color: #635bdb; }
@media (max-width: 600px) { .preview { flex-direction: column; } .unavailable-card { padding: 20px; } }
</style>
