import type { Article, Asset, HotTopic, VideoRequest } from '../types'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type Capability = 'LLM' | 'Vision' | 'Image' | 'Video' | 'Audio'
export interface ProviderContext {
  signal?: AbortSignal
  requestId?: string
}
export interface ProviderInfo {
  id: string
  name: string
  simulated: boolean
}
export interface ContentProvider extends ProviderInfo {
  createArticle(topic: HotTopic, context?: ProviderContext): Promise<Article>
  saveArticle(article: Article, context?: ProviderContext): Promise<void>
  listAssets(context?: ProviderContext): Promise<Asset[]>
}
export interface PublishingRequest {
  platform: string
  title: string
  text: string
  assetUrls: string[]
  approved: boolean
}
export interface PublishingResult {
  id: string
  status: 'draft' | 'published'
  url?: string
  simulated: boolean
}
export interface PublishingProvider extends ProviderInfo {
  publish(request: PublishingRequest, context?: ProviderContext): Promise<PublishingResult>
}
export interface HotTopicProvider extends ProviderInfo {
  fetchTopics(query: string, context?: ProviderContext): Promise<HotTopic[]>
  analyze(topic: HotTopic, context?: ProviderContext): Promise<HotTopic>
}
export interface AIProvider<Input, Output, Kind extends Capability = Capability> extends ProviderInfo {
  capability: Kind
  generate(input: Input, context?: ProviderContext): Promise<Output>
}
export interface TextRequest {
  prompt: string
  system?: string
  temperature?: number
}
export interface TextResult {
  text: string
  model: string
  simulated: boolean
}
export interface VisionRequest {
  prompt: string
  imageUrls: string[]
}
export interface MediaRequest {
  prompt: string
  seed?: number
  width?: number
  height?: number
}
export interface MediaResult {
  files: { url: string; mimeType: string }[]
  model: string
  simulated: boolean
}
export interface VideoGenerationRequest extends MediaRequest {
  duration: number
  firstFrame?: string
  lastFrame?: string
  creativeBrief?: VideoRequest
}
export interface AudioRequest {
  text: string
  voice?: string
  language?: string
}
export type LLMProvider = AIProvider<TextRequest, TextResult, 'LLM'>
export type VisionProvider = AIProvider<VisionRequest, TextResult, 'Vision'>
export type ImageProvider = AIProvider<MediaRequest, MediaResult, 'Image'>
export type VideoProvider = AIProvider<VideoGenerationRequest, MediaResult, 'Video'>
export type AudioProvider = AIProvider<AudioRequest, MediaResult, 'Audio'>
