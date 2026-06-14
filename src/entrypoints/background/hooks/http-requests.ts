import {
  browserBrands,
  defaultOperaMobileVersion,
  isMobile,
  operaMobileBrands,
  platform,
  platformVersion,
} from '~/shared/client-hint'
import { canonizeDomain, validateDomainOrIP } from '~/shared'
import type { ContentScriptPayload, ReadonlySettingsState, ReadonlyUserAgentState } from '~/shared/types'

// copy-paste of chrome.declarativeNetRequest.RuleActionType type (FireFox v124 does not have it)
// https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-RuleActionType
enum RuleActionType {
  BLOCK = 'block', // Block the network request
  REDIRECT = 'redirect', // Redirect the network request
  ALLOW = 'allow', // Allow the network request. The request won't be intercepted if there is an allow rule which matches it
  UPGRADE_SCHEME = 'upgradeScheme', // Upgrade the network request url's scheme to https if the request is http or ftp
  MODIFY_HEADERS = 'modifyHeaders', // Modify request/response headers from the network request
  ALLOW_ALL_REQUESTS = 'allowAllRequests', // Allow all requests within a frame hierarchy, including the frame request itself
}

// copy-paste of chrome.declarativeNetRequest.HeaderOperation type (FireFox v124 does not have it)
// https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-HeaderOperation
enum HeaderOperation {
  APPEND = 'append', // Adds a new entry for the specified header. This operation is not supported for request headers
  SET = 'set', // Sets a new value for the specified header, removing any existing headers with the same name
  REMOVE = 'remove', // Removes all entries for the specified header
}

// Note: the rule IDs must be unique, and do not change them after the extension is published.
// The rule IDs are used to remove the existing rules before adding new ones.
const RuleIDs: { readonly [_ in 'ReplaceUserAgent' | 'ReplaceClientHints' | 'ProvidePayload']: number } = {
  ReplaceUserAgent: 1,
  ReplaceClientHints: 2,
  ProvidePayload: 3,
}

// High-entropy Client Hints are only sent to origins that opted in via the `Accept-CH` response header. Each
// distinct requested hint set gets its own rule in this reserved id range, with a higher priority than the base
// rules so its `set` operations win over the base rule's default `remove` operations.
const HIGH_ENTROPY_RULE_ID_BASE = 1_000
const MAX_HIGH_ENTROPY_RULES = 128
const managedRuleIds: ReadonlyArray<number> = [
  ...Object.values(RuleIDs),
  ...Array.from({ length: MAX_HIGH_ENTROPY_RULES }, (_, i) => HIGH_ENTROPY_RULE_ID_BASE + i),
]

enum HeaderNames {
  USER_AGENT = 'User-Agent',
  CLIENT_HINT_FULL_VERSION = 'Sec-CH-UA-Full-Version', // deprecated, https://mzl.la/3g1NzEI
  CLIENT_HINT_PLATFORM_VERSION = 'Sec-CH-UA-Platform-Version', // https://mzl.la/3yyNXAY
  CLIENT_HINT_BRAND_MAJOR = 'Sec-CH-UA', // https://mzl.la/3EaQyoi
  CLIENT_HINT_BRAND_FULL = 'Sec-CH-UA-Full-Version-List', // https://mzl.la/3C3x5TT
  CLIENT_HINT_PLATFORM = 'Sec-CH-UA-Platform', // https://mzl.la/3EbrbTj
  CLIENT_HINT_MOBILE = 'Sec-CH-UA-Mobile', // https://mzl.la/3SYTA3f
  CLIENT_HINT_FORM_FACTORS = 'Sec-CH-UA-Form-Factors', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-UA-Form-Factors
  CLIENT_HINT_MODEL = 'Sec-CH-UA-Model', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-UA-Model
  CLIENT_HINT_ARCH = 'Sec-CH-UA-Arch', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-UA-Arch
  CLIENT_HINT_BITNESS = 'Sec-CH-UA-Bitness', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-UA-Bitness
  SERVER_TIMING = 'server-timing', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing
}

// Domains that are always excluded from the rules (none by default). When spoofing one Chromium browser as another
// (Chrome <-> Edge <-> Opera <-> Brave) the TLS/JA3 handshake and the JS environment (the `chrome` object, canvas,
// WebGL, ...) are genuinely identical, so a Cloudflare challenge can be satisfied as long as the spoof is fully
// self-consistent - including inside Web Workers (see the worker navigator patch in inject.ts). The challenge is
// therefore no longer carved out here; users who spoof across engines/OS (where untouchable signals diverge) can
// still exclude `challenges.cloudflare.com` via the blacklist setting.
const alwaysExcludedFor: ReadonlyArray<string> = []

/**
 * The high-entropy Client Hint request headers. Unlike the low-entropy hints (`Sec-CH-UA`, `Sec-CH-UA-Mobile`,
 * `Sec-CH-UA-Platform`), which every browser sends on every request, these are sent by a real browser only to
 * origins that requested them through the `Accept-CH` response header. The extension therefore strips them by
 * default and re-adds the spoofed values only for opted-in origins.
 */
export const highEntropyClientHintHeaders: ReadonlyArray<string> = [
  HeaderNames.CLIENT_HINT_BRAND_FULL,
  HeaderNames.CLIENT_HINT_FULL_VERSION,
  HeaderNames.CLIENT_HINT_PLATFORM_VERSION,
  HeaderNames.CLIENT_HINT_ARCH,
  HeaderNames.CLIENT_HINT_BITNESS,
  HeaderNames.CLIENT_HINT_MODEL,
  HeaderNames.CLIENT_HINT_FORM_FACTORS,
]

/**
 * Enables the request headers modification.
 *
 * The filter parameter is optional and can be used to apply the rules only to specific domains.
 * If filter is not provided, the rules are applied to all domains.
 *
 * Enabling payload sending means that the JS protection is enabled.
 *
 * To debug the rules, you can use the following page:
 * https://www.whatismybrowser.com/detect/what-http-headers-is-my-browser-sending
 *
 * @link https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
 *
 * @throws {Error} If the rules cannot be set
 */
export async function setRequestHeaders(
  ua: ReadonlyUserAgentState,
  filter?: { applyToDomains?: ReadonlyArray<string>; exceptDomains?: ReadonlyArray<string> },
  sendPayload: boolean = false,
  clientHints?: ReadonlySettingsState['clientHints'],
  // origins (canonical hostnames) that opted into high-entropy Client Hints via `Accept-CH`, mapped to the hint
  // header names they requested. When omitted, no high-entropy hints are sent (only the low-entropy ones).
  acceptCH?: Readonly<Record<string, ReadonlyArray<string>>>
): Promise<Array<chrome.declarativeNetRequest.Rule>> {
  const condition: chrome.declarativeNetRequest.RuleCondition = {
    resourceTypes: Object.values(chrome?.declarativeNetRequest?.ResourceType || {}),
  }

  if (filter?.applyToDomains && filter.applyToDomains.length > 0) {
    // initiatorDomains: The rule only matches network requests originating from this list of domains. If the list
    //                   is omitted, the rule is applied to requests from all domains. An empty list is not allowed.
    //                   A canonical domain should be used. This matches against the request initiator and not the
    //                   request URL.
    //   requestDomains: The rule only matches network requests when the domain matches one from this list. If the
    //                   list is omitted, the rule is applied to requests from all domains. An empty list is not
    //                   allowed. A canonical domain should be used.
    //
    // https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-MatchedRulesFilter
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/RuleCondition
    const list = filter.applyToDomains.map(canonizeDomain).filter(validateDomainOrIP)

    if (list.length) {
      condition.initiatorDomains = condition.requestDomains = list
    }
  }

  if (filter?.exceptDomains && filter.exceptDomains.length > 0) {
    // excludedInitiatorDomains: The rule does not match network requests originating from this list of domains.
    //                           If the list is empty or omitted, no domains are excluded. This takes precedence
    //                           over initiatorDomains. A canonical domain should be used. This matches against
    //                           the request initiator and not the request URL.
    //   excludedRequestDomains: The rule does not match network requests when the domains matches one from this
    //                           list. If the list is empty or omitted, no domains are excluded. This takes
    //                           precedence over requestDomains. A canonical domain should be used.
    const list = filter.exceptDomains.map(canonizeDomain).filter(validateDomainOrIP)

    if (list.length) {
      condition.excludedInitiatorDomains = condition.excludedRequestDomains = list
    }
  }

  // add the always-excluded domains to the condition, if any (a DNR condition must never contain an empty domain
  // list, so we only touch these fields when there is actually something to exclude)
  if (alwaysExcludedFor.length) {
    condition.excludedInitiatorDomains = [
      ...new Set((condition.excludedInitiatorDomains ?? []).concat(alwaysExcludedFor)),
    ]
    condition.excludedRequestDomains = [...new Set((condition.excludedRequestDomains ?? []).concat(alwaysExcludedFor))]
  }

  // user-configurable Client Hints overrides (managed in the extension settings). Empty values fall back to the
  // data derived from the active user agent.
  const fullVersionOverride = (clientHints?.fullVersion ?? '').trim()
  const chromiumVersionOverride = (clientHints?.chromiumVersion ?? '').trim()
  // Opera Mobile is special: it reports a four-brand list with an extra "OperaMobile" brand, and its
  // `uaFullVersion` / `Sec-CH-UA-Full-Version` carry the (configurable) OperaMobile version
  const isOperaMobile = ua.browser === 'opera' && ua.os === 'android'
  const operaMobileFull = (clientHints?.operaMobileVersion ?? '').trim() || defaultOperaMobileVersion
  const operaMobileMajor = parseInt(operaMobileFull, 10) || 0
  // The wrapper brand version (the "Google Chrome" / "Microsoft Edge" / "Opera" brand). The user override is applied
  // only when its major matches the active user agent major, so `Sec-CH-UA` (major) and the user agent string stay
  // consistent with `Sec-CH-UA-Full-Version-List` (full).
  // Opera Mobile is the exception: its "Opera" brand version (e.g. 133) is independent of the user agent, which
  // carries the OperaMobile version in its OPR/ token (e.g. OPR/99), not the Opera-brand major - so the override is
  // applied unconditionally there (it never contradicts the user agent string).
  const applyBrandOverride =
    !!fullVersionOverride && (isOperaMobile || parseInt(fullVersionOverride, 10) === ua.version.browser.major)
  const brandFull = applyBrandOverride ? fullVersionOverride : ua.version.browser.full
  const brandMajor = applyBrandOverride ? parseInt(fullVersionOverride, 10) : ua.version.browser.major
  // The under-the-hood Chromium engine full version (the "Chromium" brand) for Chromium wrappers (Edge, Opera).
  // Same major-match rule, compared against the under-the-hood Chromium major version.
  const chromiumFull =
    chromiumVersionOverride &&
    ua.version.underHood &&
    parseInt(chromiumVersionOverride, 10) === ua.version.underHood.major
      ? chromiumVersionOverride
      : ua.version.underHood?.full || ''
  // `uaFullVersion` / `Sec-CH-UA-Full-Version`: Opera Mobile reports the OperaMobile version, every other browser
  // reports its own brand full version
  const effectiveFull = isOperaMobile ? operaMobileFull : brandFull
  const platformOverride = (clientHints?.platform ?? '').trim()
  const platformVersionOverride = (clientHints?.platformVersion ?? '').trim()
  const formFactors = (clientHints?.formFactors ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const model = (clientHints?.model ?? '').trim()
  // architecture & bitness are empty strings on mobile (matching how real mobile Chromium reports them), otherwise
  // they use the user override or a sensible desktop default
  const architecture = (clientHints?.architecture ?? '').trim() || (isMobile(ua.os) ? '' : 'x86')
  const bitness = (clientHints?.bitness ?? '').trim() || (isMobile(ua.os) ? '' : '64')

  const brandsWithMajor = (() => {
    switch (ua.browser) {
      case 'chrome':
        return browserBrands('chrome', brandMajor)
      case 'opera':
        return isOperaMobile
          ? operaMobileBrands(brandMajor, ua.version.underHood?.major || 0, operaMobileMajor)
          : browserBrands('opera', brandMajor, ua.version.underHood?.major || 0)
      case 'edge':
        return browserBrands('edge', brandMajor, ua.version.underHood?.major || 0)
      case 'brave':
        return browserBrands('brave', brandMajor)
    }

    return []
  })()

  const brandsWithFull = (() => {
    switch (ua.browser) {
      case 'chrome':
        return browserBrands('chrome', brandFull)
      case 'opera':
        return isOperaMobile
          ? operaMobileBrands(brandFull, chromiumFull, operaMobileFull)
          : browserBrands('opera', brandFull, chromiumFull)
      case 'edge':
        return browserBrands('edge', brandFull, chromiumFull)
      case 'brave':
        return browserBrands('brave', brandFull)
    }

    return []
  })()

  const setPlatform = platformOverride || platform(ua.os)
  const setIsMobile = isMobile(ua.os)
  const setPlatformVersion = platformVersionOverride || platformVersion(setPlatform)

  // High-entropy Client Hint values (header -> value), derived from the spoofed user agent. `undefined` means the
  // hint is not applicable for the current browser/config and is therefore never sent.
  const highEntropyHeaderValues: ReadonlyArray<readonly [HeaderNames, string | undefined]> = [
    [
      HeaderNames.CLIENT_HINT_BRAND_FULL,
      brandsWithFull.length ? brandsWithFull.map((b) => `"${b.brand}";v="${b.version}"`).join(', ') : undefined,
    ],
    // Sec-CH-UA-Full-Version is deprecated; Brave strips it for privacy, so we omit it when spoofing Brave
    [
      HeaderNames.CLIENT_HINT_FULL_VERSION,
      brandsWithMajor.length && ua.browser !== 'brave' ? `"${effectiveFull}"` : undefined,
    ],
    [
      HeaderNames.CLIENT_HINT_PLATFORM_VERSION,
      brandsWithMajor.length && setPlatformVersion ? `"${setPlatformVersion}"` : undefined,
    ],
    [HeaderNames.CLIENT_HINT_ARCH, brandsWithMajor.length ? `"${architecture}"` : undefined],
    [HeaderNames.CLIENT_HINT_BITNESS, brandsWithMajor.length ? `"${bitness}"` : undefined],
    // Sec-CH-UA-Model is emitted to any opted-in Chromium origin, defaulting to "" like a real desktop browser
    [HeaderNames.CLIENT_HINT_MODEL, brandsWithMajor.length ? `"${model}"` : undefined],
    [
      HeaderNames.CLIENT_HINT_FORM_FACTORS,
      brandsWithMajor.length && formFactors.length ? formFactors.map((f) => `"${f}"`).join(', ') : undefined,
    ],
  ]

  // is the extension active for the given (canonical request) origin, per the current blacklist/whitelist filter?
  const isOriginInScope = (origin: string): boolean => {
    const matches = (domains: ReadonlyArray<string>): boolean =>
      domains.some((d) => {
        const canonical = canonizeDomain(d)

        return origin === canonical || origin.endsWith(`.${canonical}`)
      })

    if (filter?.applyToDomains?.length) {
      return matches(filter.applyToDomains)
    }

    if (filter?.exceptDomains?.length) {
      return !matches(filter.exceptDomains)
    }

    return true
  }

  const payload: ContentScriptPayload = {
    current: ua,
    brands: {
      major: brandsWithMajor,
      full: brandsWithFull,
    },
    platform: setPlatform,
    platformVersion: setPlatformVersion,
    isMobile: setIsMobile,
    fullVersion: effectiveFull,
    formFactors,
    model,
    architecture,
    bitness,
  }

  const rules: Array<chrome.declarativeNetRequest.Rule> = [
    {
      id: RuleIDs.ReplaceUserAgent,
      action: {
        type: RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            operation: HeaderOperation.SET,
            header: HeaderNames.USER_AGENT,
            value: ua.userAgent,
          },
        ],
      },
      condition,
    },
    {
      id: RuleIDs.ReplaceClientHints,
      action: {
        type: RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          brandsWithMajor.length
            ? {
                operation: HeaderOperation.SET,
                header: HeaderNames.CLIENT_HINT_BRAND_MAJOR,
                value: brandsWithMajor.map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
              }
            : { operation: HeaderOperation.REMOVE, header: HeaderNames.CLIENT_HINT_BRAND_MAJOR },
          {
            operation: HeaderOperation.SET,
            header: HeaderNames.CLIENT_HINT_PLATFORM,
            value: `"${setPlatform}"`,
          },
          {
            operation: HeaderOperation.SET,
            header: HeaderNames.CLIENT_HINT_MOBILE,
            value: setIsMobile ? '?1' : '?0',
          },
          // High-entropy hints are stripped by default (a real browser does not send them unless the server opted
          // in via Accept-CH). They are re-added with spoofed values only for opted-in origins by the higher
          // priority rules built below - this also prevents the real browser values from leaking.
          ...highEntropyHeaderValues.map(([header]) => ({ operation: HeaderOperation.REMOVE, header })),
        ],
      },
      condition,
    },
  ]

  if (sendPayload) {
    rules.push({
      id: RuleIDs.ProvidePayload,
      action: {
        type: RuleActionType.MODIFY_HEADERS,
        responseHeaders: [
          {
            operation: HeaderOperation.SET,
            header: HeaderNames.SERVER_TIMING,
            value: `${__UNIQUE_HEADER_KEY_NAME__};desc="${btoa(JSON.stringify(payload)).replace(/=/g, '_')}"`,
          },
        ],
      },
      condition,
    })
  }

  // build the high-entropy rules: one per distinct requested hint set, applied only to the in-scope origins that
  // opted into exactly that set via Accept-CH (higher priority so each `set` wins over the base rule's `remove`)
  if (acceptCH) {
    const groups = new Map<
      string,
      { headers: Array<chrome.declarativeNetRequest.ModifyHeaderInfo>; origins: Array<string> }
    >()

    for (const [origin, requestedHints] of Object.entries(acceptCH)) {
      if (!origin || !isOriginInScope(origin)) {
        continue
      }

      const requested = new Set(requestedHints.map((h) => h.toLowerCase()))
      const headers = highEntropyHeaderValues
        .filter(([header, value]) => value !== undefined && requested.has(header.toLowerCase()))
        .map(([header, value]) => ({ operation: HeaderOperation.SET, header, value: value as string }))

      if (!headers.length) {
        continue
      }

      const key = headers.map((h) => h.header).join(',')
      const group = groups.get(key) ?? { headers, origins: [] }
      group.origins.push(origin)
      groups.set(key, group)
    }

    let highEntropyRuleId = HIGH_ENTROPY_RULE_ID_BASE
    for (const group of groups.values()) {
      if (highEntropyRuleId >= HIGH_ENTROPY_RULE_ID_BASE + MAX_HIGH_ENTROPY_RULES) {
        break // safety cap on the number of distinct high-entropy rules
      }

      rules.push({
        id: highEntropyRuleId++,
        priority: 2,
        action: { type: RuleActionType.MODIFY_HEADERS, requestHeaders: group.headers },
        condition: { ...condition, requestDomains: group.origins },
      })
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...managedRuleIds], // remove all rules this extension manages (base + high-entropy)
    addRules: rules,
  })

  return rules
}

/** Unsets the request headers. */
export async function unsetRequestHeaders(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...managedRuleIds], // remove all rules this extension manages (base + high-entropy)
  })
}
