// ⚠ DO NOT IMPORT ANYTHING EXCEPT TYPES HERE DUE THE `import()` ERRORS ⚠

// wrap everything to avoid polluting the global scope

;(() => {
  try {
    // Important Note:
    //
    // Chromium-based browsers (like Chrome, Edge, Opera, etc.) support the `world` property in the
    // `chrome.scripting.registerContentScripts` API. However, FireFox does not. Therefore, I need to ensure that the
    // "inject" script code is executed in both environments.
    //
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript

    const script = document.createElement('script')
    const parent = document.head || document.documentElement

    script.type = 'module'
    script.setAttribute('id', __UNIQUE_INJECT_FILENAME__)
    script.src = chrome.runtime.getURL(__UNIQUE_INJECT_FILENAME__)

    parent.prepend(script)
  } catch (err) {
    console.warn('🧨 RUA: An error occurred in the content script', err)
  }
})()

// Parse `Delegate-CH` <meta> tags (top frame only) and tell the background which origins were delegated which
// high-entropy Client Hints, so those hints are spoofed only for the delegated origins - mirroring how a real
// browser honors Client Hints delegation. The format is a ";"-separated list of "<sec-ch-hint> <origin> [...]".
;(() => {
  try {
    if (window.top !== window) {
      return // Delegate-CH only applies to the top-level browsing context
    }

    const RUA_SIGN = 'rua-proto-v2' // must match the messaging envelope signature in shared/messaging/runtime.ts

    const collect = (): Record<string, Array<string>> => {
      const result: Record<string, Array<string>> = {}

      document.querySelectorAll('meta[http-equiv="delegate-ch" i]').forEach((meta) => {
        const content = meta.getAttribute('content') || ''

        content.split(';').forEach((entry) => {
          const tokens = entry.trim().split(/\s+/).filter(Boolean)
          const hint = (tokens[0] || '').toLowerCase()

          if (!hint.startsWith('sec-ch-')) {
            return
          }

          // Delegate-CH also opts in same-origin sub-requests, then delegates to the listed cross-origin targets
          const targets: Array<string> = [location.hostname]

          for (const raw of tokens.slice(1)) {
            try {
              targets.push(new URL(raw).hostname)
            } catch {
              // ignore non-URL tokens
            }
          }

          for (const target of targets) {
            if (target) {
              if (!result[target]) {
                result[target] = []
              }

              result[target].push(hint)
            }
          }
        })
      })

      return result
    }

    const sendDelegations = (): void => {
      const delegations = collect()
      const origins = Object.keys(delegations)

      if (!origins.length) {
        return
      }

      // de-duplicate hints per target and cap the number of targets (defensive against a hostile page)
      const payload: Record<string, Array<string>> = {}

      for (const origin of origins.slice(0, 50)) {
        payload[origin] = [...new Set(delegations[origin])]
      }

      try {
        chrome.runtime.sendMessage({ sign: RUA_SIGN, batch: { delegateClientHints: [payload] } }).catch(() => undefined)
      } catch {
        // the background page may be unavailable; ignore
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sendDelegations, { once: true })
    } else {
      sendDelegations()
    }
  } catch (err) {
    console.warn('🧨 RUA: An error occurred while parsing Delegate-CH', err)
  }
})()
