import type { DeepReadonly } from '~/types'
import type StorageArea from './storage-area.ts'

type State = {
  versions: Partial<{
    chrome: number
    firefox: number
    opera: number
    safari: number
    edge: number
  }>
  updatedAt: number
}

export type ReadonlyVersionsState = DeepReadonly<State['versions']>

type MDNReleaseRecord = Readonly<{
  release_date?: string // YYYY-MM-DD, e.g. "2012-11-20", n/a for planned (beta) releases
  status: 'retired' | 'current' | 'beta' | 'nightly' | 'planned'
  release_notes?: string // URL, e.g. "https://blogs.opera.com/desktop/2023/06/opera-100-0-4815-30-stable-update/"
  engine_version?: string // e.g. "614.4.6" or "84"
}>

/**
 * Known-current major versions at the time of writing (June 2026). They are used as a floor so the stored versions
 * can never end up older than these - even when every remote source is unavailable or behind (the community
 * maintained MDN data in particular lags real releases by weeks or months). When a remote source reports something
 * newer, that newer value is used instead. Keep these roughly in sync with
 * `src/shared/user-agent/browser-versions.ts`.
 */
const fallbackVersions: Readonly<Record<'chrome' | 'firefox' | 'opera' | 'safari' | 'edge', number>> = {
  chrome: 149,
  firefox: 151,
  opera: 124,
  safari: 620, // WebKit major (the value this project uses as the Safari "major", e.g. AppleWebKit/620)
  edge: 149,
}

export default class {
  private readonly storage: StorageArea<State>

  constructor(storage: StorageArea<State>) {
    this.storage = storage
  }

  /** Fetches the latest browser versions and stores them in the storage. */
  async update(): Promise<void> {
    // read the previously stored versions so they (and the hard-coded fallbacks) can act as a floor
    const previous = (await this.storage.get())?.versions ?? {}

    // fetch from authoritative, always-current sources in parallel; each resolves to a major version or undefined.
    // Chrome and Firefox expose official version endpoints, while Opera and Safari (which have no public API) fall
    // back to the MDN browser-compat data as a best effort.
    const [chrome, firefox, opera, safari] = await Promise.all([
      this.fetchChromiumMajor(),
      this.fetchFirefoxMajor(),
      this.fetchOperaMajor(),
      this.fetchSafariWebKitMajor(),
    ])

    await this.storage.set({
      versions: {
        chrome: this.highest(chrome, previous.chrome, fallbackVersions.chrome),
        firefox: this.highest(firefox, previous.firefox, fallbackVersions.firefox),
        opera: this.highest(opera, previous.opera, fallbackVersions.opera),
        safari: this.highest(safari, previous.safari, fallbackVersions.safari),
        // Edge ships in lockstep with Chrome on the same Chromium major version
        edge: this.highest(chrome, previous.edge, fallbackVersions.edge),
      },
      updatedAt: Date.now(),
    })
  }

  async get(): Promise<readonly [ReadonlyVersionsState | undefined, Readonly<Date> | undefined]> {
    const state = await this.storage.get()

    return [state?.versions, state?.updatedAt ? new Date(state.updatedAt) : undefined]
  }

  async clear(): Promise<void> {
    await this.storage.clear()
  }

  /** Fetch the latest stable Chrome/Chromium major from the official Google version history API. */
  private async fetchChromiumMajor(): Promise<number | undefined> {
    try {
      // https://developer.chrome.com/docs/web-platform/versionhistory/guide
      // returns e.g. { "versions": [{ "version": "149.0.7827.115", ... }, ...] }
      const resp = await fetch(
        'https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions?order_by=version%20desc'
      )

      if (resp.ok) {
        const versions = (await resp.json())?.versions as ReadonlyArray<{ version?: string }> | undefined

        if (versions?.length) {
          return this.highest(...versions.map((v) => this.extractMajor(v.version))) || undefined
        }
      }
    } catch {
      // network/parsing failure - the caller falls back to the previous/known value
    }

    return undefined
  }

  /** Fetch the latest stable Firefox major from the official Mozilla product-details endpoint. */
  private async fetchFirefoxMajor(): Promise<number | undefined> {
    try {
      // https://product-details.mozilla.org/1.0/firefox_versions.json
      // returns e.g. { "LATEST_FIREFOX_VERSION": "151.0.4", ... }
      const resp = await fetch('https://product-details.mozilla.org/1.0/firefox_versions.json')

      if (resp.ok) {
        const data = (await resp.json()) as Readonly<Record<string, string>> | undefined

        return this.extractMajor(data?.['LATEST_FIREFOX_VERSION'])
      }
    } catch {
      // network/parsing failure - the caller falls back to the previous/known value
    }

    return undefined
  }

  /** Fetch the latest stable Opera major from MDN data (Opera has no official version API). */
  private async fetchOperaMajor(): Promise<number | undefined> {
    // Opera encodes its real version in the release-notes URL (e.g. .../desktop/2025/01/opera-116/), so we extract
    // it from there rather than from `engine_version` (which is the underlying Chromium version).
    const latest = this.latestStable(await this.fetchBrowserData('opera'))
    const match = latest?.release_notes?.match(/opera-(\d+)/)

    return match ? this.extractMajor(match[1]) : undefined
  }

  /** Fetch the latest Safari WebKit major from MDN data (Safari has no official version API). */
  private async fetchSafariWebKitMajor(): Promise<number | undefined> {
    // this project uses the WebKit engine version as the Safari "major" (e.g. AppleWebKit/620)
    return this.extractMajor(this.latestStable(await this.fetchBrowserData('safari'))?.engine_version)
  }

  /** Pick the newest stable (or, failing that, the most recently released) record from a set of MDN records. */
  private latestStable = (records: Array<MDNReleaseRecord> | null): MDNReleaseRecord | undefined => {
    if (!records?.length) {
      return undefined
    }

    const byNewestFirst = [...records].sort(this.sortByDate).reverse()

    return (
      byNewestFirst.find((release) => release.status === 'current') ??
      byNewestFirst.find((release) => release.status === 'retired') ??
      records[0]
    )
  }

  /** Fetch the browser versions data from MDN. */
  private async fetchBrowserData<T extends 'opera' | 'safari'>(browser: T): Promise<Array<MDNReleaseRecord> | null> {
    try {
      // the filename is the same as the browser name (e.g. "opera.json") in the current major version (v5) of the
      // MDN data: https://cdn.jsdelivr.net/gh/mdn/browser-compat-data@5/browsers/ - list of all available files.
      // note: MDN data is community-maintained and lags real releases, which is why it is only used as a fallback
      // for the browsers without an official version API, and always floored by `fallbackVersions`.
      const resp = await fetch(`https://cdn.jsdelivr.net/gh/mdn/browser-compat-data@5/browsers/${browser}.json`)

      if (resp.ok) {
        const releases = (await resp.json())?.browsers[browser]?.releases

        if (releases) {
          return Object.values(releases)
        }
      }
    } catch {
      // network/parsing failure - the caller falls back to the previous/known value
    }

    return null
  }

  /** Returns the highest of the provided (possibly undefined) major version numbers (0 when none are valid). */
  private highest = (...values: ReadonlyArray<number | undefined>): number =>
    values.reduce<number>((max, value) => (typeof value === 'number' && value > max ? value : max), 0)

  /** Sorts the records by the release date (ascending). */
  private sortByDate = <T extends MDNReleaseRecord>(a: T, b: T) =>
    (a.release_date ? new Date(a.release_date).getTime() : 0) -
    (b.release_date ? new Date(b.release_date).getTime() : 0)

  /** Extract the major version from a string. If the string is empty or doesn't contain a number, return undefined. */
  private extractMajor = (str: string | undefined): number | undefined => {
    if (!str) {
      return undefined
    }

    const major = parseInt(str.replaceAll(/[^\d.]/g, '').split('.')[0])

    return isNaN(major) ? undefined : major
  }
}
