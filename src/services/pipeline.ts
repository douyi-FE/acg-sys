import type { Asset, Database, TaskAction, VideoTask } from '../types'
import { createStages, now, uid } from './seed'
import { assertEnabled } from './validation'
import { qualityGate } from '../orchestrator/quality'

export function log(task: VideoTask, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  task.logs.push({ id: uid('log'), time: now(), level, message })
}
function transition(task: VideoTask, status: VideoTask['status'], time: number): void {
  task.status = status
  task.updatedAt = new Date(time).toISOString()
}
/** 重启调度而非删除创作内容；重试计数由调用方控制。 */
export function restartTask(task: VideoTask, time: number): void {
  task.previousScript = task.script
  task.stages = createStages(task.kind)
  task.stageIndex = 0
  task.progress = 0
  task.quality = null
  task.approved = false
  delete task.error
  delete task.errorType
  transition(task, 'QUEUED', time)
}
function retry(task: VideoTask, time: number): void {
  if (task.errorType === 'quality') {
    const before = task.repairPrompt ?? JSON.stringify(task.request, null, 2)
    const stageKey = task.stages[task.stageIndex]?.key ?? qualityKey(task)
    const reason = task.quality?.suggestions.join('；') || task.error || '改进质量'
    const instruction =
      task.kind === 'video'
        ? '统一角色服装与灯光，补足首尾帧位置和动作衔接，明确镜头运动与主体约束。'
        : '区分事实与推断，保留待核实标记，补充论证结构并避免无来源结论。'
    const after = JSON.stringify(
      { ...task.request, mockRepair: { attempt: task.retries + 2, reason, instruction } },
      null,
      2,
    )
    ;(task.qualityRepairs ??= []).push({
      attempt: task.retries + 2,
      stageKey,
      time: new Date(time).toISOString(),
      before,
      after,
      reason,
    })
    task.repairPrompt = after
    log(task, `Mock Quality repair：已修改 Prompt，下一 attempt=${task.retries + 2}；${instruction}`, 'warn')
  }
  task.retries++
  restartTask(task, time)
  log(task, `第 ${task.retries} 次重试已排队`)
}
function fail(
  task: VideoTask,
  type: NonNullable<VideoTask['errorType']>,
  message: string,
  time: number,
): void {
  task.errorType = type
  task.error = message
  const stage = task.stages[task.stageIndex]
  if (stage) {
    stage.status = 'failed'
    stage.error = message
  }
  transition(task, 'FAILED', time)
  log(task, message, 'error')
}
function render(task: VideoTask, key: string): void {
  // 编辑标记持久化在日志中，也保留用户有意清空的内容；重试不删除日志。
  if (task.logs.some((entry) => entry.message === `MANUAL_CONTENT:${key}`)) return
  if (
    (key === 'SCRIPT' && task.script) ||
    (key === 'CHARACTER' && task.characters.length > 0) ||
    (key === 'STORYBOARD' && task.shots.length > 0)
  )
    return
  const r = task.request
  if (key === 'SCRIPT')
    task.script = `# ${task.title}\n\n【Mock 创作文本】\n主题：${r.theme}\n风格：${r.style}\n\n开场：${r.theme}。\n发展：人物面对选择，展开对话。\n结尾：以行动回应冲突，留下开放式思考。`
  if (key === 'CHARACTER')
    task.characters = [
      {
        id: `${task.id}-character`,
        name: r.characters || '叙述者',
        age: 30,
        gender: '未设定',
        identity: '虚构角色',
        appearance: '由用户补充',
        outfit: r.style,
        expression: '自然',
        pose: '站立',
      },
    ]
  if (key === 'STORYBOARD')
    task.shots = [0, 1, 2].map((i) => ({
      id: `${task.id}-shot-${i}`,
      start: (i * r.duration) / 3,
      end: ((i + 1) * r.duration) / 3,
      description: `${['开场', '发展', '结尾'][i]}：${r.theme}`,
      character: r.characters || '叙述者',
      camera: '固定中景',
      action: '自然对话',
      emotion: '克制',
      sound: '环境音（未生成）',
      firstPrompt: `${r.theme}，${r.style}，开场帧`,
      lastPrompt: `${r.theme}，${r.style}，结束帧`,
      bridge: '保持角色位置连续',
      continuity: '统一服装与灯光',
    }))
}

const TIMEOUT_WAIT = 'TIMEOUT_WAIT_USED'
export const qualityKey = (task: VideoTask): string => (task.kind === 'article' ? 'ARTICLE_REVIEW' : 'QA')

export const REVIEW_UNAVAILABLE = '真实模式人工审核不可用：后端尚未提供任务审核接口；不会模拟通过或驳回。'

/** Shared UI / transaction guard. Demo reviews saved production material, not fake media. */
export function reviewActionReason(
  db: Database,
  task: VideoTask,
  action: 'approve' | 'reject',
  context: { permitted: boolean; available: boolean; busy?: boolean; dirty?: boolean } = {
    permitted: true, available: true,
  },
): string | undefined {
  if (!context.permitted) return '当前账号缺少 tasks.update 权限，不能人工审核。'
  if (!context.available) return REVIEW_UNAVAILABLE
  if (context.busy) return '操作或数据加载中，请等待完成后再审核。'
  if (context.dirty) return '有未保存修改，请先保存或放弃修改后再审核。'
  if (task.status !== 'REVIEWING')
    return `当前状态为 ${task.status}；仅 REVIEWING（待审核）允许人工审核。`
  if (task.approved) return '该任务已通过审核，不能重复操作。'
  const finalKey = task.kind === 'article' ? 'FINAL_REVIEW' : 'PUBLISH'
  if (task.stageIndex !== task.stages.length - 1 || task.stages[task.stageIndex]?.key !== finalKey)
    return '任务尚未到达最终人工审核阶段。'
  // Reject remains available when quality/safety/content needs rework.
  if (action === 'reject') return undefined
  const article = db.articles.find((item) => item.taskId === task.id)
  if (task.kind === 'article' ? !article?.body.trim() : !task.script.trim())
    return '审核内容为空：请先生成并保存文章正文或脚本。'
  if (task.kind === 'video' && (!task.characters.length || !task.shots.length))
    return '审核材料不完整：缺少已保存角色或分镜。'
  if (!task.quality?.passed) return '质量门限未通过或评分缺失，请重新质检；不能人工跳过。'
  const quality = qualityGate.evaluate(db, qualityKey(task), task.quality.score, task.kind)
  if (!quality.passed)
    return `质量门限未通过：${quality.score} 分，当前阶段门限 ${quality.threshold} 分。`
  if (task.kind === 'article' && (!article?.safety.length || article.safety.some((s) => s.status !== '通过')))
    return '文章安全检查仍有待核实或风险项，或缺少核验记录；请打开文章与事实核验。'
  return undefined
}

/** 内容改动必须重新评估，但不会回到视频固定索引。 */
export function invalidateReview(task: VideoTask, time: number): void {
  const index = task.stages.findIndex((s) => s.key === qualityKey(task))
  if (index < 0) throw new Error('缺少质量阶段')
  task.quality = null
  task.approved = false
  delete task.error
  delete task.errorType
  task.stageIndex = index
  task.progress = Math.floor((index / task.stages.length) * 100)
  task.stages.splice(index, task.stages.length - index, ...createStages(task.kind).slice(index))
  transition(task, 'WAITING', time)
}

export function mockStageOutput(db: Database, task: VideoTask, key: string): string {
  if (task.kind === 'video') render(task, key)
  if (task.kind === 'article') {
    const article = db.articles.find((a) => a.taskId === task.id)
    if (!article) throw new Error('文章任务缺少文章')
    const topic = db.topics.find((t) => t.id === article.topicId)
    switch (key) {
      case 'HOT_TOPIC':
        return JSON.stringify(topic, null, 2)
      case 'TOPIC':
        return `Mock 选题：${article.title}\n${topic?.risk ?? '事实待核实'}`
      case 'OUTLINE':
        return article.outline
      case 'GENERATE':
        task.script = article.body
        return article.body
      case 'FACT':
        return `Mock 事实检查，未联网验证：\n${JSON.stringify(article.safety, null, 2)}`
      case 'SAFETY':
        return `Mock 风险检查，不能代替人工：\n${JSON.stringify(article.safety, null, 2)}`
      case 'TITLE':
        return article.title
      case 'ILLUSTRATION':
        return `Mock 配图文本方案：${article.title}；风格：${task.request.style}。未生成图片。`
      default:
        return 'Mock 内容评估'
    }
  }
  switch (key) {
    case 'SCRIPT':
      return task.script
    case 'CHARACTER':
      return JSON.stringify(task.characters, null, 2)
    case 'STORYBOARD':
      return JSON.stringify(task.shots, null, 2)
    case 'PROMPT':
      return JSON.stringify(
        task.shots.map((s) => ({ first: s.firstPrompt, last: s.lastPrompt, bridge: s.bridge })),
        null,
        2,
      )
    case 'SUBTITLE':
      return subtitles(task)
    default:
      return `Mock：仅完成模拟调度，未生成真实媒体${task.repairPrompt ? `\n已应用修复 Prompt：${task.repairPrompt}` : ''}`
  }
}

function moveNext(task: VideoTask, time: number, duration: number): void {
  task.stageIndex++
  task.progress = Math.floor((task.stageIndex / task.stages.length) * 100)
  task.estimated = (Math.max(0, task.stages.length - 1 - task.stageIndex) * duration) / 1000
  const next = task.stages[task.stageIndex]
  if (!next) throw new Error('阶段越界')
  if (task.stageIndex === task.stages.length - 1) {
    transition(task, 'REVIEWING', time)
    log(task, '达到质量门限，等待最终人工审核；尚未发布')
  } else {
    next.status = 'running'
    task.updatedAt = new Date(time).toISOString()
  }
}

/** 每次 tick 最多推进一个阶段，刷新后不跨过审核、不重复补跑离线时间。 */
export function advanceTask(db: Database, task: VideoTask, time: number, execute?: () => string): boolean {
  if (task.status === 'QUEUED') {
    try {
      assertEnabled(db, task.modelId, task.workflowId)
    } catch (error) {
      fail(task, 'system', error instanceof Error ? error.message : '模型或工作流不可用', time)
      return true
    }
    transition(task, 'RUNNING', time)
    const stage = task.stages[task.stageIndex]
    if (stage) stage.status = 'running'
    log(task, 'Mock Pipeline 开始运行；不调用真实媒体模型')
    return true
  }
  if (task.status !== 'RUNNING') return false
  const duration = db.settings.stageDuration
  const spent = time - Date.parse(task.updatedAt)
  const timeoutScenario =
    task.request.scenario === 'timeout' &&
    task.stageIndex === 1 &&
    !task.logs.some((l) => l.message === TIMEOUT_WAIT)
  if (spent < duration * (timeoutScenario ? 3 : 1)) return false
  task.elapsed += Math.min(spent, duration * 3) / 1000
  if (timeoutScenario) {
    fail(task, 'timeout', '模拟 Provider 超时（3 倍阶段时长）', time)
    return true
  }
  if (task.request.scenario === 'system' && task.stageIndex === 1) {
    fail(task, 'system', '模拟 Provider 系统错误；请修正配置后人工重试', time)
    return true
  }
  const stage = task.stages[task.stageIndex]
  if (!stage) throw new Error('阶段不存在')
  if (!execute && db.models.find((m) => m.id === task.modelId)?.provider !== 'Mock')
    throw new Error('真实 Provider 必须通过 Orchestrator 与 Engine 执行')
  stage.duration = duration / 1000
  stage.model = task.modelId
  stage.workflow = task.workflowId
  stage.input =
    task.stageIndex > 0
      ? (task.stages[task.stageIndex - 1]?.output ?? '')
      : JSON.stringify(task.request, null, 2)
  stage.prompt = task.repairPrompt ?? JSON.stringify(task.request, null, 2)
  stage.output = execute ? execute() : mockStageOutput(db, task, stage.key)
  stage.status = 'success'
  if (
    stage.key === qualityKey(task) ||
    db.qualityConfigs?.some((c) => c.stageId === stage.key && c.enabled !== false)
  ) {
    const score =
      task.request.scenario === 'quality' ? Math.min(95, 65 + (task.qualityRepairs?.length ?? 0) * 10) : 96
    const result = qualityGate.evaluate(db, stage.key, score, task.kind)
    if (stage.key === qualityKey(task)) task.quality = result
    const { threshold, passed } = result
    stage.score = score
    stage.output = JSON.stringify(result, null, 2)
    if (!passed) {
      fail(task, 'quality', `质量 ${score} 低于门限 ${threshold}`, time)
      // maxIterations 包含首次执行，自动重试同时受两个上限约束。
      if (
        db.settings.autoRetry &&
        task.retries < db.settings.maxRetries &&
        task.retries + 1 < db.settings.maxIterations
      )
        retry(task, time)
      else {
        const guidance =
          '自动修复已关闭或达到重试/迭代上限，请人工修改 Prompt/内容、核查质量配置后再重试；禁止跳过质量门限。'
        task.error = `${task.error}；${guidance}`
        stage.error = task.error
        result.suggestions.push(guidance)
        stage.output = JSON.stringify(result, null, 2)
        log(task, guidance, 'warn')
      }
      return true
    }
  }
  moveNext(task, time, duration)
  return true
}

function assetsFor(db: Database, task: VideoTask): Asset[] {
  const artifact = (suffix: string, type: Asset['type'], content: string, mime: string): Asset => ({
    id: `${task.id}-${suffix}`,
    name: `${task.title}-${suffix}`,
    type,
    content,
    url: `data:${mime};charset=utf-8,${encodeURIComponent(content)}`,
    cover: '',
    tags: ['Mock', '本地生成', '非真实视频'],
    taskId: task.id,
    model: task.modelId,
    createdAt: now(),
  })
  if (task.kind === 'article') {
    const article = db.articles.find((a) => a.taskId === task.id)
    if (!article) throw new Error('文章任务缺少文章')
    article.status = 'approved'
    article.updatedAt = now()
    return [artifact('article.md', '文章', article.body, 'text/markdown')]
  }
  return [
    artifact('script.txt', '剧本', task.script, 'text/plain'),
    artifact('characters.json', '角色', JSON.stringify(task.characters, null, 2), 'application/json'),
    artifact(
      'storyboard.json',
      '分镜',
      JSON.stringify(
        { taskId: task.id, shots: task.shots, media: { simulated: true, videoGenerated: false } },
        null,
        2,
      ),
      'application/json',
    ),
    ...(!task.stages.find((s) => s.key === 'SUBTITLE')?.output.startsWith('SKIPPED')
      ? [artifact('subtitles.srt', '剧本', subtitles(task), 'text/plain')]
      : []),
  ]
}
function subtitles(task: VideoTask): string {
  return task.shots
    .map((shot, i) => `${i + 1}\n${srtTime(shot.start)} --> ${srtTime(shot.end)}\n${shot.description}\n`)
    .join('\n')
}
function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}
/** UI 可直接复用；approve 仍需通过当前门限与文章安全项校验。 */
export function allowedActions(task: VideoTask): TaskAction[] {
  const allowed: Record<TaskAction, VideoTask['status'][]> = {
    pause: ['QUEUED', 'RUNNING'],
    wait: ['FAILED'],
    resume: ['WAITING'],
    cancel: ['QUEUED', 'RUNNING', 'WAITING', 'REVIEWING', 'FAILED'],
    retry: ['FAILED'],
    approve: ['REVIEWING'],
    reject: ['REVIEWING'],
    skip: ['RUNNING'],
  }
  return (Object.keys(allowed) as TaskAction[]).filter((action) => {
    if (!allowed[action].includes(task.status)) return false
    if (action === 'wait')
      return task.errorType === 'timeout' && !task.logs.some((l) => l.message === TIMEOUT_WAIT)
    if (action === 'skip')
      return task.kind === 'video' && ['AUDIO', 'SUBTITLE'].includes(task.stages[task.stageIndex]?.key ?? '')
    return true
  })
}
export function applyAction(db: Database, task: VideoTask, action: TaskAction, time: number): void {
  if (!allowedActions(task).includes(action)) throw new Error(`非法任务操作：${task.status} → ${action}`)
  if (action === 'approve' || action === 'reject') {
    const reason = reviewActionReason(db, task, action)
    if (reason) throw new Error(reason)
  }
  if (['retry', 'resume', 'wait'].includes(action)) assertEnabled(db, task.modelId, task.workflowId)
  if (action === 'retry') retry(task, time)
  else if (action === 'pause') transition(task, 'WAITING', time)
  else if (action === 'wait') {
    log(task, TIMEOUT_WAIT, 'warn')
    const stage = task.stages[task.stageIndex]
    if (stage) {
      stage.status = 'pending'
      delete stage.error
    }
    delete task.error
    delete task.errorType
    transition(task, 'QUEUED', time)
  } else if (action === 'skip') {
    const stage = task.stages[task.stageIndex]
    if (!stage) throw new Error('阶段不存在')
    stage.status = 'success'
    stage.output = 'SKIPPED：用户跳过可选阶段，未生成此项资产'
    stage.prompt = JSON.stringify(task.request, null, 2)
    moveNext(task, time, db.settings.stageDuration)
  } else if (action === 'resume') transition(task, 'QUEUED', time)
  else if (action === 'cancel') {
    task.approved = false
    transition(task, 'CANCELLED', time)
  } else if (action === 'reject') {
    task.approved = false
    fail(task, 'quality', '人工审核拒绝，须人工重试；已保存内容与运行记录保留', time)
  }
  else if (action === 'approve') {
    for (const asset of assetsFor(db, task))
      if (!db.assets.some((a) => a.id === asset.id)) db.assets.push(asset)
    task.approved = true
    task.progress = 100
    task.estimated = 0
    const stage = task.stages[task.stages.length - 1]
    if (stage) {
      stage.status = 'success'
      stage.output = '人工审核通过，已生成本地文本/JSON 资产；未向外部平台发布'
    }
    transition(task, 'SUCCESS', time)
  }
  log(task, `人工操作：${action}`)
}
