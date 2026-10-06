import type { Article, Asset, Database, PipelineStage, VideoRequest, VideoTask } from '../types'
import { pipelineDefinitions } from '../orchestrator/definitions'

export const now = () => new Date().toISOString()
export const uid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const videoStages = [
  ['SCRIPT', '剧本生成'],
  ['CHARACTER', '角色设计'],
  ['STORYBOARD', '分镜规划'],
  ['PROMPT', '首尾帧 Prompt'],
  ['IMAGE', '模拟图像'],
  ['VIDEO', '模拟视频'],
  ['AUDIO', '模拟配音'],
  ['SUBTITLE', '字幕文本'],
  ['COMPOSE', '模拟合成'],
  ['QA', '质量门限'],
  ['PUBLISH', '人工审核'],
] as const

const articleStages = [
  ['HOT_TOPIC', '热点'],
  ['TOPIC', '选题'],
  ['OUTLINE', '大纲'],
  ['GENERATE', '生成'],
  ['ARTICLE_REVIEW', '内容 review'],
  ['FACT', '事实核验'],
  ['SAFETY', '安全检查'],
  ['TITLE', '标题'],
  ['ILLUSTRATION', '配图建议（Mock）'],
  ['FINAL_REVIEW', '最终人工审核'],
] as const

export function createStages(kind: VideoTask['kind'] = 'video'): PipelineStage[] {
  return (kind === 'article' ? articleStages : videoStages).map(([key, name]) => ({
    key,
    name,
    status: 'pending',
    duration: 0,
    input: '',
    output: '',
    prompt: '',
    model: '',
    workflow: '',
    seed: 842103,
  }))
}

export function createTask(request: VideoRequest, kind: VideoTask['kind'] = 'video'): VideoTask {
  const time = now()
  return {
    id: uid(kind),
    title: request.title,
    kind,
    status: 'QUEUED',
    progress: 0,
    stageIndex: 0,
    stages: createStages(kind),
    createdAt: time,
    updatedAt: time,
    elapsed: 0,
    estimated: 0,
    modelId: request.modelId,
    workflowId: request.workflowId,
    cover: '',
    request: clone(request),
    script: '',
    previousScript: '',
    characters: [],
    shots: [],
    quality: null,
    logs: [],
    retries: 0,
    approved: false,
  }
}

/** 每次返回独立对象；所有来源、模型连接和媒体能力均为演示数据。 */
export function createSeed(): Database {
  return {
    version: 3,
    tasks: [],
    articles: [],
    assets: [],
    settings: { threshold: 90, maxRetries: 2, maxIterations: 3, autoRetry: true, stageDuration: 2200 },
    models: [
      {
        id: 'minimax-h3',
        name: 'MiniMax H3（Mock）',
        provider: 'Mock',
        capability: 'Video',
        enabled: true,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
      {
        id: 'qwen-max',
        name: 'Qwen Max（Mock）',
        provider: 'Mock',
        capability: 'LLM',
        enabled: true,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
      {
        id: 'flux-pro',
        name: 'Flux（Mock）',
        provider: 'Mock',
        capability: 'Image',
        enabled: true,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
      {
        id: 'comfyui-local',
        name: 'ComfyUI（未连接）',
        provider: 'ComfyUI',
        capability: 'Video',
        enabled: false,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
      {
        id: 'whisper-large',
        name: 'Whisper（Mock）',
        provider: 'Mock',
        capability: 'Audio',
        enabled: true,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
      {
        id: 'mock-vision',
        name: '视觉评估（Mock）',
        provider: 'Mock',
        capability: 'Vision',
        enabled: true,
        connected: false,
        calls: 0,
        latency: 0,
        failureRate: 0,
      },
    ],
    workflows: [
      {
        id: 'minimax-video-v1',
        name: 'MiniMax H3 Mock',
        type: 'Image to Video',
        provider: 'Mock',
        version: '0.0.0',
        active: true,
        description: '仅模拟调度；真实 ComfyUI API 图和 mapping 尚未配置。',
        mapping: {},
        history: [],
      },
      {
        id: 'storyboard-v2',
        name: '文章与分镜 Mock',
        type: 'Text to Image',
        provider: 'Mock',
        version: '0.0.0',
        active: true,
        description: '本地文本生成，不调用真实模型。',
        mapping: {},
        history: [],
      },
      {
        id: 'article-text',
        name: '文章文本 Mock',
        type: 'Text to Text',
        provider: 'Mock',
        version: '0.0.0',
        active: true,
        description: '本地文章流水线，不调用真实模型。',
        mapping: {},
        history: [],
      },
      {
        id: 'mock-audio',
        name: '语音 Mock',
        type: 'Text to Audio',
        provider: 'Mock',
        version: '0.0.0',
        active: true,
        description: '模拟语音调度，不生成媒体。',
        mapping: {},
        history: [],
      },
      {
        id: 'mock-vision',
        name: '视觉质量 Mock',
        type: 'Vision',
        provider: 'Mock',
        version: '0.0.0',
        active: true,
        description: '模拟视觉评分，不检查真实媒体。',
        mapping: {},
        history: [],
      },
    ],
    pipelines: pipelineDefinitions(),
    qualityConfigs: [],
    providerRegistry: [
      { provider: 'Mock', workflowKinds: ['text', 'image', 'video', 'audio', 'vision', 'embedding'] },
      { provider: 'ComfyUI', workflowKinds: ['image', 'video', 'audio'] },
    ],
    topics: [
      {
        id: 'topic-1',
        title: 'AI 视频创作工作流（演示话题）',
        category: '科技',
        heat: 92,
        growth: 38,
        sources: [],
        summary: '这是用于演示的合成话题，不代表实时新闻或真实热度。',
        analysis: [],
        risk: '所有事实与数字均待核实，不可直接作为新闻发布。',
        analyzed: false,
      },
      {
        id: 'topic-2',
        title: '用 AI 管理知识（演示话题）',
        category: '生活',
        heat: 86,
        growth: 24,
        sources: [],
        summary: '探讨知识管理方法的模拟选题。',
        analysis: [],
        risk: '效率与隐私相关结论待核实。',
        analyzed: false,
      },
    ],
  }
}

/** 纯构造函数，不持久化。UI 必须显式调用 store.loadDemo 追加，不能用它覆盖工作空间。 */
export function createDemoSeed(source: Database = createSeed()): Database {
  const demo = clone(source)
  const model = source.models.find((m) => m.enabled && m.capability === 'Video' && m.provider === 'Mock')
  const workflow = source.workflows.find(
    (w) => w.active && w.provider === 'Mock' && /to video$/i.test(w.type),
  )
  if (!model || !workflow) throw new Error('加载示例需要启用的 Mock Video 模型和视频工作流')
  const examples = [
    {
      title: '陈默的裁员通知',
      theme: '35岁程序员收到裁员通知，在下班路上决定重新出发',
      characters: '陈默，35岁，短黑发，深色眼睛，偏瘦',
    },
    {
      title: '地铁故事 · 最后一班车',
      theme: '末班地铁里，一位陌生人的善意改变了疲惫女孩的夜晚',
      characters: '年轻女孩、值班员',
    },
    {
      title: '城市清晨 · 60 秒观察',
      theme: '从清晨街巷的微小细节，记录城市苏醒的瞬间',
      characters: '城市行人',
    },
  ]
  demo.tasks = (['normal', 'quality', 'system'] as const).map((scenario, i) =>
    createTask({
      ...examples[i]!,
      type: '短剧',
      ratio: '9:16',
      duration: 30,
      platform: '演示',
      style: '克制写实、电影感',
      modelId: model.id,
      workflowId: workflow.id,
      scenario,
    }),
  )
  const articleModel = source.models.find(
    (item) => item.enabled && item.capability === 'LLM' && item.provider === 'Mock',
  )
  const articleWorkflow = source.workflows.find(
    (item) => item.active && item.provider === 'Mock' && /Text to Text/i.test(item.type),
  )
  const articleTopic = demo.topics[0]
  if (!articleModel || !articleWorkflow || !articleTopic)
    throw new Error('加载图文示例需要启用的 Mock LLM、文本工作流和话题')
  const articleTask = createTask({
    title: '图文示例 · AI 内容工厂的一天',
    theme: '用一个具体工作日，解释 AI 内容生产如何经过选题、事实核验和人工审核后交付。',
    type: '图文',
    ratio: '1:1',
    duration: 30,
    platform: '微信公众号',
    style: '清晰、克制、编辑感',
    characters: '内容编辑、审核员',
    modelId: articleModel.id,
    workflowId: articleWorkflow.id,
    scenario: 'normal',
  }, 'article')
  articleTask.status = 'REVIEWING'
  articleTask.progress = 100
  articleTask.stageIndex = articleTask.stages.length - 1
  articleTask.stages = articleTask.stages.map((stage, index) => ({
    ...stage,
    status: index === articleTask.stages.length - 1 ? 'running' : 'success',
    output: index === articleTask.stages.length - 1 ? '' : `Mock 已保存阶段输出：${stage.name}`,
  }))
  articleTask.quality = {
    score: 96,
    passed: true,
    threshold: 90,
    criteria: [
      { name: '结构完整', score: 96, passed: true, reason: '包含标题、正文、事实核验和交付说明。' },
      { name: '风险可控', score: 95, passed: true, reason: '未发现未处理的高风险表达。' },
    ],
    suggestions: [],
  }
  articleTask.createdAt = articleTask.updatedAt = now()
  articleTask.estimated = 0
  articleTask.logs.push({ id: uid('log'), time: now(), level: 'info', message: 'Mock 图文示例；预先生成的 AI 配图，不代表流水线调用真实模型' })
  const article: Article = {
    id: uid('article'),
    topicId: articleTopic.id,
    taskId: articleTask.id,
    title: articleTask.title,
    outline: '一、内容生产的一天\n二、事实核验如何介入\n三、人工审核后的交付',
    body: `# AI 内容工厂的一天

## 从选题到交付

一条内容真正进入发布环节前，需要经过选题、结构整理、正文生成、事实核验和安全检查。AI 可以帮助编辑快速整理素材，但不能替代对来源、表达和风险的最终判断。

## 为什么要保留人工审核

人工审核会重新检查文章是否把事实、推断和观点分开，确认标题没有夸大，也会核对配图是否与正文语境一致。只有完成这些检查，内容才适合作为本地制作稿交付到其他平台。

## 本示例的边界

这是项目内 Mock 图文任务，正文和配图用于体验预览、审批、复制与下载流程，不代表实时新闻，也不会自动发布到外部平台。`,
    platform: '微信公众号',
    status: 'review',
    updatedAt: articleTask.updatedAt,
    safety: [
      { name: '来源边界', status: '通过', reason: '正文明确标注为项目内 Mock 示例，不冒充实时新闻。' },
      { name: '表达风险', status: '通过', reason: '未发现夸大、诱导或未处理的高风险表达。' },
      { name: '配图一致性', status: '通过', reason: '配图为内容编辑与事实核验场景，与正文主题一致。' },
    ],
  }
  const illustration: Asset = {
    id: uid('asset'),
    name: 'AI 内容工厂 · 事实核验配图.png',
    type: '图片',
    url: '/mock-assets/mock-article-fact-check-v1.png',
    cover: '/mock-assets/mock-article-fact-check-v1.png',
    tags: ['Mock', '图文示例', '真实生成配图'],
    taskId: articleTask.id,
    model: 'Nano Banana Pro',
    provider: 'Mock',
    createdAt: articleTask.updatedAt,
    resolution: '1536x864',
    prompt: '编辑在现代内容工作室中进行事实核验的 editorial illustration',
  }
  demo.tasks.push(articleTask)
  demo.articles = [article]
  demo.assets = [illustration]
  return demo
}
