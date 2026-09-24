import type { Database, QualityResult, VideoTask } from '../types'

export class QualityGate {
  evaluate(
    db: Database,
    stageId: string,
    score: number,
    kind: VideoTask['kind'],
    provider = 'Mock',
  ): QualityResult {
    const config = db.qualityConfigs?.find((c) => c.stageId === stageId && c.enabled !== false)
    const threshold = config?.threshold ?? db.settings.threshold
    if (![threshold, score].every((v) => Number.isFinite(v) && v >= 0 && v <= 100))
      throw new Error('质量分数和门限必须在 0–100')
    const passed = score >= threshold
    const names =
      config?.criteria ??
      (kind === 'video'
        ? ['人物一致性', '画面质量', '动作自然度', '连续性', 'Prompt遵循']
        : ['事实', '风险', '结构', '原创声明'])
    return {
      score,
      threshold,
      passed,
      criteria: names.map((name) => ({
        name: `${provider} ${name}`,
        score,
        passed,
        reason:
          provider === 'Mock'
            ? 'Mock 模板评分，未检查真实媒体或核验事实，最终需人工核验'
            : '执行结果评分，最终需人工核验',
      })),
      suggestions: passed ? [] : [`${provider} 评分未达到门限，请修改内容后重试`],
    }
  }
}
export const qualityGate = new QualityGate()
