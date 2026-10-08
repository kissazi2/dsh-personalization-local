/**
 * dsh-personalization-local · Node half（host 侧）— dsh 0.2.0-rc.2 兼容
 *
 * 个性化设置：
 * 1. 全部个性化数据保存在本插件条目自己的 Config。字段全部标记 volatile()：
 *    settings 服务的 describe() 只收录含 volatile 字段的条目，update() 也只接受
 *    volatile 路径——不标记的话保存链路会被宿主直接过滤/拒绝（实测踩坑）。
 * 2. volatile 字段更新时条目不重启（applies: live），运行时值经 Volatile 引用
 *    （config.xxx.get()）读取，且条目 fiber 会收到 `loader/volatile-update` 事件；
 *    本插件监听该事件，即时重新注册 systemPrompt 个性化段。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'personalization'
export const inject = ['systemPrompt']

/** 运行时配置（即持久化存储），字段与设置页「个性化」表单一一对应。 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  /** 关于你 */
  nickname: z.string().default('').volatile(),
  occupation: z.string().default('').volatile(),
  about: z.string().default('').volatile(),
  /** Chat 回复偏好 */
  detailLevel: z.string().default('深入').volatile(),
  emoji: z.string().default('减弱').volatile(),
  tone: z.string().default('吐槽达人').volatile(),
  answerStructure: z.string().default('结论先行').volatile(),
})

/** volatile 字段在 config 里是带 .get() 的引用，读取时解包；兼容普通值。 */
function read(value) {
  return value && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

/** 组装个性化提示词文本；全部留空时返回空串（调用方据此跳过注册）。 */
function composeProfile(config) {
  const lines = []
  const aboutYou = []
  if (config.nickname) aboutYou.push(`称呼用户为「${config.nickname}」`)
  if (config.occupation) aboutYou.push(`用户的职业/角色：${config.occupation}`)
  if (config.about) aboutYou.push(`用户补充介绍：${config.about}`)
  if (aboutYou.length) lines.push('关于你：', ...aboutYou.map((s) => `- ${s}`))

  const prefs = []
  if (config.detailLevel) prefs.push(`详细程度：${config.detailLevel}`)
  if (config.emoji) prefs.push(`表情符号：${config.emoji}`)
  if (config.tone) prefs.push(`语气风格：${config.tone}`)
  if (config.answerStructure) prefs.push(`回答结构：${config.answerStructure}`)
  if (prefs.length) lines.push('Chat 回复偏好：', ...prefs.map((s) => `- ${s}`))

  if (!lines.length) return ''
  return [
    '以下为用户在设置中配置的个性化偏好，请在整个对话中持续遵循：',
    '',
    ...lines,
  ].join('\n')
}

export function apply(ctx, config) {
  let dispose = null

  const register = () => {
    dispose?.()
    dispose = null
    const current = {
      enabled: read(config.enabled),
      nickname: String(read(config.nickname) ?? '').trim(),
      occupation: String(read(config.occupation) ?? '').trim(),
      about: String(read(config.about) ?? '').trim(),
      detailLevel: String(read(config.detailLevel) ?? '').trim(),
      emoji: String(read(config.emoji) ?? '').trim(),
      tone: String(read(config.tone) ?? '').trim(),
      answerStructure: String(read(config.answerStructure) ?? '').trim(),
    }
    if (!current.enabled) return
    const text = composeProfile(current)
    if (!text) return
    const order = ctx.systemPrompt.getSectionOrder?.('DEPLOYMENT_PERSONA_PREFIX') ?? 10
    dispose = ctx.systemPrompt.section({
      name: 'personalization:profile',
      order,
      text,
    })
  }

  // 条目激活时首次注册；volatile 配置变更后（settings.update）即时重注册
  register()
  ctx.on('loader/volatile-update', () => register())
  ctx.effect(() => () => {
    dispose?.()
    dispose = null
  }, 'personalization: profile section')
}
