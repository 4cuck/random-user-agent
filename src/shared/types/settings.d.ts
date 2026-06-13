import type { DeepPartial, DeepReadonly } from '~/types'

/**
 * Generator type.
 *
 * IMPORTANT NOTE: Don't forget to update the `settingsGeneratorTypes` array when you add or remove a generator type.
 */
export type SettingsGeneratorType =
  | 'chrome_win'
  | 'chrome_mac'
  | 'chrome_linux'
  | 'chrome_android'
  | 'firefox_win'
  | 'firefox_mac'
  | 'firefox_linux'
  | 'firefox_android'
  | 'opera_win'
  | 'opera_mac'
  | 'safari_iphone'
  | 'safari_mac'
  | 'edge_win'
  | 'edge_mac'
  | 'brave_win'
  | 'brave_mac'
  | 'brave_linux'
  | 'brave_android'
  | 'opera_android'

type SettingsState = {
  // Is the extension enabled?
  enabled: boolean

  // User-agent renewal options
  renew: {
    // Auto-renewal is enabled?
    enabled: boolean
    // Auto-renewal interval (in milliseconds)
    intervalMillis: number
    // Renewal on startup is enabled?
    onStartup: boolean
  }

  // Custom User-Agent options
  customUseragent: {
    // Custom User-Agent is enabled?
    enabled: boolean
    // Custom User-Agents list
    list: Array<string>
  }

  // Remote User-Agents list
  remoteUseragentList: {
    // Is enabled?
    enabled: boolean
    // Remote list URI
    uri: string
    // Update interval (in milliseconds)
    updateIntervalMillis: number
  }

  // Replace User-Agent using JavaScript?
  jsProtection: {
    // JS protection is enabled?
    enabled: boolean
  }

  // User-configurable Client Hints overrides. Empty strings mean "use the value derived from the user agent".
  clientHints: {
    // Full browser version reported via Client Hints (e.g. "149.0.7827.115"). Applied only when its major version
    // matches the active user agent's major version (otherwise it is ignored to avoid inconsistencies).
    fullVersion: string
    // Platform version for `Sec-CH-UA-Platform-Version` (e.g. "19.0.0"). Empty = per-OS default.
    platformVersion: string
    // Platform name for `Sec-CH-UA-Platform` (e.g. "Windows", "macOS"). Empty = derived from the user agent OS.
    platform: string
    // Form factors for `Sec-CH-UA-Form-Factors` (comma-separated, e.g. "Desktop" or "Mobile, Tablet"). Empty = off.
    formFactors: string
    // Device model for `Sec-CH-UA-Model` (e.g. "Pixel 7"). Empty = none (desktop default).
    model: string
    // CPU architecture for `Sec-CH-UA-Arch` (e.g. "x86", "arm"). Empty = auto ("" on mobile, "x86" on desktop).
    architecture: string
    // CPU bitness for `Sec-CH-UA-Bitness` (e.g. "64", "32"). Empty = auto ("" on mobile, "64" on desktop).
    bitness: string
    // Opera Mobile ("OperaMobile" brand) version, used by the opera_android generator (e.g. "99.2.5094.88935").
    // Empty = use the built-in default.
    operaMobileVersion: string
  }

  // Generator settings
  generator: {
    // Is the User-Agent generator enabled? When disabled, the extension only uses the custom / remote user
    // agents (whatever the user configured) and never auto-generates one.
    enabled: boolean
    // Periodically fetch the latest browser versions from the internet (Google / Mozilla / MDN) to keep the
    // generated user agents current. Disabled by default, since it makes periodic third-party network requests;
    // when off, the generator relies on its built-in (known-current) version list.
    autoUpdateVersions: boolean
    // Generator types
    types: Array<SettingsGeneratorType>
    // Sync the host OS with the selected (if true, the `os` from the combinations will be ignored)
    syncOsWithHost: boolean
  }

  // Blacklist settings
  blacklist: {
    // Blacklist mode. If set to 'blacklist', the extension will work on EVERY domain, except the listed in the
    // 'domains' array. In 'whitelist' vice versa - the extension will work ONLY on the listed domains.
    mode: 'blacklist' | 'whitelist'
    // Domains list
    domains: Array<string>

    // DEPRECATED: Custom rules (simple patterns), managed by user
    // custom: {
    //   rules: string[]
    // }
  }

  // REMOVED: Usage statistics settings
  // stats: {
  //   // Is enabled?
  //   enabled: boolean
  // }
}

export type ReadonlySettingsState = DeepReadonly<SettingsState>
export type PartialSettingsState = DeepPartial<SettingsState>
