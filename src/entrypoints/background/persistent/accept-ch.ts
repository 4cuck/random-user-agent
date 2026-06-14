/** A map of origin (canonical hostname) to the high-entropy Client Hint header names it requested (lowercased). */
type State = Record<string, ReadonlyArray<string>>

/**
 * Tracks, per origin, which high-entropy Client Hints that origin is allowed to receive. A real browser only sends
 * high-entropy hints (e.g. `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Platform-Version`, ...) to origins that asked
 * for them - instead of sending them to every server unconditionally (a detectable, non-browser-like behavior).
 *
 * There are two independent sources, kept in separate maps and merged on read:
 *   - `Accept-CH` / `Critical-CH` response headers (replace semantics - the latest header set for an origin wins);
 *   - `Delegate-CH` `<meta>` tags (union semantics - delegations from different pages accumulate per target).
 *
 * The data is kept in the `local` storage area so it survives browser restarts, mirroring how a real browser
 * persists the server's `Accept-CH` opt-in. This is what lets the (persistent) request-header rules be in place
 * before the first request on a later visit - including the immediate `Critical-CH` retry, which is dispatched too
 * fast for an asynchronously-registered rule to catch on the very first visit. The data is local-only and never
 * sent anywhere; the number of remembered origins is capped to avoid unbounded growth.
 */
export default class AcceptClientHints {
  private static readonly acceptKey = 'accept-ch-origins'
  private static readonly delegateKey = 'delegate-ch-origins'
  private static readonly maxOrigins = 256 // per source; bounds the stored data and the rule domain lists
  private loaded = false
  private acceptState: State = {}
  private delegateState: State = {}

  /** Lazily loads the stored state from the local storage area (once per service-worker lifetime). */
  private async load(): Promise<void> {
    if (this.loaded) {
      return
    }

    try {
      const items = await chrome.storage.local.get([AcceptClientHints.acceptKey, AcceptClientHints.delegateKey])

      this.acceptState = (items?.[AcceptClientHints.acceptKey] as State | undefined) ?? {}
      this.delegateState = (items?.[AcceptClientHints.delegateKey] as State | undefined) ?? {}
    } catch {
      this.acceptState = {}
      this.delegateState = {} // ignore storage read failures
    }

    this.loaded = true
  }

  /** Drops the oldest entries (by insertion order) so the map never exceeds `maxOrigins`. */
  private static capped(state: State): State {
    const keys = Object.keys(state)

    if (keys.length <= AcceptClientHints.maxOrigins) {
      return state
    }

    const trimmed = { ...state }

    for (const key of keys.slice(0, keys.length - AcceptClientHints.maxOrigins)) {
      delete trimmed[key]
    }

    return trimmed
  }

  /** Returns every opted-in origin and the union of the high-entropy hint header names it may receive. */
  async getAll(): Promise<Readonly<State>> {
    await this.load()

    if (Object.keys(this.delegateState).length === 0) {
      return this.acceptState // fast path: no delegations
    }

    const merged: Record<string, Array<string>> = {}

    for (const [origin, hints] of Object.entries(this.acceptState)) {
      merged[origin] = [...hints]
    }

    for (const [origin, hints] of Object.entries(this.delegateState)) {
      const set = new Set(merged[origin] ?? [])
      hints.forEach((h) => set.add(h))
      merged[origin] = [...set].sort()
    }

    return merged
  }

  /**
   * Remembers (replace semantics) the high-entropy hints an origin requested via `Accept-CH` / `Critical-CH` (an
   * empty set forgets it). Returns `true` only when the stored set actually changed.
   */
  async remember(origin: string, hints: ReadonlyArray<string>): Promise<boolean> {
    await this.load()

    const next = [...new Set(hints.map((h) => h.toLowerCase()))].sort()
    const previous = this.acceptState[origin]

    if (next.length === 0) {
      if (previous === undefined) {
        return false
      }

      const rest = { ...this.acceptState }
      delete rest[origin]
      this.acceptState = rest
    } else {
      const unchanged =
        previous !== undefined && previous.length === next.length && previous.every((h, i) => h === next[i])

      if (unchanged) {
        return false
      }

      this.acceptState = AcceptClientHints.capped({ ...this.acceptState, [origin]: next })
    }

    chrome.storage.local.set({ [AcceptClientHints.acceptKey]: this.acceptState }).catch(() => void 0)

    return true
  }

  /**
   * Adds (union semantics) high-entropy hints delegated to target origins via a `Delegate-CH` `<meta>` tag. The
   * argument maps each target origin to the hint header names delegated to it. Returns `true` if anything changed.
   */
  async delegate(delegations: Readonly<Record<string, ReadonlyArray<string>>>): Promise<boolean> {
    await this.load()

    let next: State = { ...this.delegateState }
    let changed = false

    for (const [origin, hints] of Object.entries(delegations)) {
      if (!origin) {
        continue
      }

      const set = new Set(next[origin] ?? [])
      const before = set.size
      hints.forEach((h) => set.add(h.toLowerCase()))

      if (set.size !== before) {
        next[origin] = [...set].sort()
        changed = true
      }
    }

    if (changed) {
      next = AcceptClientHints.capped(next)
      this.delegateState = next
      chrome.storage.local.set({ [AcceptClientHints.delegateKey]: this.delegateState }).catch(() => void 0)
    }

    return changed
  }
}
