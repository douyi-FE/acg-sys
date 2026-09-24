<script setup lang="ts">
/* global window, URL, Blob, document, setTimeout */
import { computed, nextTick, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { useFactoryStore } from '../../stores/factory'
import type { Article } from '../../types'
import PageHeader from '../../components/PageHeader.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { useFieldValidation, required } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

const store = useFactoryStore()
const route = useRoute()
const article = ref<Article | null>(null)
const baseline = ref('')
const busy = ref('')
const error = ref('')
const notice = ref('')
const suggestion = ref('')
const suggestionTarget = ref<'title' | 'body'>('body')
const operation = ref('润色')
const safetyEdited = ref(false)
const responsibilityConfirmed = ref(false)
const requireContent = ref(false)
const dirty = computed(() => !!article.value && JSON.stringify(article.value) !== baseline.value)
const id = computed(() => String(route.params.id || ''))
const savedArticle = computed(() => store.db.articles.find((a) => a.id === id.value))
const task = computed(() => store.db.tasks.find((t) => t.id === savedArticle.value?.taskId))
const terminal = computed(() => task.value?.status === 'SUCCESS' || task.value?.status === 'CANCELLED')
const readonly = computed(() => terminal.value || !task.value)
const editingDisabled = computed(() => !!busy.value || readonly.value)
const contentChanged = computed(
  () =>
    !!article.value &&
    !!savedArticle.value &&
    (article.value.title !== savedArticle.value.title ||
      article.value.body !== savedArticle.value.body ||
      article.value.outline !== savedArticle.value.outline ||
      article.value.platform !== savedArticle.value.platform),
)
watch(
  () => [id.value, savedArticle.value] as const,
  ([, found]) => {
    if (article.value?.id === id.value && dirty.value) return
    if (article.value?.id === id.value && JSON.stringify(found) === baseline.value) return
    article.value = found ? JSON.parse(JSON.stringify(found)) : null
    baseline.value = JSON.stringify(article.value)
    suggestion.value = ''
    notice.value = ''
    error.value = ''
    safetyEdited.value = false
    responsibilityConfirmed.value = false
  },
  { immediate: true, deep: true },
)
function allowLeave() {
  return !busy.value && (!dirty.value || window.confirm('有尚未保存的修改，确定离开？'))
}
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate((to) => String(to.params.id) === id.value || allowLeave())
function invalidate() {
  if (!article.value || readonly.value) return
  article.value.status = 'draft'
  article.value.safety = article.value.safety.map((s) => ({
    ...s,
    status: '待核实',
    reason: '内容已修改，需要重新人工核验',
  }))
  safetyEdited.value = false
  responsibilityConfirmed.value = false
  notice.value = ''
}
function editSafety() {
  if (!article.value || editingDisabled.value) return
  article.value.status = 'review'
  safetyEdited.value = true
  responsibilityConfirmed.value = false
  notice.value = ''
}
function discard() {
  if (busy.value || !window.confirm('丢弃未保存修改并恢复已保存版本？')) return
  article.value = savedArticle.value ? JSON.parse(JSON.stringify(savedArticle.value)) : null
  baseline.value = JSON.stringify(article.value)
  suggestion.value = ''
  safetyEdited.value = false
  responsibilityConfirmed.value = false
  error.value = ''
}
async function persist(message = '文章已保存', complete = false) {
  if (busy.value) return false
  if (readonly.value) {
    error.value = terminal.value
      ? '关联任务已结束，文章只读，可下载已保存版本'
      : '关联任务不存在，无法保存文章'
    return false
  }
  requireContent.value = complete || safetyEdited.value
  await nextTick()
  if (!article.value || !validateFields()) return false
  busy.value = 'save'
  error.value = ''
  notice.value = ''
  try {
    if (JSON.stringify(savedArticle.value) !== baseline.value)
      throw new Error('已保存文章已更新，请复制需要保留的草稿，再撤销修改并重新编辑，避免覆盖新内容')
    const copy: Article = JSON.parse(JSON.stringify(article.value))
    copy.title = copy.title.trim()
    copy.updatedAt = new Date().toISOString()
    await store.saveArticle(copy)
    article.value = JSON.parse(JSON.stringify(store.db.articles.find((a) => a.id === copy.id) || copy))
    baseline.value = JSON.stringify(article.value)
    notice.value = message
    safetyEdited.value = false
    responsibilityConfirmed.value = false
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
    return false
  } finally {
    busy.value = ''
  }
}
async function generate() {
  if (!article.value || editingDisabled.value) return
  requireContent.value = true
  await nextTick()
  if (!validateFields()) return
  error.value = ''
  suggestion.value = ''
  const text = article.value.body.trim()
  suggestionTarget.value = operation.value === '标题' ? 'title' : 'body'
  if (operation.value === '标题')
    suggestion.value = `${article.value.title.replace(/[。！!]+$/, '')}：关键进展与观察`
  else if (!text) {
    validateFields()
    return
  } else if (operation.value === '扩写')
    suggestion.value = `${text}\n\n【补充分析 · 本地模拟】\n理解这一事件，需要进一步梳理背景、相关方的公开回应与时间线。可能的影响仍需以可验证的资料为依据，不应把推测当作结论。`
  else if (operation.value === '缩写')
    suggestion.value = text
      .split(/(?<=[。！？.!?])\s*/)
      .filter(Boolean)
      .slice(0, 3)
      .join('')
      .slice(0, 400)
  else if (operation.value === '摘要')
    suggestion.value = `摘要（本地提取，待核验）：\n${text.slice(0, 180)}${text.length > 180 ? '…' : ''}`
  else
    suggestion.value = text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((s) => s.trim())
      .join('\n')
}
async function apply() {
  if (!article.value || !suggestion.value || editingDisabled.value) return
  if (suggestionTarget.value === 'body' && !window.confirm('用建议内容替换正文并保存？')) return
  article.value[suggestionTarget.value] = suggestion.value
  invalidate()
  if (await persist('AI 建议已应用并保存')) suggestion.value = ''
}
async function check() {
  if (!article.value || editingDisabled.value) return
  requireContent.value = true
  await nextTick()
  if (!validateFields()) return
  if (
    article.value.safety.length &&
    !window.confirm('重新运行本地检查会替换当前核验结果及理由，之后仍需人工核验。继续？')
  )
    return
  const text = `${article.value.title}\n${article.value.body}`
  const risky = /百分之百|100%|稳赚|绝对安全|包治/.test(text)
  article.value.safety = [
    {
      name: '夸大与承诺用语',
      status: risky ? '风险' : '通过',
      reason: risky ? '检测到绝对化用语，请修订' : '本地关键词规则未命中；不代表合规保证',
    },
    {
      name: '事实与来源',
      status: '待核实',
      reason: '需人工对照原始来源、发表时间与引述，模拟检查无法验证真实性',
    },
    { name: '版权与隐私', status: '待核实', reason: '需人工确认素材授权、个人信息与引用许可' },
    {
      name: '正文完整性',
      status: article.value.body.trim() ? '通过' : '风险',
      reason: article.value.body.trim() ? '正文非空' : '尚未填写正文',
    },
  ]
  article.value.status = 'review'
  safetyEdited.value = false
  responsibilityConfirmed.value = false
  await persist('本地检查结果已保存；待核实项仍需人工核验', true)
}
async function exportArticle() {
  if (!article.value || busy.value) return
  if (!readonly.value && dirty.value && !(await persist())) return
  // 任务在编辑期间进入终态时，仍仅导出服务层已保存版本，不保存陈旧草稿。
  const a = savedArticle.value
  if (!a) {
    error.value = '没有可导出的已保存版本'
    return
  }
  const text = `# ${a.title}\n\n${a.outline ? `## 提纲\n${a.outline}\n\n` : ''}${a.body}\n\n---\n本地草稿导出，未经自动发布。\n核验状态：\n${a.safety.map((s) => `- ${s.name}：${s.status}（${s.reason}）`).join('\n')}`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${a.title.replace(/[\\/:*?"<>|]/g, '_') || 'article'}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  notice.value =
    readonly.value && dirty.value
      ? '已导出已保存版本，未包含本地未保存修改；未执行发布'
      : '已导出保存版本；未执行发布'
}
</script>

<template>
  <div class="page-stack">
    <a-alert v-if="route.query.created === '1' && article" type="success" message="热点文章已创建，标题与提纲已保存。请在下方编辑正文，再保存文章。" show-icon />
    <PageHeader
      title="文章工作台"
      description="编辑、核验与导出。所有 AI 操作均为本地模拟，不会发布到外部平台。"
      eyebrow="ARTICLE STUDIO"
    >
      <div class="actions">
        <router-link
          v-if="task && route.query.reviewTask === task.id"
          :to="`/tasks/${encodeURIComponent(task.id)}#review-preview`"
        >返回任务审核预览</router-link>
        <router-link
          v-if="task"
          :to="`/tasks/${encodeURIComponent(task.id)}`"
          >关联任务详情</router-link
        ><a-button
          :disabled="!article || !!busy"
          @click="exportArticle"
          >{{ readonly ? '下载已保存版本' : '保存并导出' }}</a-button
        ><a-button
          type="primary"
          :loading="busy === 'save'"
          :disabled="!article || editingDisabled"
          @click="persist()"
          >保存文章</a-button
        >
      </div>
    </PageHeader>
    <a-alert
      v-if="error || store.error"
      type="error"
      :message="error || String(store.error)"
      show-icon
    />
    <a-alert
      v-if="notice"
      type="success"
      :message="notice"
      show-icon
    />
    <a-alert
      v-if="article && readonly"
      type="warning"
      show-icon
      :message="
        terminal
          ? `关联任务为 ${task?.status}，文章及核验结果只读，仍可下载已保存版本。`
          : '关联任务不存在，文章只读，仍可下载已保存版本。'
      "
    />
    <a-alert
      v-if="contentChanged"
      type="warning"
      show-icon
      message="内容已变更，旧质量评分与旧审核结论不适用于当前草稿。保存将通过 saveArticle 使任务旧评分失效；请在任务详情重新质检及审核。"
    />
    <div
      v-if="!article"
      class="panel empty-state"
    >
      {{ store.loading ? '正在加载文章…' : '未找到文章，请从热点驾驶舱创建或重新选择文章。' }}
    </div>
    <div
      v-else
      class="editor-grid"
    >
      <section class="panel editor">
        <div class="section-head">
          <h2>文章草稿</h2>
          <div class="actions">
            <StatusBadge :status="article.status" /><span class="muted">{{
              dirty ? '有未保存修改' : '已保存'
            }}</span
            ><a-button
              v-if="dirty"
              size="small"
              :disabled="!!busy"
              @click="discard"
              >撤销修改</a-button
            >
          </div>
        </div>
        <fieldset :disabled="editingDisabled">
          <label v-field="requireContent || safetyEdited ? required(article.title, '文章标题') : undefined" class="field"
            >标题<a-input
              v-model:value="article.title"
              :disabled="editingDisabled"
              :maxlength="200"
              @change="invalidate"
          /></label>
          <label v-field="required(article.platform, '目标平台')" class="field"
            >目标平台<a-input
              v-model:value="article.platform"
              :disabled="editingDisabled"
              @change="invalidate"
          /></label>
          <label v-field="required(article.outline, '创作提纲')" class="field"
            >提纲<a-textarea
              v-model:value="article.outline"
              :disabled="editingDisabled"
              :rows="4"
              @change="invalidate"
          /></label>
          <label v-field="requireContent || safetyEdited ? required(article.body, '文章正文') : undefined" class="field"
            >正文 <span class="muted">{{ article.body.length }} 字符</span
            ><a-textarea
              v-model:value="article.body"
              :disabled="editingDisabled"
              :rows="20"
              placeholder="开始写作…"
              @change="invalidate"
          /></label>
        </fieldset>
      </section>
      <aside class="assistant-panel">
        <section class="panel">
          <h2>AI 写作助手 <span class="chip">本地模拟</span></h2>
          <p class="muted">仅通过本地规则生成建议，不调用模型、不检索事实。应用后会自动保存。</p>
          <a-select
            v-model:value="operation"
            class="full"
            :disabled="editingDisabled"
            aria-label="写作操作"
            :options="
              ['标题', '润色', '扩写', '缩写', '摘要'].map((v) => ({
                value: v,
                label: v === '标题' ? '标题优化' : v,
              }))
            "
          />
          <a-button
            class="full generate"
            :disabled="editingDisabled"
            @click="generate"
            >生成建议</a-button
          >
          <template v-if="suggestion"
            ><label class="field"
              >建议预览（可编辑）<a-textarea
                v-model:value="suggestion"
                :disabled="editingDisabled"
                :rows="9" /></label
            ><a-button
              type="primary"
              :loading="!!busy"
              :disabled="editingDisabled"
              @click="apply"
              >应用并保存</a-button
            ></template
          >
        </section>
        <section class="panel">
          <div class="section-head">
            <h2>内容安全核验</h2>
            <a-button
              :disabled="editingDisabled"
              @click="check"
              >本地检查并保存</a-button
            >
          </div>
          <p class="muted">
            关键词检查仅供辅助。请逐项人工判断并填写理由、原始来源链接或授权记录；无法核实请保持“待核实”，发现问题请选择“风险”。来源与理由一并保存到
            safety.reason。
          </p>
          <div
            v-if="!article.safety.length"
            class="empty-state"
          >
            尚未执行核验
          </div>
          <div
            v-for="(s, index) in article.safety"
            :key="index"
            class="safety"
          >
            <div class="section-head">
              <b>{{ s.name }}</b
              ><a-tag :color="s.status === '风险' ? 'red' : s.status === '通过' ? 'green' : 'orange'">{{
                s.status
              }}</a-tag>
            </div>
            <label class="field"
              >人工核验结果<a-select
                v-model:value="s.status"
                :disabled="editingDisabled"
                :aria-label="`${s.name}人工核验结果`"
                :options="['通过', '风险', '待核实'].map((value) => ({ value, label: value }))"
                @change="editSafety"
            /></label>
            <label v-field="safetyEdited ? required(s.reason, '核验理由及来源') : undefined" class="field"
              >核验理由 / 来源<a-textarea
                v-model:value="s.reason"
                :disabled="editingDisabled"
                :rows="4"
                placeholder="填写判断依据、来源链接与时间，或授权凭据；不适用时说明原因。"
                @change="editSafety"
            /></label>
          </div>
          <template v-if="article.safety.length">
            <div v-field="safetyEdited && !responsibilityConfirmed ? '请确认人工核验责任' : undefined"><a-checkbox
              v-model:checked="responsibilityConfirmed"
              :disabled="editingDisabled || !safetyEdited"
              >我已逐项人工核验，确认上述结论及来源由我负责；模拟检查不能替代人工判断。</a-checkbox
            ></div>
            <a-button
              class="full generate"
              type="primary"
              :loading="!!busy"
              :disabled="editingDisabled || !safetyEdited"
              @click="persist('人工核验结果已保存，请到关联任务详情完成质量检查与最终审核')"
              >确认并保存人工核验</a-button
            >
            <p class="muted">保存核验不等于 approve 或发布。最终通过仍需任务质量达标，且所有安全项通过。</p>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 20px;
}
.editor,
.assistant-panel,
.panel {
  min-width: 0;
}
.assistant-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.field {
  display: grid;
  gap: 8px;
  margin: 20px 0;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.full {
  width: 100%;
}
.generate {
  margin-top: 12px;
}
.safety {
  border-top: 1px solid #eeeef4;
  padding-top: 16px;
  margin-top: 16px;
}
.safety p,
.assistant-panel p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
h2 {
  font-size: 17px;
}
.section-head {
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 900px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
