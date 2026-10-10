// Sequencing for heartbeats: strictly increasing `seq`, one in flight at a
// time, a single retry that REUSES the same seq (so the server's idempotency
// check treats it as the same report), then drop and move on. Pure so bun
// tests can drive it with a fake sender.

export interface HeartbeatPayload {
  sessionId: string
  activityUuid: string
  seq: number
  currentTime: number
  playbackRate: number
  playerState: 'playing' | 'paused' | 'ended'
  visible: boolean
  sourceProvider?: 'hosted' | 'youtube' | 'vimeo'
}

export type HeartbeatDraft = Omit<HeartbeatPayload, 'seq'>

export interface HeartbeatQueueOptions {
  send: (_payload: HeartbeatPayload, _opts: { keepalive: boolean }) => Promise<unknown>
  onResult?: (_result: unknown, _payload: HeartbeatPayload) => void
  onError?: (_error: unknown, _payload: HeartbeatPayload) => void
}

export class HeartbeatQueue {
  private seq = 0
  private inFlight: Promise<void> | null = null
  private pending: { draft: HeartbeatDraft; keepalive: boolean } | null = null
  private consecutiveErrors = 0

  constructor(private readonly opts: HeartbeatQueueOptions) {}

  get nextSeq(): number {
    return this.seq + 1
  }

  get errors(): number {
    return this.consecutiveErrors
  }

  reset(): void {
    this.seq = 0
    this.pending = null
    this.consecutiveErrors = 0
  }

  // Enqueue a heartbeat. While one is in flight the newest draft replaces any
  // waiting one: position reports are cumulative, so the latest is enough.
  push(draft: HeartbeatDraft, { keepalive = false } = {}): Promise<void> {
    this.pending = { draft, keepalive }
    if (!this.inFlight) {
      this.inFlight = this.drain().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const { draft, keepalive } = this.pending
      this.pending = null
      const payload: HeartbeatPayload = { ...draft, seq: ++this.seq }
      let attempt = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const result = await this.opts.send(payload, { keepalive })
          this.consecutiveErrors = 0
          this.opts.onResult?.(result, payload)
          break
        } catch (error) {
          attempt += 1
          const status = (error as { status?: number })?.status
          // 409 (superseded) / 404 (no session) are terminal for this session.
          if (status === 409 || status === 404 || attempt > 1 || keepalive) {
            this.consecutiveErrors += 1
            this.opts.onError?.(error, payload)
            break
          }
        }
      }
    }
  }
}
