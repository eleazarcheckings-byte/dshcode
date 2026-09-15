/**
 * The remote-access journal: an append-only record of every state change, so
 * "when did this phone pair, and when was the listener last open" is a
 * question the machine can answer rather than a memory. It carries actions and
 * short non-secret details only — no token, no key, no certificate.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteJournalEntry } from './types.ts'

const JOURNAL_FILE = 'journal.jsonl'
const RETAINED = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Durable, append-only state-change log under the remote-access directory. */
export class RemoteJournal {
  private recent: RemoteJournalEntry[] = []
  private tail: Promise<void> = Promise.resolve()

  private constructor(private readonly directory: string, recent: RemoteJournalEntry[]) {
    this.recent = recent
  }

  /**
   * Open the journal and read back the tail that the Settings card shows.
   * @param directory - the remote-access state directory.
   * @returns the journal; an unreadable file yields an empty tail, never a failure.
   */
  static async open(directory: string): Promise<RemoteJournal> {
    await mkdir(directory, { recursive: true })
    let recent: RemoteJournalEntry[] = []
    try {
      recent = (await readFile(join(directory, JOURNAL_FILE), 'utf8'))
        .split('\n')
        .flatMap((line): RemoteJournalEntry[] => {
          if (line.trim() === '') return []
          try {
            const parsed: unknown = JSON.parse(line)
            if (!isRecord(parsed) || typeof parsed.at !== 'string' || typeof parsed.action !== 'string') return []
            return [{
              at: parsed.at,
              action: parsed.action,
              ...typeof parsed.detail === 'string' ? { detail: parsed.detail } : {},
            }]
          } catch {
            return []
          }
        })
        .slice(-RETAINED)
    } catch {
      recent = []
    }
    return new RemoteJournal(directory, recent)
  }

  /**
   * Record one state change.
   * @param action - the change, as a stable lowercase token.
   * @param detail - short non-secret context.
   * @param now - current epoch milliseconds.
   */
  record(action: string, detail: string | undefined, now: number): void {
    const entry: RemoteJournalEntry = {
      at: new Date(now).toISOString(),
      action,
      ...detail === undefined ? {} : { detail },
    }
    this.recent = [...this.recent, entry].slice(-RETAINED)
    const line = `${JSON.stringify(entry)}\n`
    this.tail = this.tail.then(
      () => appendFile(join(this.directory, JOURNAL_FILE), line),
      () => {},
    ).then(() => {}, () => {})
  }

  /** The retained tail, oldest first. */
  entries(): RemoteJournalEntry[] {
    return [...this.recent]
  }

  /** Await every pending append (disposal, and the suite). */
  async drain(): Promise<void> {
    await this.tail
  }
}
