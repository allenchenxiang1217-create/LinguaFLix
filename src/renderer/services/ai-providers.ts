/**
 * AI 服务商预设注册表（对齐 LobeChat / Chatbox / Cherry Studio / cc-switch 的通用方案）。
 *
 * 每个服务商 = 一条记录 { id, name, type, color, cheap, baseUrl }。任何厂商只要
 * OpenAI 兼容就只换 baseUrl + Bearer Key，无需每家写 SDK；Claude 单独走
 * type:'anthropic'（/messages + x-api-key + anthropic-version）。
 *
 * 只存官方默认值，永不持久化；具体模型名由用户在设置页自填（deepseek 不一定是
 * v4-flash，mimo 不一定是 v2.5，不预设）。用户只持久化 Key / 自定义 Base URL /
 * 所选服务商 / 模型名，按 provider id 索引（见 settingsStore.aiOverrides）。
 */

export type AIProviderType = 'openai' | 'anthropic'

export interface AIProvider {
  id: string
  name: string
  type: AIProviderType
  /** 品牌色：设置页服务商卡片圆点 + 选中高亮 */
  color: string
  /** 便宜标（¥）——LobeChat/Chatbox 的做法，方便一眼挑便宜的国产模型 */
  cheap: boolean
  /** 官方接口 baseUrl（不带尾部斜杠）。custom 为空，由用户填 */
  baseUrl: string
}

/** 某个服务商的用户覆盖（只持久化用户配置，不动预设）。 */
export interface AIOverride {
  apiKey?: string
  baseUrl?: string
}

export const AI_PROVIDERS: AIProvider[] = [
  { id: 'openai',   name: 'OpenAI',   type: 'openai',    color: '#10a37f', cheap: false, baseUrl: 'https://api.openai.com/v1' },
  { id: 'claude',   name: 'Claude',   type: 'anthropic', color: '#d97757', cheap: false, baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'deepseek', name: 'DeepSeek', type: 'openai',    color: '#4d6bfe', cheap: true,  baseUrl: 'https://api.deepseek.com' },
  { id: 'mimo',     name: 'MiMo',     type: 'openai',    color: '#ff6900', cheap: true,  baseUrl: 'https://api.xiaomimimo.com/v1' },
  { id: 'kimi',     name: 'Kimi',     type: 'openai',    color: '#6c5ce7', cheap: true,  baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'glm',      name: 'GLM',      type: 'openai',    color: '#0baeff', cheap: true,  baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'qwen',     name: 'Qwen',     type: 'openai',    color: '#615ced', cheap: true,  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'doubao',   name: '豆包',     type: 'openai',    color: '#d54c4f', cheap: true,  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax',  name: 'MiniMax',  type: 'openai',    color: '#e8625d', cheap: true,  baseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'custom',   name: '自定义',   type: 'openai',    color: '#8e8e93', cheap: false, baseUrl: '' },
]

/** 取服务商预设；未知 id 回退 OpenAI。 */
export function getProvider(id: string): AIProvider {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}

/** 去掉尾部斜杠（用户可能填 / 结尾），保证拼 /chat/completions 不会双斜杠。 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}
