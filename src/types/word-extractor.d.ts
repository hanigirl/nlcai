declare module "word-extractor" {
  class Document {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string
    getFooters(): string
    getAnnotations(): string
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<Document>
  }

  export default WordExtractor
}
