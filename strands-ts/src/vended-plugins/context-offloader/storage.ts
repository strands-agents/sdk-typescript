export interface Storage {
  store(key: string, content: Uint8Array, contentType?: string): string | Promise<string>
  retrieve(
    reference: string
  ): { content: Uint8Array; contentType: string } | Promise<{ content: Uint8Array; contentType: string }>
}

function sanitizeId(rawId: string): string {
  return rawId
    .replace(/\.\./g, '_')
    .replace(/[/\\]/g, '_')
    .replace(/[^\w\-.]/g, '_')
}

export class InMemoryStorage implements Storage {
  private _store = new Map<string, { content: Uint8Array; contentType: string }>()
  private _counter = 0

  store(key: string, content: Uint8Array, contentType: string = 'text/plain'): string {
    this._counter++
    const reference = `mem_${this._counter}_${key}`
    this._store.set(reference, { content, contentType })
    return reference
  }

  retrieve(reference: string): { content: Uint8Array; contentType: string } {
    const entry = this._store.get(reference)
    if (!entry) {
      throw new Error(`Reference not found: ${reference}`)
    }
    return entry
  }

  clear(): void {
    this._store.clear()
  }
}

export class FileStorage implements Storage {
  private static readonly METADATA_FILE = '.metadata.json'
  private readonly _artifactDir: string
  private _counter = 0
  private _contentTypes: Record<string, string> = {}
  private _metadataLoaded = false

  constructor(artifactDir: string = './artifacts') {
    this._artifactDir = artifactDir
  }

  private static _extensionFor(contentType: string): string {
    if (contentType === 'text/plain') return '.txt'
    return `.${contentType.split('/').pop()}`
  }

  private async _ensureDir(): Promise<typeof import('node:fs/promises')> {
    const fs = await import('node:fs/promises')
    await fs.mkdir(this._artifactDir, { recursive: true })
    if (!this._metadataLoaded) {
      this._contentTypes = await this._loadMetadata(fs)
      this._metadataLoaded = true
    }
    return fs
  }

  private async _loadMetadata(fs: typeof import('node:fs/promises')): Promise<Record<string, string>> {
    const path = await import('node:path')
    const metadataPath = path.join(this._artifactDir, FileStorage.METADATA_FILE)
    try {
      const raw = await fs.readFile(metadataPath, 'utf-8')
      return JSON.parse(raw) as Record<string, string>
    } catch {
      return {}
    }
  }

  private async _saveMetadata(fs: typeof import('node:fs/promises')): Promise<void> {
    const path = await import('node:path')
    const metadataPath = path.join(this._artifactDir, FileStorage.METADATA_FILE)
    await fs.writeFile(metadataPath, JSON.stringify(this._contentTypes), 'utf-8')
  }

  async store(key: string, content: Uint8Array, contentType: string = 'text/plain'): Promise<string> {
    const fs = await this._ensureDir()
    const path = await import('node:path')

    const sanitizedKey = sanitizeId(key)
    const timestampMs = Date.now()
    this._counter++
    const ext = FileStorage._extensionFor(contentType)
    const filename = `${timestampMs}_${this._counter}_${sanitizedKey}${ext}`

    this._contentTypes[filename] = contentType
    await this._saveMetadata(fs)

    const filePath = path.join(this._artifactDir, filename)
    await fs.writeFile(filePath, content)

    return filePath
  }

  async retrieve(reference: string): Promise<{ content: Uint8Array; contentType: string }> {
    const fs = await this._ensureDir()
    const path = await import('node:path')

    const filePath = path.resolve(this._artifactDir, reference)
    const resolvedDir = path.resolve(this._artifactDir)
    if (!filePath.startsWith(resolvedDir)) {
      throw new Error(`Reference not found: ${reference}`)
    }

    const filename = path.basename(filePath)

    try {
      const content = await fs.readFile(filePath)
      const contentType = this._contentTypes[filename] ?? 'application/octet-stream'
      return { content: new Uint8Array(content), contentType }
    } catch {
      throw new Error(`Reference not found: ${reference}`)
    }
  }
}

export class S3Storage implements Storage {
  private readonly _bucket: string
  private _prefix: string
  private _s3: import('@aws-sdk/client-s3').S3Client | undefined
  private readonly _s3Client: import('@aws-sdk/client-s3').S3Client | undefined
  private readonly _region: string
  private _counter = 0

  constructor(
    bucket: string,
    options?: { prefix?: string; region?: string; s3Client?: import('@aws-sdk/client-s3').S3Client }
  ) {
    this._bucket = bucket
    this._prefix = options?.prefix?.replace(/\/+$/, '') ?? ''
    if (this._prefix) this._prefix += '/'
    this._s3Client = options?.s3Client
    this._region = options?.region ?? 'us-east-1'
  }

  private async _getClient(): Promise<import('@aws-sdk/client-s3').S3Client> {
    if (this._s3) return this._s3
    if (this._s3Client) {
      this._s3 = this._s3Client
      return this._s3
    }
    const { S3Client } = await import('@aws-sdk/client-s3')
    this._s3 = new S3Client({ region: this._region })
    return this._s3
  }

  async store(key: string, content: Uint8Array, contentType: string = 'text/plain'): Promise<string> {
    const client = await this._getClient()
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')

    const sanitizedKey = sanitizeId(key)
    const timestampMs = Date.now()
    this._counter++
    const s3Key = `${this._prefix}${timestampMs}_${this._counter}_${sanitizedKey}`

    await client.send(
      new PutObjectCommand({
        Bucket: this._bucket,
        Key: s3Key,
        Body: content,
        ContentType: contentType,
      })
    )

    return `s3://${this._bucket}/${s3Key}`
  }

  async retrieve(reference: string): Promise<{ content: Uint8Array; contentType: string }> {
    const client = await this._getClient()
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')

    // Accept both s3:// URIs and raw keys
    let s3Key = reference
    const uriMatch = reference.match(/^s3:\/\/([^/]+)\/(.+)$/)
    if (uriMatch?.[1] && uriMatch[2]) {
      if (uriMatch[1] !== this._bucket) {
        throw new Error(`Reference not found: ${reference} (bucket mismatch)`)
      }
      s3Key = uriMatch[2]
    }

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: this._bucket,
          Key: s3Key,
        })
      )
      const body = await response.Body?.transformToByteArray()
      if (!body) throw new Error(`Reference not found: ${reference}`)
      const contentType = response.ContentType ?? 'application/octet-stream'
      return { content: new Uint8Array(body), contentType }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'NoSuchKey') {
        throw new Error(`Reference not found: ${reference}`)
      }
      throw error
    }
  }
}
