# Agent Note: A replay window over the remote notification ring

Status: implemented

English | [中文](2026-09-15-remote-access-replay.zh.md)

## Problem

Remote access notifies a paired device over one Server-Sent Events stream. A stream is the right shape for a device that is awake and holding a socket, and the wrong shape for the device this feature exists for. A phone suspends the app; iOS and Android both reclaim a background socket on their own schedule; a WebView reloads. The frames published while the socket was gone are exactly the ones that mattered — the approval that is still waiting, the verdict that landed. `Last-Event-ID` recovers them, but only for a client that can reconnect a stream at all, and it arrives as an unbounded push rather than an answer a background task can ask for, read, and finish.

## Decision

Add one read-only route beside the stream: `GET /saturn/remote/events/replay?after=<id>&limit=<1..200>`, answering `{ events, newest, truncated }` with `"gap": true` added when the ring had already evicted what the cursor asked for.

It reuses rather than parallels. The frames come out of the same bounded ring `Last-Event-ID` already replays from, serialized as the same objects the stream carries, behind the same device-token door (bearer header or device session cookie) and the same browser fences. Nothing new is stored and no second notification path exists — one publisher, one ring, two ways to read it.

Three properties are the whole point of the shape. It **ends**: `Content-Length` is set, there is no heartbeat, and a background task can await it. It is **strict**: `after` must be a whole number from zero up and `limit` must fall in 1–200, or the answer is 400 — a device's cursor is either a number the host wrote or it is a mistake, and clamping a mistake makes it invisible. It is **honest about loss**: `truncated` says the window was smaller than the backlog, and `gap` says the backlog itself is gone. Without `gap` a device that slept through 100 frames would receive 64 and have no way to know it had lost 36.

## Alternatives considered

**Leave `Last-Event-ID` to do it.** It requires a stream, which is the thing the phone could not keep. It also cannot say "you missed frames I no longer have", because a push has no place to put that.

**Persist the events and give replay a real history.** A durable log is a file, a rotation policy, a schema, and a new thing that can hold a notification body on disk for a device that has been revoked. The ring is in memory, dies with the process, and is sized for the job replay actually does: catch up a phone that was asleep, not audit the week. Recorded as a known limitation instead.

**Clamp a bad `limit` to the range instead of refusing it.** A device asking for `limit=0` believes something that is not true; answering it with 100 frames hides the bug on both sides forever.

**A cursor that is a timestamp.** Ids are already monotonic, already on the wire, and already what the stream tells the device to remember. Two cursor vocabularies for one ring is how they drift.

## Consequences

`EventBus` grows one pure reader, `replay(after, limit)`, with `attach` untouched; the route is one branch in the proxy's already-authenticated remote block, placed before the exact `/events` match so the stream keeps its path. `gap` is only present when true — a device that never sees the key was never missing anything.

The composition suite now proves the route where it is actually reachable: over the pinned TLS socket, after a real `approval/request` waterfall, that `after=0` returns the frames the stream delivered byte for byte, `after=<newest>` returns an empty array with the cursor echoed, `limit=1` returns one frame with `truncated: true`, seven malformed windows are each refused with 400, and an unpaired request is refused with 401. The eviction case needs 65 frames to reach, so the ring's own window is covered by a unit suite next to it — including the boundary where a contiguous cursor is *not* a gap.
