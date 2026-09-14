/**
 * The content-addressed store, pinned: the address IS the identity of the
 * bytes, so recording the same content twice adds nothing, and a blob that is
 * missing or altered is a loud failure rather than a silent restore of
 * something else.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blobPath, checkpointStore, hashOfBytes } from '../src/store.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('hashOfBytes', () => {
  it('is the lowercase hex sha-256 of the bytes', () => {
    // Known vector: sha256("abc").
    expect(hashOfBytes(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('gives identical content one address', () => {
    expect(hashOfBytes(new TextEncoder().encode('same'))).toBe(hashOfBytes(new TextEncoder().encode('same')))
  })

  it('gives different content different addresses', () => {
    expect(hashOfBytes(new TextEncoder().encode('a'))).not.toBe(hashOfBytes(new TextEncoder().encode('b')))
  })
})

describe('blobPath', () => {
  it('fans blobs into a two-character directory', () => {
    expect(blobPath('abcdef')).toBe('ab/abcdef')
  })
})

describe('checkpointStore', () => {
  it('reports no blob before anything is recorded, and creates nothing', async () => {
    const store = checkpointStore(join(root, 'checkpoints'))
    expect(await store.hasBlob('0'.repeat(64))).toBe(false)
    await expect(stat(join(root, 'checkpoints'))).rejects.toThrow()
  })

  it('records bytes once and reads the identical bytes back', async () => {
    const store = checkpointStore(join(root, 'checkpoints'))
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const hash = hashOfBytes(bytes)
    await store.putBlob(hash, bytes)
    expect(await store.hasBlob(hash)).toBe(true)
    expect([...await store.readBlob(hash)]).toEqual([...bytes])
    expect(await readFile(join(root, 'checkpoints', 'blobs', blobPath(hash)))).toEqual(Buffer.from(bytes))
  })

  it('leaves an already-recorded address alone, so identical content is stored once', async () => {
    const store = checkpointStore(join(root, 'checkpoints'))
    const bytes = new TextEncoder().encode('content')
    const hash = hashOfBytes(bytes)
    await store.putBlob(hash, bytes)
    const before = (await stat(join(root, 'checkpoints', 'blobs', blobPath(hash)))).mtimeMs
    await store.putBlob(hash, bytes)
    const after = (await stat(join(root, 'checkpoints', 'blobs', blobPath(hash)))).mtimeMs
    expect(after).toBe(before)
  })

  it('fails loudly when the recorded blob is gone, naming the address', async () => {
    const store = checkpointStore(join(root, 'checkpoints'))
    await expect(store.readBlob('f'.repeat(64))).rejects.toThrow(/checkpoint blob f{64} is missing/u)
  })

  it('reports absence rather than a directory as a blob', async () => {
    const store = checkpointStore(join(root, 'checkpoints'))
    // A directory sitting at the address is not a recorded blob.
    await writeFile(join(root, 'placeholder'), '')
    expect(await store.hasBlob('e'.repeat(64))).toBe(false)
  })
})
