// satori's font parser — only what lib/caption-overlay measures with.
declare module "@shuding/opentype.js" {
  export interface Font {
    getAdvanceWidth(text: string, fontSize: number): number
  }
  export function parse(buffer: ArrayBuffer): Font
}
