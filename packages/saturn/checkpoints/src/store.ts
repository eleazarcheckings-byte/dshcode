/**
 * The checkpoint blob store: content-addressed storage for the exact bytes a
 * capture records.
 *
 * The store lives under the harness home (`<DSH_HOME>/checkpoints`), never
 * inside the user's repository, so recording a checkpoint cannot dirty a
 * working tree, appear in a diff, or reach a commit. Addresses are sha-256 over
 * the bytes, which is what makes identical content stored exactly once: two
 * checkpoints that record the same file share one blob, and a rewrite that
 * reproduces known content adds nothing.
 *
 * @module @saturnai/dsh-checkpoints/store
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Permission bits for recorded blobs: owner-only, since workspace content can be private. */
const BLOB_MODE = 0o600

/** Directory name of the checkpoint store under the harness home. */
export const CHECKPOINT_STORE_DIR = 'checkpoints'

/** Lowercase hex sha-256 of one file's bytes: the blob's address. */
export function hashOfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The store-relative path of one blob. The first address byte fans blobs into
 * 256 directories, because a single directory holding every recorded file
 * degrades badly on Windows and on network filesystems.
 * @param hash - lowercase hex sha-256.
 * @returns the two-segment relative path, e.g. `ab/abcd…`.
 */
export function blobPath(hash: string): string {
  return `${hash.slice(0, 2)}/${hash}`
}

/** The content-addressed store one checkpoint catalog records into. */
export interface CheckpointStore {
  /** Absolute root directory of the store. */
  readonly root: string
  /**
   * Record one blob, once. A blob already addressed by `hash` is left alone —
   * the address IS the proof that the bytes are the same ones.
   * @param hash - lowercase hex sha-256 of `bytes`.
   * @param bytes - the exact content to record.
   */
  putBlob(hash: string, bytes: Uint8Array): Promise<void>
  /**
   * Read one recorded blob back.
   * @param hash - the address to read.
   * @returns the recorded bytes.
   * @throws when the store holds no blob at that address.
   */
  readBlob(hash: string): Promise<Buffer>
  /**
   * Whether the store holds one address.
   * @param hash - the address to test.
   * @returns true when the blob is present.
   */
  hasBlob(hash: string): Promise<boolean>
}

/**
 * Open the checkpoint store at a root directory, creating nothing until the
 * first blob is written.
 * @param rootDir - store root; defaults to `<DSH_HOME>/checkpoints`.
 * @returns the store handle.
 */
export function checkpointStore(rootDir: string = dshHomePath(CHECKPOINT_STORE_DIR)): CheckpointStore {
  const blobAt = (hash: string): string => join(rootDir, 'blobs', blobPath(hash))
  return {
    root: rootDir,
    async putBlob(hash, bytes) {
      if (await has(blobAt(hash))) return
      await writeFileAtomic(blobAt(hash), bytes, { mode: BLOB_MODE, dirMode: 0o700 })
    },
    async readBlob(hash) {
      const path = blobAt(hash)
      try {
        return await readFile(path)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`checkpoint blob ${hash} is missing from ${rootDir}`)
        }
        throw error
      }
    },
    async hasBlob(hash) {
      return await has(blobAt(hash))
    },
  }
}

/** Whether a regular file exists at one path. */
async function has(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
