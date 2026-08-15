/**
 * Ambient types for `esearch-ocr`.
 *
 * Its package.json points `"types"` at `./src/main.ts` but the `exports` map has
 * no `types` condition, so `moduleResolution: bundler` can't resolve them. Declare
 * the small surface we actually use (init + resultType) locally instead.
 */
declare module 'esearch-ocr' {
  type Point = [number, number]
  type BoxType = [Point, Point, Point, Point]
  type Color = [number, number, number]

  export type resultType = Array<{
    text: string
    mean: number
    /** ↖ ↗ ↘ ↙ */
    box: BoxType
    style: { bg: Color; text: Color }
  }>

  export type loadImgType = string | HTMLImageElement | HTMLCanvasElement | ImageData

  export interface OrtOption {
    ort: unknown
    ortOption?: unknown
  }

  export interface InitOcrBase {
    det: {
      input: string | ArrayBufferLike | Uint8Array
      ratio?: number
    }
    rec: {
      input: string | ArrayBufferLike | Uint8Array
      decodeDic: string
      optimize?: { space?: boolean }
    }
  }

  export function init(
    op: InitOcrBase & OrtOption,
  ): Promise<{
    ocr: (srcimg: loadImgType) => Promise<{ src: resultType }>
    det: unknown
    rec: unknown
    recRaw: unknown
  }>
}
