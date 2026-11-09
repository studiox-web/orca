import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { isValidArtifactUri } from '../../../src/shared/coordinated-automation-receipt-schemas'
import type { StoreRuntime } from './temporary-evidence-stores'

type ArtifactRecord = {
  uri: string
  recordedDigest: string
  writtenAt: number
}

type ArtifactIndex = {
  records: Record<string, ArtifactRecord>
}

export type ArtifactInspection = Readonly<{
  uri: string
  exists: boolean
  digest?: string
  recordedDigest?: string
  writtenAt?: number
  stale: boolean
  staleReasons: readonly ('digest_mismatch' | 'age_exceeded')[]
}>

async function readIndex(path: string): Promise<ArtifactIndex> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) {
      return { records: {} }
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function replaceIndex(path: string, index: ArtifactIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const nextPath = `${path}.next`
  await writeFile(nextPath, `${JSON.stringify(index, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(nextPath, path)
}

export class TemporaryArtifactStore {
  readonly #artifactRoot: string
  readonly #indexPath: string

  constructor(readonly runtime: StoreRuntime) {
    this.#artifactRoot = join(runtime.root, 'artifacts')
    this.#indexPath = join(runtime.root, 'stores', 'artifacts.json')
  }

  async write(uri: string, content: string | Uint8Array): Promise<string> {
    const path = this.#pathFor(uri)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, { mode: 0o600 })
    this.#durableBoundary(uri, 'content')
    const digest = await this.#digest(path)
    const index = await readIndex(this.#indexPath)
    index.records[uri] = { uri, recordedDigest: digest, writtenAt: this.runtime.clock.now() }
    await replaceIndex(this.#indexPath, index)
    this.#durableBoundary(uri, 'index')
    this.runtime.crashes.reach('artifact-store.before-acknowledgement', { artifactUri: uri })
    this.runtime.trace.record(
      this.runtime.clock.now(),
      'artifact-store.acknowledged',
      { artifactUri: uri },
      { digest }
    )
    return digest
  }

  async tamper(uri: string, content: string | Uint8Array): Promise<string> {
    const path = this.#pathFor(uri)
    await writeFile(path, content, { mode: 0o600 })
    const digest = await this.#digest(path)
    this.#durableBoundary(uri, 'tamper')
    this.runtime.crashes.reach('artifact-store.before-acknowledgement', { artifactUri: uri })
    this.runtime.trace.record(
      this.runtime.clock.now(),
      'artifact-store.tamper-acknowledged',
      { artifactUri: uri },
      { digest }
    )
    return digest
  }

  async markStale(uri: string, ageMs: number): Promise<void> {
    if (!Number.isSafeInteger(ageMs) || ageMs < 0) {
      throw new Error('Artifact age must be a non-negative safe integer')
    }
    const index = await readIndex(this.#indexPath)
    const record = index.records[uri]
    if (!record) {
      throw new Error(`Artifact ${uri} is not indexed`)
    }
    record.writtenAt = this.runtime.clock.now() - ageMs
    await replaceIndex(this.#indexPath, index)
    this.#durableBoundary(uri, 'staleness')
    this.runtime.crashes.reach('artifact-store.before-acknowledgement', { artifactUri: uri })
    this.runtime.trace.record(this.runtime.clock.now(), 'artifact-store.staleness-acknowledged', {
      artifactUri: uri
    })
  }

  async remove(uri: string): Promise<void> {
    const path = this.#pathFor(uri)
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })
    this.#durableBoundary(uri, 'content-removal')
    const index = await readIndex(this.#indexPath)
    delete index.records[uri]
    await replaceIndex(this.#indexPath, index)
    this.#durableBoundary(uri, 'index-removal')
    this.runtime.crashes.reach('artifact-store.before-acknowledgement', { artifactUri: uri })
    this.runtime.trace.record(this.runtime.clock.now(), 'artifact-store.removal-acknowledged', {
      artifactUri: uri
    })
  }

  async inspect(
    uri: string,
    options: Readonly<{ expectedDigest?: string; maxAgeMs?: number }> = {}
  ): Promise<ArtifactInspection> {
    const path = this.#pathFor(uri)
    const index = await readIndex(this.#indexPath)
    const record = index.records[uri]
    let digest: string
    try {
      digest = await this.#digest(path)
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error
      }
      return { uri, exists: false, stale: false, staleReasons: [] }
    }
    const staleReasons: ('digest_mismatch' | 'age_exceeded')[] = []
    const expectedDigest = options.expectedDigest ?? record?.recordedDigest
    if (expectedDigest && expectedDigest !== digest) {
      staleReasons.push('digest_mismatch')
    }
    if (
      options.maxAgeMs !== undefined &&
      record &&
      this.runtime.clock.now() - record.writtenAt > options.maxAgeMs
    ) {
      staleReasons.push('age_exceeded')
    }
    return {
      uri,
      exists: true,
      digest,
      recordedDigest: record?.recordedDigest,
      writtenAt: record?.writtenAt,
      stale: staleReasons.length > 0,
      staleReasons
    }
  }

  #durableBoundary(uri: string, writeKind: string): void {
    this.runtime.trace.record(
      this.runtime.clock.now(),
      'artifact-store.written',
      { artifactUri: uri },
      { writeKind }
    )
    this.runtime.crashes.reach('artifact-store.after-durable-write', { artifactUri: uri })
  }

  #pathFor(uri: string): string {
    if (!isValidArtifactUri(uri)) {
      throw new Error(`Unsafe artifact URI: ${uri}`)
    }
    const relativeUri = uri.startsWith('artifact://') ? uri.slice('artifact://'.length) : uri
    const path = resolve(this.#artifactRoot, relativeUri)
    const childPath = relative(this.#artifactRoot, path)
    if (childPath === '..' || childPath.startsWith(`..${sep}`) || resolve(path) === resolve('/')) {
      throw new Error(`Artifact URI escaped the temporary root: ${uri}`)
    }
    return path
  }

  async #digest(path: string): Promise<string> {
    const bytes = await readFile(path)
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  }
}
