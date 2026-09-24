<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFactoryStore } from '../../stores/factory'
import PageHeader from '../../components/PageHeader.vue'
import type { AIModel, VideoRequest, Workflow } from '../../types'
import { useFieldValidation, required, numberRange } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()

const store = useFactoryStore()
const router = useRouter()
const busy = ref(false)
const requestError = ref('')
const form = reactive<VideoRequest>({
  title: '',
  theme: '',
  type: '剧情短片',
  ratio: '9:16',
  duration: 30,
  platform: '抖音',
  style: '电影写实',
  characters: '',
  modelId: '',
  workflowId: '',
  scenario: 'normal',
})
// Match service eligibility: Video capability + enabled. Mock does not require a live connection.
const models = computed(() =>
  store.db.models.filter((model: AIModel) => model.enabled && model.capability === 'Video'),
)
const workflows = computed(() => store.db.workflows.filter((workflow: Workflow) => workflow.active))
watch(
  models,
  (available) => {
    if (!form.modelId) form.modelId = available[0]?.id ?? ''
  },
  { immediate: true },
)
watch(
  workflows,
  (available) => {
    if (!form.workflowId) form.workflowId = available[0]?.id ?? ''
  },
  { immediate: true },
)
const selectedModel = computed(() => models.value.find((model: AIModel) => model.id === form.modelId))
const selectedWorkflow = computed(() =>
  workflows.value.find((workflow: Workflow) => workflow.id === form.workflowId),
)
const ratios = ['9:16', '16:9', '1:1']
const pipeline = [
  { name: 'Writer', title: '脚本创作', description: '结合主题、风格与角色约束整理故事脚本。' },
  { name: 'Reviewer', title: '脚本审阅', description: '检查叙事逻辑、角色一致性与内容边界。' },
  { name: '评分 / 重试', title: '质量决策', description: '低于门限时按配置重试；超过上限转人工处理。' },
  { name: '角色', title: '角色设定', description: '固定身份与外貌，定义服装、表情和姿态。' },
  { name: '分镜', title: '镜头编排', description: '拆解时间线、镜头动作与剧情桥。' },
  { name: '首尾帧', title: '画面提示词', description: '编写首帧与尾帧 Prompt，保持镜头连续。' },
  { name: '视频', title: '模拟媒体制作', description: '按模型与工作流模拟视频、音频及合成阶段。' },
  {
    name: 'QA Pipeline',
    title: '质量检查与人工审核',
    description: '展示质量细则与建议，通过人工审核后导出制作包。',
  },
]
const scenarios = [
  { value: 'normal', label: '正常流程' },
  { value: 'quality', label: '质量未达标' },
  { value: 'system', label: '系统异常' },
  { value: 'timeout', label: '生成超时' },
]
async function submit() {
  if (busy.value || store.loading) return
  if (!validateFields()) return
  busy.value = true
  requestError.value = ''
  try {
    const request = { ...form }
    for (const key of ['title', 'theme', 'type', 'platform', 'style', 'characters'] as const)
      request[key] = request[key].trim()
    const task = await store.createVideo(request)
    await router.push(`/tasks/${task.id}`)
  } catch (error) {
    requestError.value = error instanceof Error ? error.message : '创建失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page-stack">
    <PageHeader
      title="AI 创作台"
      eyebrow="CREATE / VIDEO"
      description="定义故事、选择生产配置，开启可审阅的 AI 创作流程。"
    >
      <RouterLink to="/video"><a-button :disabled="busy">返回视频工厂</a-button></RouterLink>
    </PageHeader>
    <a-alert
      show-icon
      type="info"
      message="当前为 Mock 演示，不调用真实生成服务，也不产出真实视频。"
    />
    <a-alert
      v-if="requestError"
      show-icon
      type="error"
      :message="requestError"
    />
    <a-alert
      v-if="store.error"
      show-icon
      type="error"
      :message="String(store.error)"
    />
    <a-form
      layout="vertical"
      :model="form"
      @finish="submit"
    >
      <div class="studio">
        <section
          class="panel column"
          aria-label="创作参数"
        >
          <div class="section-title">
            <span>01</span>
            <h2>创作参数</h2>
          </div>
          <h3>故事与灵感</h3>
          <a-form-item
            v-field="required(form.title, '任务标题')"
            label="任务标题"
            required
            ><a-input
              v-model:value="form.title"
              :maxlength="100"
              show-count
              placeholder="为这次创作命名"
              :disabled="busy"
          /></a-form-item>
          <a-form-item
            v-field="required(form.theme, '创作主题')"
            label="创作主题 / 故事梗概"
            required
            ><a-textarea
              v-model:value="form.theme"
              :rows="7"
              :maxlength="5000"
              show-count
              placeholder="描述故事背景、核心冲突、情绪和结局…"
              :disabled="busy"
          /></a-form-item>
          <a-form-item
            v-field="required(form.characters, '角色设定')"
            label="角色设定"
            required
            ><a-textarea
              v-model:value="form.characters"
              :rows="5"
              :maxlength="3000"
              show-count
              placeholder="人物身份、外貌特征、关系与性格；无人物可填写“无角色”"
              :disabled="busy"
          /></a-form-item>
          <p class="muted">清晰的角色和故事约束，有助于后续脚本与分镜保持一致。</p>
          <h3>画面与规格</h3>
          <a-form-item
            v-field="required(form.type, '视频类型')"
            label="视频类型"
            required
            ><a-input
              v-model:value="form.type"
              :maxlength="100"
              placeholder="剧情短片 / 产品介绍 / 知识科普"
              :disabled="busy"
          /></a-form-item>
          <div class="pair">
            <a-form-item
              v-field="ratios.includes(form.ratio) ? undefined : '请选择有效画幅'"
              label="画面比例"
              required
              ><a-select
                v-model:value="form.ratio"
                aria-label="画面比例"
                :disabled="busy"
                :options="ratios.map((value) => ({ value, label: value }))"
            /></a-form-item>
            <a-form-item
              v-field="numberRange(form.duration, 5, 600, true)"
              label="时长（秒）"
              required
              ><a-input-number
                v-model:value="form.duration"
                :min="5"
                :max="600"
                :precision="0"
                :disabled="busy"
            /></a-form-item>
          </div>
          <a-form-item
            v-field="required(form.platform, '发布平台')"
            label="发布平台"
            required
            ><a-input
              v-model:value="form.platform"
              :maxlength="100"
              placeholder="抖音 / 小红书 / B站"
              :disabled="busy"
          /></a-form-item>
          <a-form-item
            v-field="required(form.style, '视觉风格')"
            label="视觉风格"
            required
            ><a-textarea
              v-model:value="form.style"
              :rows="4"
              :maxlength="500"
              placeholder="光影、色调、镜头质感与美术风格"
              :disabled="busy"
          /></a-form-item>
          <h3>模型与运行配置</h3>
          <a-form-item
            v-field="selectedModel ? undefined : '请选择已启用的视频模型'"
            label="AI 模型"
            required
            ><a-select
              v-model:value="form.modelId"
              aria-label="AI 模型"
              :disabled="busy || store.loading"
              :options="
                models.map((model: AIModel) => ({
                  value: model.id,
                  label: `${model.name} · ${model.capability}`,
                }))
              "
              placeholder="选择视频模型"
          /></a-form-item>
          <a-form-item
            v-field="!selectedWorkflow ? '请选择已启用的工作流' : !/video|视频/i.test(selectedWorkflow.type) ? '视频任务需要视频工作流' : selectedModel?.provider !== selectedWorkflow.provider ? '工作流与模型提供方不匹配' : undefined"
            label="工作流"
            required
            ><a-select
              v-model:value="form.workflowId"
              aria-label="工作流"
              :disabled="busy || store.loading"
              :options="
                workflows.map((workflow: Workflow) => ({
                  value: workflow.id,
                  label: `${workflow.name} · ${workflow.version}`,
                }))
              "
          /></a-form-item>
          <p class="muted">{{ selectedWorkflow?.description || '选择工作流以查看生产说明。' }}</p>
          <a-form-item
            v-field="scenarios.some(item => item.value === form.scenario) ? undefined : '请选择模拟场景'"
            label="异常模拟场景（仅 Mock）"
            required
            ><a-select
              v-model:value="form.scenario"
              :disabled="busy"
              :options="scenarios"
          /></a-form-item>
        </section>
        <section
          class="panel column workflow-column"
          aria-label="AI 工作流"
        >
          <div class="section-title">
            <span>02</span>
            <h2>AI 工作流</h2>
          </div>
          <p class="muted">创作流程示意 · 尚未执行</p>
          <p class="workflow-name">
            {{ selectedWorkflow?.name || '待选择工作流' }} <small>{{ selectedWorkflow?.version }}</small>
          </p>
          <ol
            class="pipeline"
            aria-label="AI 创作流程"
          >
            <li
              v-for="(step, index) in pipeline"
              :key="step.name"
            >
              <span class="node-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="node-body">
                <strong>{{ step.name }}</strong>
                <h3>{{ step.title }}</h3>
                <p>{{ step.description }}</p>
                <div
                  v-if="index === 2"
                  class="retry-loop"
                >
                  未达标 ↺ Writer → Reviewer<br />门限 {{ store.db.settings.threshold }} · 自动重试{{
                    store.db.settings.autoRetry ? '开启' : '关闭'
                  }}
                  · 最多重试 {{ store.db.settings.maxRetries }} 次 · 最多迭代
                  {{ store.db.settings.maxIterations }} 次
                </div>
              </div>
            </li>
          </ol>
          <p class="muted workflow-note">
            这是创作逻辑示意，不表示服务已独立执行 Writer /
            Reviewer。实际阶段、评分与重试记录以创建后的任务详情为准。
          </p>
        </section>
        <section
          class="panel column result-column"
          aria-label="本地创作预览"
        >
          <div class="section-title">
            <span>03</span>
            <h2>实时创作预览</h2>
          </div>
          <span class="chip">本地输入预览 · Mock</span>
          <div class="preview">
            <div
              class="preview-frame"
              :style="{ aspectRatio: form.ratio.replace(':', '/') }"
            >
              <strong>{{ form.title.trim() || '为你的故事命名' }}</strong
              ><span>{{ form.ratio }}</span
              ><small>{{ form.style.trim() || '待设置风格' }}</small>
            </div>
            <small>画幅与标题示意 · 非生成图片或视频</small>
          </div>
          <div
            class="local-copy"
            data-testid="creation-preview"
          >
            <h3>故事梗概</h3>
            <p>{{ form.theme.trim() || '填写左侧主题，在此实时预览故事方向。' }}</p>
            <h3>角色设定</h3>
            <p>{{ form.characters.trim() || '尚未填写角色设定' }}</p>
          </div>
          <div class="summary">
            <strong>制作规格</strong>
            <dl>
              <dt>类型</dt>
              <dd>{{ form.type || '—' }}</dd>
              <dt>时长 / 画幅</dt>
              <dd>{{ form.duration || '—' }} 秒 / {{ form.ratio }}</dd>
              <dt>发布平台</dt>
              <dd>{{ form.platform || '—' }}</dd>
              <dt>视频模型</dt>
              <dd>{{ selectedModel?.name || '未选择可用视频模型' }}</dd>
              <dt>工作流</dt>
              <dd>{{ selectedWorkflow?.name || '未选择可用工作流' }}</dd>
              <dt>模拟场景</dt>
              <dd>{{ scenarios.find((item) => item.value === form.scenario)?.label || '—' }}</dd>
            </dl>
            <small
              >这里只展示本地输入，不调用 AI
              生成内容。提交后进入任务详情查看实际模拟进度、编辑内容与审核结果。</small
            >
          </div>
          <a-button
            block
            type="primary"
            size="large"
            html-type="submit"
            :loading="busy"
            :disabled="store.loading"
            >AI自动创作</a-button
          >
          <p class="muted submit-note">不会生成真实视频；最终可导出 JSON 制作包。</p>
        </section>
      </div>
    </a-form>
  </main>
</template>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.column {
  padding: 24px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 26px;
}
.section-title span {
  color: #635bdb;
  background: #f0edff;
  padding: 8px;
  border-radius: 10px;
  font-weight: 700;
}
.section-title h2 {
  font-size: 18px;
  margin: 0;
}
.column h3 {
  font-size: 14px;
  margin: 24px 0 14px;
  color: #514b72;
}
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
.pair :deep(.ant-input-number) {
  width: 100%;
}
.preview {
  margin-top: 20px;
  padding: 18px;
  border: 1px dashed #d9d5f1;
  background: #f8f7fc;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8179b7;
}
.preview-frame {
  width: 100%;
  max-width: 230px;
  min-width: 0;
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid #d5cfef;
  border-radius: 10px;
  background: linear-gradient(145deg, #eeebff, #faf9ff);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  overflow: hidden;
}
.preview-frame strong,
.preview-frame small {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 100%;
}
.preview-frame span {
  font-size: 12px;
}
.summary {
  padding: 18px;
  background: #f7f6fc;
  border-radius: 12px;
  margin: 24px 0;
  color: #625d79;
}
.summary strong {
  color: #29263d;
}
.summary small {
  line-height: 1.8;
}
.summary dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  font-size: 12px;
  margin: 18px 0;
}
.summary dt {
  color: #8b869c;
}
.summary dd {
  margin: 0;
  text-align: right;
}
.local-copy p {
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
  line-height: 1.8;
  color: #716b83;
  font-size: 13px;
}
.pipeline {
  list-style: none;
  margin: 24px 0;
  padding: 0;
}
.pipeline li {
  display: flex;
  gap: 12px;
  position: relative;
  padding-bottom: 24px;
}
.pipeline li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  border-left: 2px solid #e4dff8;
}
.pipeline li:not(:last-child)::after {
  content: '↓';
  position: absolute;
  left: 9px;
  bottom: 2px;
  color: #a499d4;
  background: white;
}
.node-number {
  z-index: 1;
  flex: 0 0 32px;
  height: 32px;
  border-radius: 10px;
  background: #eeebff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #635bdb;
}
.node-body {
  flex: 1;
  min-width: 0;
  padding: 14px;
  border: 1px solid #eae6f6;
  border-radius: 10px;
  background: #fdfcff;
}
.node-body > strong {
  color: #635bdb;
  font-size: 14px;
}
.node-body h3 {
  margin: 6px 0;
  font-size: 13px;
}
.node-body p {
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
  color: #817b90;
}
.retry-loop {
  margin-top: 12px;
  border: 1px dashed #d0c8ed;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  line-height: 1.8;
  color: #716499;
}
.workflow-name {
  font-weight: 600;
  color: #514b72;
}
.workflow-name small {
  font-weight: 400;
}
.workflow-note,
.submit-note {
  font-size: 12px;
}
.submit-note {
  text-align: center;
}
.warning {
  color: #ad681b;
}
.muted {
  line-height: 1.7;
}
:deep(.ant-select) {
  width: 100%;
}
:deep(.ant-select-selection-item) {
  min-width: 0;
}
@media (max-width: 1100px) {
  .studio {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .result-column {
    grid-column: 1/-1;
  }
  .preview-frame {
    max-width: 200px;
  }
}
@media (max-width: 700px) {
  .studio {
    grid-template-columns: minmax(0, 1fr);
  }
  .result-column {
    grid-column: auto;
  }
  .column {
    padding: 18px;
  }
  .section-title {
    margin-bottom: 20px;
  }
}
</style>
<style scoped>
@media (max-width: 700px) {
  :deep(button[type='submit']) {
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: calc(100% - 32px);
    z-index: 6;
    box-shadow: 0 8px 22px #635bdb44;
  }
  .studio {
    padding-bottom: 40px;
  }
}
</style>
