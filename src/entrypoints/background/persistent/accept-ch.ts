/** A map of origin (canonical hostname) to the high-entropy Client Hint header names it requested (lowercased). */
type State = Record<string, ReadonlyArray<string>>

/**
 * Tracks, per origin, which high-entropy Client Hints that origin is allowed to receive. A real browser only sends
 * high-entropy hints (e.g. `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Platform-Version`, ...) to origins that asked
 * for them - instead of sending them to every server unconditionally (a detectable, non-browser-like behavior).
 *
 * There are two independent sources, kept in separate maps and merged on read:
 *   - `Accept-CH` response headers (replace semantics - the latest header for an origin wins);
 *   - `Delegate-CH` `<meta>` tags (union semantics - delegations from different pages accumulate per target).
 *
 * The data is kept in the `session` storage area: it survives service-worker restarts but is cleared when the
 * browser restarts (like the in-memory Client Hints cache of a fresh profile), and never persists to disk.
 */
export default class AcceptClientHints {
  private static readonly acceptKey = 'accept-ch-origins'
  private static readonly delegateKey = 'delegate-ch-origins'
  private loaded = false
  private acceptState: State = {}
  private delegateState: State = {}

  /** Lazily loads the stored state from the session storage area (once per service-worker lifetime). */
  private async load(): Promise<void> {
    if (this.loaded) {
      return
    }

    try {
      const items = await chrome.storage.session.get([AcceptClientHints.acceptKey, AcceptClientHints.delegateKey])

      this.acceptState = (items?.[AcceptClientHints.acceptKey] as State | undefined) ?? {}
      this.delegateState = (items?.[AcceptClientHints.delegateKey] as State | undefined) ?? {}
    } catch {
      this.acceptState = {}
      this.delegateState = {} // ignore session storage read failures
    }

    this.loaded = true
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
   * Remembers (replace semantics) the high-entropy hints an origin requested via `Accept-CH` (an empty set forgets
   * it). Returns `true` only when the stored set actually changed.
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

      this.acceptState = { ...this.acceptState, [origin]: next }
    }

    chrome.storage.session.set({ [AcceptClientHints.acceptKey]: this.acceptState }).catch(() => void 0)

    return true
  }

  /**
   * Adds (union semantics) high-entropy hints delegated to target origins via a `Delegate-CH` `<meta>` tag. The
   * argument maps each target origin to the hint header names delegated to it. Returns `true` if anything changed.
   */
  async delegate(delegations: Readonly<Record<string, ReadonlyArray<string>>>): Promise<boolean> {
    await this.load()

    const next: State = { ...this.delegateState }
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
      this.delegateState = next
      chrome.storage.session.set({ [AcceptClientHints.delegateKey]: this.delegateState }).catch(() => void 0)
    }

    return changed
  }
}
