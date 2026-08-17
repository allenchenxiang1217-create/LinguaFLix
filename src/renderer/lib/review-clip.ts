import type { ReviewClipSegment, VideoMeta } from '@shared/types'

export function mapSourceTimeToClip(video: VideoMeta | null | undefined, sourceTime: number): number | null {
  const segments = video?.reviewSegments
  if (!video?.isReviewClip || !segments?.length || !Number.isFinite(sourceTime)) return null
  const segment = segments.find((s) => sourceTime >= s.sourceStart - 0.05 && sourceTime <= s.sourceEnd + 0.05)
  if (!segment) return null
  return segment.clipStart + Math.max(0, Math.min(segment.sourceEnd - segment.sourceStart, sourceTime - segment.sourceStart))
}

export function mapClipTimeToSource(video: VideoMeta | null | undefined, clipTime: number): number | null {
  const segments = video?.reviewSegments
  if (!video?.isReviewClip || !segments?.length || !Number.isFinite(clipTime)) return null
  const segment = segments.find((s) => clipTime >= s.clipStart - 0.05 && clipTime <= s.clipEnd + 0.05)
  if (!segment) return null
  return segment.sourceStart + Math.max(0, Math.min(segment.clipEnd - segment.clipStart, clipTime - segment.clipStart))
}
