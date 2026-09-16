/**
 * The notification bus behind `GET /saturn/remote/events`. A phone that was
 * asleep when an approval was asked still needs to see it, so frames are kept
 * in a small ring and replayed from the device's `Last-Event-ID` on reconnect.
 * Nothing here decides anything: the bus observes and relays.
 */

import type { RemoteEvent, RemoteEventType } from './types.ts'

const RING_SIZE = 64

/** One attached stream. */
export interface EventSink {
  /** Deliver one frame, already serialized. */
  write: (frame: string) => void
}

/** What a publisher supplies; the bus stamps the id and the time. */
export interface RemoteEventInput {
  type: RemoteEventType
  title: string
  body: string
  sessionId?: string
}

/** What the ring can still tell a device that asks for everything after a cursor. */
export interface EventReplay {
  /** The frames newer than the cursor, oldest first, at most `limit` of them. */
  events: RemoteEvent[]
  /** The newest id the ring holds, or the cursor itself when nothing is newer. */
  newest: string
  /** Whether more frames than `limit` were available. */
  truncated: boolean
  /** Whether frames the cursor asked for had already been evicted. */
  gap: boolean
}

/** Serialize one frame in the Server-Sent Events wire format. */
export function serializeEvent(event: RemoteEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/** Fan one published frame out to every attached device stream. */
export class EventBus {
  private readonly sinks = new Set<EventSink>()
  private readonly ring: RemoteEvent[] = []
  private sequence = 0

  /**
   * Publish one frame to every attached stream and to the replay ring.
   * @param input - the frame's type and copy.
   * @param now - current epoch milliseconds.
   * @returns the stamped frame.
   */
  publish(input: RemoteEventInput, now: number): RemoteEvent {
    this.sequence += 1
    const event: RemoteEvent = {
      type: input.type,
      title: input.title,
      body: input.body,
      ...input.sessionId === undefined ? {} : { sessionId: input.sessionId },
      id: String(this.sequence),
      at: new Date(now).toISOString(),
    }
    this.ring.push(event)
    if (this.ring.length > RING_SIZE) this.ring.shift()
    const frame = serializeEvent(event)
    for (const sink of [...this.sinks]) {
      try {
        sink.write(frame)
      } catch {
        // A dead socket is removed by its own close handler; a throw here must
        // not stop the remaining devices from being told.
        this.sinks.delete(sink)
      }
    }
    return event
  }

  /**
   * Attach one stream and replay anything it missed.
   * @param sink - the stream to write frames to.
   * @param lastEventId - the device's last seen frame id, when it sent one.
   * @returns the detach function.
   */
  attach(sink: EventSink, lastEventId?: string): () => void {
    const after = Number(lastEventId)
    if (Number.isSafeInteger(after) && after > 0) {
      for (const event of this.ring.filter(entry => Number(entry.id) > after)) sink.write(serializeEvent(event))
    }
    this.sinks.add(sink)
    return () => { this.sinks.delete(sink) }
  }

  /**
   * Answer a cursor out of the ring, for a device that could not hold a stream
   * open. The same frames `attach` would have replayed, read rather than
   * pushed, and with the two facts a cursor cannot infer on its own: that the
   * window was too small, and that the backlog it wanted had already gone.
   * @param after - the last frame id the device saw; zero asks from the start.
   * @param limit - the most frames to return.
   * @returns the window, plus how far ahead the host is.
   */
  replay(after: number, limit: number): EventReplay {
    const pending = this.ring.filter(entry => Number(entry.id) > after)
    const oldest = Number(this.ring.at(0)?.id ?? 0)
    const newest = Number(this.ring.at(-1)?.id ?? 0)
    return {
      events: pending.slice(0, limit),
      newest: String(newest > after ? newest : after),
      truncated: pending.length > limit,
      // Contiguity, not emptiness: a gap exists only when the frame the device
      // asked to continue from is older than the oldest one still held.
      gap: this.ring.length > 0 && oldest > after + 1,
    }
  }

  /** How many device streams are attached. */
  get attached(): number {
    return this.sinks.size
  }

  /** Detach every stream (remote access going off). */
  clear(): void {
    this.sinks.clear()
  }
}
