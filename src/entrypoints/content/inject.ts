// ⚠ DO NOT IMPORT ANYTHING EXCEPT TYPES HERE DUE THE `import()` ERRORS ⚠
import type { ContentScriptPayload } from '~/shared/types'
import type { DeepWriteable } from '~/types'

// wrap everything to avoid polluting the global scope
;(() => {
  // prevent the script from running multiple times
  {
    const [key, ds, flag] = [__UNIQUE_HEADER_KEY_NAME__.toLowerCase(), document.documentElement.dataset, 'true']
    if (ds[key] === flag) {
      return
    }

    // permanent (per-document) run-once marker. A 1-second self-clearing guard could be bypassed when the two
    // deliveries of this script (the MAIN-world registered content script + the <script> tag injected by content.js)
    // land more than a second apart on a slow load, causing it to run twice and wrap the DOM/prototype proxies in
    // nested proxies. Leaving the marker set guarantees at-most-once execution per document.
    ds[key] = flag
  }

  /** Extracts the payload from the performance entries (which are sent by the background script) */
  const extractPayload = (): ContentScriptPayload | undefined => {
    for (const entry of performance.getEntriesByType('navigation')) {
      if (entry instanceof PerformanceNavigationTiming) {
        for (const timing of entry.serverTiming) {
          if (timing.name === __UNIQUE_HEADER_KEY_NAME__) {
            return JSON.parse(atob(timing.description.replace(/_/g, '=')))
          }
        }
      }
    }

    return
  }

  /** Finds and removes the injected script */
  const findAndRemoveScriptTag = (): boolean => {
    const injectedScript = document.getElementById(__UNIQUE_INJECT_FILENAME__) as HTMLScriptElement | null
    if (injectedScript) {
      injectedScript.remove()

      return true
    }

    return false
  }

  /** Overloads the object property with the new value. */
  const overload = <T>(
    t: T,
    prop: T extends Navigator ? keyof T | 'oscpu' | 'brave' : keyof T,
    value: unknown,
    options: { force?: boolean; configurable?: boolean; writable?: boolean } = {
      force: false,
      configurable: true,
      writable: false,
    }
  ): void => {
    const opts = { force: false, configurable: true, writable: false, ...options }
    let target: T = t

    try {
      while (target !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(target, prop)

        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
        if (descriptor && descriptor.configurable) {
          const newAttributes: PropertyDescriptor = { configurable: opts.configurable, enumerable: true }

          // respect the original value getting method
          if (descriptor.get) {
            // Wrap the NATIVE getter in a Proxy of it (not a plain `() => value`) so `Function.prototype.toString`
            // still reports `[native code]` and a fingerprinter (CreepJS) sees no navigator / userAgentData "lie". The
            // apply trap calls the native getter first to reproduce its this-brand check (throwing on an invalid
            // receiver such as the bare prototype) before returning the spoofed value. This keeps the v4.7.2 spoof -
            // which passes Cloudflare Turnstile - intact (it never replaces `window.navigator` or the real objects),
            // while making it undetectable to CreepJS.
            const nativeGet = descriptor.get
            newAttributes.get = new Proxy(nativeGet, {
              apply(getterTarget, thisArg, getterArgs): unknown {
                Reflect.apply(getterTarget, thisArg, getterArgs)

                return value
              },
            })
          } else {
            newAttributes.value = value
            newAttributes.writable = opts.writable
          }

          Object.defineProperty(target, prop, newAttributes)
        } else if (opts.force && Object.getPrototypeOf(t) === Object.getPrototypeOf(target)) {
          Object.defineProperty(target, prop, {
            value,
            configurable: opts.configurable,
            enumerable: true,
            writable: opts.writable,
          })
        }

        target = Object.getPrototypeOf(target)
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) {
      // do nothing
    }
  }

  try {
    // first of all, remove the injected script
    findAndRemoveScriptTag()

    // check the payload existence and do nothing if it is not found
    const payload = extractPayload()
    if (!payload) {
      // no payload = no fun
      //
      // probably, the page was already patched and the script tag was removed by this script, but registered with
      // the `world: 'MAIN'` property (Chromium-based browsers only)
      return
    }

    // The masked user-agent string (Chromium browser/under-the-hood versions reduced to `major.0.0.0`) and the
    // platform value. They are computed once and reused for the page, iframes, and Web Workers so a fingerprinter
    // sees identical values everywhere it looks.
    const spoofedUserAgent = ((): string => {
      switch (payload.current.browser) {
        case 'chrome':
        case 'opera':
        case 'edge': // blink engine
        case 'brave': // blink engine
          // mask the browser (and under the hood) versions, keeping only the major version (e.g., 92.0.4515.107 -> 92.0.0.0)
          const masked = payload.current.userAgent.replaceAll(
            payload.current.version.browser.full,
            payload.current.version.browser.major +
              '.0'.repeat(Math.max(0, payload.current.version.browser.full.split('.').length - 1))
          )

          if (payload.current.version.underHood) {
            return masked.replaceAll(
              payload.current.version.underHood.full || '',
              payload.current.version.underHood.major +
                '.0'.repeat(Math.max(0, payload.current.version.underHood.full.split('.').length - 1))
            )
          }

          return masked
      }

      return payload.current.userAgent
    })()

    const spoofedAppVersion = ((): string => {
      if (payload.current.browser === 'firefox') {
        switch (payload.current.os) {
          case 'windows':
            return '5.0 (Windows)'
          case 'linux':
            return '5.0 (X11)'
        }

        return '5.0'
      }

      return spoofedUserAgent.replace(/^Mozilla\//i, '')
    })()

    const spoofedPlatform = ((): string | undefined => {
      switch (payload.current.os) {
        case 'windows':
          return 'Win32'
        case 'linux':
          return 'Linux x86_64'
        case 'android':
          return 'Linux armv8l'
        case 'macOS':
          return 'MacIntel'
        case 'iOS':
          return 'iPhone'
      }

      return undefined
    })()

    /**
     * Function to patch the navigator object.
     *
     * @link https://developer.mozilla.org/en-US/docs/Web/API/Navigator
     */
    const patchNavigator = (n: Navigator): void => {
      if (n === null || typeof n !== 'object' || !('userAgent' in n)) {
        return
      }

      // to test, execute in the console: `console.log(navigator.userAgent)`
      overload(n, 'userAgent', spoofedUserAgent)

      // to test, execute in the console: `console.log(navigator.appVersion)`
      overload(n, 'appVersion', spoofedAppVersion)

      // to test, execute in the console: `console.log(navigator.platform, navigator.oscpu)`
      if (spoofedPlatform) {
        overload(n, 'platform', spoofedPlatform)
      }

      // oscpu is exposed ONLY by Firefox. Override it WITHOUT `force`, so a Firefox engine reports the spoofed value
      // (or `undefined`, to hide the real one when spoofing a non-Firefox UA), while on Chromium - which has no native
      // oscpu getter - nothing is added. Force-adding an own `oscpu: undefined` is exactly the own-property anomaly that
      // CreepJS flags as a navigator lie, so we must not do that.
      {
        const oscpu: string | undefined =
          payload.current.browser !== 'firefox'
            ? undefined
            : payload.current.os === 'windows'
              ? 'Windows NT; Win64; x64'
              : payload.current.os === 'linux'
                ? 'Linux x86_64'
                : payload.current.os === 'android'
                  ? 'Linux armv8l'
                  : 'Mac OS X'

        overload(n, 'oscpu', oscpu)
      }

      /**
       * @link https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints
       */
      switch (payload.current.os) {
        case 'android':
        case 'iOS':
          overload(n, 'maxTouchPoints', n.maxTouchPoints || 10)
          break
      }

      // to test, execute in the console: `console.log(navigator.vendor)`
      switch (payload.current.browser) {
        case 'chrome':
        case 'opera':
        case 'edge': // blink engine
        case 'brave': // blink engine
          overload(n, 'vendor', 'Google Inc.')
          break

        case 'firefox': // gecko engine
          overload(n, 'vendor', '') // firefox always with an empty vendor
          break

        case 'safari': // webkit engine
          overload(n, 'vendor', 'Apple Computer, Inc.')
          break

        default:
          overload(n, 'vendor', undefined)
      }

      // Brave exposes a `navigator.brave` object with an async `isBrave()` method - replicate it when spoofing
      // Brave so that sites relying on it can still detect "Brave"
      if (payload.current.browser === 'brave') {
        overload(
          n,
          'brave',
          Object.freeze({ isBrave: (): Promise<boolean> => Promise.resolve(true) }),
          { force: true, configurable: true }
        )
      }

      /**
       * @link https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData#browser_compatibility
       * @link https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/frame/navigator_ua_data.cc
       */
      switch (payload.current.browser) {
        case 'firefox':
        case 'safari':
          // FireFox and Safari does not support the `userAgentData` property yet
          overload(n, 'userAgentData', undefined, { force: true })
          break

        default:
          // check the `userAgentData` property availability in current (real) browser
          const isAvailable = 'userAgentData' in n && typeof n.userAgentData === 'object'

          // store the original `userAgentData`, or craft a mock object if it does not exist
          const agentDataObject: NavigatorUAData = isAvailable
            ? n.userAgentData
            : {
                brands: [],
                mobile: false,
                platform: '',
                toJSON(): UALowEntropyJSON {
                  return { brands: [], mobile: false, platform: '' }
                },
                getHighEntropyValues(): Promise<UADataValues> {
                  return Promise.resolve({ brands: [], mobile: false, platform: '' })
                },
              }

          // if the real browser does not support the `userAgentData` property, then overload it with the mock object
          // this is necessary to avoid errors during overload the `userAgentData` properties
          if (!isAvailable) {
            overload(n, 'userAgentData', agentDataObject, { force: true, configurable: true })
          }

          // to test, execute in the console: `console.log(navigator.userAgentData.brands)`
          overload(
            n.userAgentData,
            'brands',
            payload.brands.major.map(({ brand, version }) => ({ brand, version }))
          )

          // to test, execute in the console: `console.log(navigator.userAgentData.mobile)`
          overload(n.userAgentData, 'mobile', payload.isMobile)

          // to test, execute in the console: `console.log(navigator.userAgentData.platform)`
          overload(n.userAgentData, 'platform', payload.platform)

          // to test, execute in the console: `console.log(navigator.userAgentData.toJSON())`
          overload(
            n.userAgentData,
            'toJSON',
            new Proxy(agentDataObject.toJSON, {
              apply(target, self, args) {
                return {
                  ...Reflect.apply(target, self, args),
                  brands: payload.brands.major.map(({ brand, version }) => ({ brand, version })),
                  mobile: payload.isMobile,
                  platform: payload.platform,
                }
              },
            })
          )

          // to test, execute in the console: `console.log(await navigator.userAgentData.getHighEntropyValues([...]))`
          overload(
            n.userAgentData,
            'getHighEntropyValues',
            new Proxy(agentDataObject.getHighEntropyValues, {
              apply(target, self, args) {
                return new Promise((resolve: (v: UADataValues) => void, reject: () => void): void => {
                  // get the original high entropy values
                  Reflect.apply(target, self, args)
                    .then((values: UADataValues): void => {
                      const data: DeepWriteable<UADataValues> = {
                        ...values,
                        brands: payload.brands.major.map(({ brand, version }) => ({ brand, version })),
                        fullVersionList: payload.brands.full.map(({ brand, version }) => ({ brand, version })),
                        mobile: payload.isMobile,
                        model: payload.model || '',
                        platform: payload.platform,
                        platformVersion: payload.platformVersion,
                        architecture: payload.architecture,
                        bitness: payload.bitness,
                      }

                      // form factors are opt-in: only override them when configured in the settings, otherwise the
                      // real browser value (from `...values`) passes through
                      if (payload.formFactors.length) {
                        ;(data as unknown as { formFactors: ReadonlyArray<string> }).formFactors = payload.formFactors
                      }

                      if ('uaFullVersion' in values) {
                        data.uaFullVersion = payload.fullVersion || payload.current.version.browser.full
                      }

                      resolve(data)
                    })
                    .catch(reject)
                })
              },
            })
          )
      }
    }

    /** Patches the navigator object for the iframe. */
    const patchNavigatorInIframe = (node: Node): void => {
      if (typeof node !== 'object' || node == null || node.nodeName !== 'IFRAME' || !('contentWindow' in node)) {
        return
      }

      try {
        const iFrame = node as HTMLIFrameElement

        if (typeof iFrame.contentWindow !== 'object' || iFrame.contentWindow == null) {
          return
        }

        const [key, ds, flag] = [__UNIQUE_HEADER_KEY_NAME__.toLowerCase(), iFrame.dataset, 'true']
        if (ds[key] === flag) {
          return // already patched
        }

        ds[key] = flag

        if (iFrame.contentWindow) {
          patchNavigator(iFrame.contentWindow.navigator)
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // An error occurred while patching the navigator object in the iframe
      }
    }

    // Capture the REAL navigator values BEFORE patching. They never leave this closure - they are only used to scrub
    // the real identity back out of any same-origin response body or worker message that echoes it (see the scrubbers).
    const realUserAgent = navigator.userAgent
    const realAppVersion = navigator.appVersion
    const realPlatform = ((): string | undefined => {
      try {
        return navigator.platform
      } catch {
        return undefined
      }
    })()
    const realMajor = ((): string | undefined => {
      const match = realUserAgent.match(/(?:Chrome|Firefox|Version|Edg|OPR)\/(\d+)/i)

      return match ? match[1] : undefined
    })()
    // capture the REAL high-entropy Client Hints (before patching replaces getHighEntropyValues) so a worker that
    // echoes them back to the page (e.g. CreepJS's service worker) can be scrubbed. Resolves long before any message.
    let realClientHints: Record<string, unknown> | undefined
    try {
      const realUAData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData

      if (realUAData && typeof realUAData.getHighEntropyValues === 'function') {
        realUAData
          .getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion'])
          .then((values) => {
            realClientHints = values as unknown as Record<string, unknown>
          })
          .catch(() => undefined)
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) {
      // ignore - the real Client Hints simply will not be scrubbed from worker messages
    }

    // patch the current navigator object
    patchNavigator(navigator)

    // Patch navigator inside Web Workers too. Fingerprinters (e.g. Cloudflare Turnstile) spawn a Worker from a JS
    // blob that reports navigator.platform / userAgent / userAgentData and compare it to the page; if the page is
    // spoofed but the worker is not, the mismatch reveals the spoof (e.g. the host browser's real version leaks in
    // the worker). We prepend a small re-spoofing snippet to the source of JS blobs so any worker built from one
    // reports the same values as the page.
    if (spoofedPlatform) {
      try {
        const workerData = JSON.stringify({
          platform: spoofedPlatform,
          userAgent: spoofedUserAgent,
          appVersion: spoofedAppVersion,
          brands: payload.brands.major.map(({ brand, version }) => ({ brand, version })),
          fullVersionList: payload.brands.full.map(({ brand, version }) => ({ brand, version })),
          mobile: payload.isMobile,
          uaPlatform: payload.platform,
          platformVersion: payload.platformVersion,
          architecture: payload.architecture,
          bitness: payload.bitness,
          model: payload.model || '',
          fullVersion: payload.fullVersion || payload.current.version.browser.full,
          formFactors: payload.formFactors,
        })

        // self-contained snippet (runs inside the worker) that re-applies the navigator overrides
        const workerPatch = `;(function(d){try{var n=self.navigator;var def=function(o,k,v){try{Object.defineProperty(o,k,{get:function(){return v},configurable:true})}catch(e){}};def(n,"platform",d.platform);def(n,"userAgent",d.userAgent);def(n,"appVersion",d.appVersion);var u=n.userAgentData;if(u){def(u,"brands",d.brands);def(u,"mobile",d.mobile);def(u,"platform",d.uaPlatform);var g=u.getHighEntropyValues?u.getHighEntropyValues.bind(u):null;def(u,"getHighEntropyValues",function(h){return (g?g(h):Promise.resolve({})).then(function(v){v=v||{};v.brands=d.brands;v.fullVersionList=d.fullVersionList;v.mobile=d.mobile;v.platform=d.uaPlatform;v.platformVersion=d.platformVersion;v.architecture=d.architecture;v.bitness=d.bitness;v.model=d.model;if("uaFullVersion" in v)v.uaFullVersion=d.fullVersion;if(d.formFactors&&d.formFactors.length)v.formFactors=d.formFactors;return v})})}}catch(e){}})(${workerData});\n`

        // Prepend the patch to the source of JS blobs (only the `Blob` constructor is touched, kept native-looking
        // via a Proxy). When such a blob is then used to spawn a worker - exactly what Cloudflare's Turnstile does -
        // the worker re-applies the navigator overrides before its own code runs, so it reports the spoofed
        // version/platform instead of the host browser's (e.g. CloakBrowser's native one). Cloudflare's own
        // `URL.createObjectURL` and `Worker` are left untouched, so the worker runs from Cloudflare's own `blob:`
        // URL: no new URL, no `worker-src blob:` CSP conflict, and nothing extra to detect.
        const RealBlob = self.Blob

        self.Blob = new Proxy(RealBlob, {
          construct(target, args): object {
            try {
              const parts = args[0]
              const type = String((args[1] as BlobPropertyBag | undefined)?.type || '').toLowerCase()
              const isJavaScriptBlob = type.includes('javascript') || type.includes('ecmascript')
              const looksLikeWorkerSource =
                !type &&
                Array.isArray(parts) &&
                parts.some(
                  (part) =>
                    typeof part === 'string' &&
                    /\b(navigator|postMessage|onmessage|importScripts|addEventListener|WebAssembly)\b/.test(part)
                )

              if (Array.isArray(parts) && (isJavaScriptBlob || looksLikeWorkerSource)) {
                return Reflect.construct(target, [[workerPatch, ...(parts as Array<BlobPart>)], args[1]])
              }
            } catch {
              /* ignore - fall through to an unmodified blob */
            }

            return Reflect.construct(target, args)
          },
        })
      } catch (e) {
        console.warn('💣 RUA: an error occurred while patching the worker navigator', e)
      }
    }

    // Universal defense against "UA echo" leaks (e.g. webbrowsertools.com "[aggressive] UA Header" method). A service
    // worker - which has its OWN navigator we cannot patch, and whose `fetch` event fires BEFORE declarativeNetRequest
    // rewrites headers - replies to a same-origin request with `request.headers.get('user-agent')`, i.e. the REAL user
    // agent. The browser also forbids overriding the `User-Agent` request header from JS, so we cannot change what the
    // worker reads. Instead we scrub the real values out of the response BODY the page receives, so any worker/server
    // that echoes the real user agent only ever exposes the spoofed one. Only bodies that literally contain the real
    // user agent are rewritten, so legitimate data is left untouched. This works against ALL service workers without
    // disabling them.
    if (realUserAgent && realUserAgent !== spoofedUserAgent) {
      try {
        const scrub = (text: string): string => {
          let out = text.split(realUserAgent).join(spoofedUserAgent)

          if (realAppVersion && realAppVersion !== spoofedAppVersion) {
            out = out.split(realAppVersion).join(spoofedAppVersion)
          }

          return out
        }

        const leaks = (text: string): boolean =>
          text.includes(realUserAgent) ||
          (!!realAppVersion && realAppVersion !== spoofedAppVersion && text.includes(realAppVersion))

        const isScrubbable = (resp: Response): boolean => {
          if (resp.type === 'opaque' || resp.type === 'opaqueredirect' || !resp.body || resp.bodyUsed) {
            return false
          }

          const contentType = (resp.headers.get('content-type') || '').toLowerCase()

          if (contentType.includes('event-stream')) {
            return false // never buffer Server-Sent Events (they may never end)
          }

          const length = parseInt(resp.headers.get('content-length') || '0', 10)

          if (length > 512 * 1024) {
            return false // skip large bodies to avoid latency / memory cost
          }

          return contentType === '' || /text|json|xml|javascript|ecmascript|html/.test(contentType)
        }

        const realFetch = self.fetch

        if (typeof realFetch === 'function') {
          self.fetch = new Proxy(realFetch, {
            apply(target, thisArg, args): Promise<Response> {
              const call = Reflect.apply(target, thisArg, args) as Promise<Response>

              return call.then((resp) => {
                try {
                  if (!resp || !isScrubbable(resp)) {
                    return resp
                  }

                  return resp
                    .clone()
                    .text()
                    .then((text) => {
                      if (!text || !leaks(text)) {
                        return resp
                      }

                      const headers = new Headers(resp.headers)
                      headers.delete('content-length') // the scrubbed body length differs

                      const scrubbed = new Response(scrub(text), {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers,
                      })

                      try {
                        Object.defineProperty(scrubbed, 'url', { value: resp.url })
                      } catch {
                        /* `url` is best-effort */
                      }

                      return scrubbed
                    })
                    .catch(() => resp)
                } catch {
                  return resp
                }
              })
            },
          })
        }

        // XHR: the response getters are read-only, so wrap them on the prototype and scrub on read (guarded so only
        // bodies that actually contain the real user agent are rewritten).
        const xhrProto = XMLHttpRequest.prototype
        ;(['responseText', 'response'] as const).forEach((prop) => {
          const descriptor = Object.getOwnPropertyDescriptor(xhrProto, prop)

          if (!descriptor || typeof descriptor.get !== 'function' || !descriptor.configurable) {
            return
          }

          const nativeGet = descriptor.get as () => unknown

          Object.defineProperty(xhrProto, prop, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get(this: XMLHttpRequest): unknown {
              const value = nativeGet.call(this)

              return typeof value === 'string' && leaks(value) ? scrub(value) : value
            },
          })
        })
      } catch (e) {
        console.warn('💣 RUA: an error occurred while installing the UA-echo response scrubber', e)
      }
    }

    // Worker-scope UA leak defense. A service / shared worker we cannot patch reads its OWN (real) navigator and posts
    // the result back to the page (e.g. CreepJS's service worker via a BroadcastChannel). That real user agent / OS
    // mismatches the spoofed page, so CreepJS flags the navigator as a lie. We scrub the real identity out of those
    // messages so every scope matches the page. We patch ONLY the message receivers the page uses - BroadcastChannel
    // and navigator.serviceWorker - kept native-looking, and deliberately do NOT touch `window`, `Worker` or
    // `MessagePort` (the Cloudflare Turnstile iframe talks to its parent via `window` message events and spawns a
    // dedicated worker, both of which must stay untouched; that worker is already re-spoofed by the Blob patch above).
    // Gated to the TOP frame, where fingerprinters collect their worker scopes.
    if (window === window.top && realUserAgent && realUserAgent !== spoofedUserAgent) {
      try {
        const spoofedMajor = String(payload.current.version.browser.major)
        const spoofedClientHints: Readonly<Record<string, string>> = {
          platform: payload.platform,
          platformVersion: payload.platformVersion,
          architecture: payload.architecture,
          bitness: payload.bitness,
          model: payload.model || '',
          uaFullVersion: payload.fullVersion || payload.current.version.browser.full,
        }

        const replaceStrings = (input: string): string => {
          let out = input.split(realUserAgent).join(spoofedUserAgent)

          if (realAppVersion && realAppVersion !== spoofedAppVersion) {
            out = out.split(realAppVersion).join(spoofedAppVersion)
          }

          return out
        }

        // Recursively rebuild a structured-clone message, swapping real identity values for spoofed ones. Returns the
        // SAME reference when nothing changed, so ordinary worker messages are passed through untouched.
        const transform = (value: unknown, key: string, depth: number, budget: { n: number }): unknown => {
          if (depth > 8 || budget.n <= 0) {
            return value
          }

          budget.n--

          if (typeof value === 'string') {
            if (realClientHints && key in spoofedClientHints && value === realClientHints[key]) {
              return spoofedClientHints[key]
            }

            if ((key === 'platform' || key === 'oscpu') && realPlatform && value === realPlatform) {
              return spoofedPlatform ?? value
            }

            let out = replaceStrings(value)

            // brand version strings (e.g. "Google Chrome 149.0.0.0") leak the real major - swap it for the spoofed one
            if (realMajor && realMajor !== spoofedMajor && /brand|version/i.test(key)) {
              out = out.replace(new RegExp(`\\b${realMajor}\\b`, 'g'), spoofedMajor)
            }

            return out
          }

          if (Array.isArray(value)) {
            // userAgentData brand arrays leak the REAL browser brand (e.g. "Google Chrome" while spoofing Edge), which
            // plain string scrubbing can't fix. Replace the whole brand list with the spoofed brands so the worker's
            // userAgentData matches the page (same brands the page reports).
            const isBrandList =
              value.length > 0 &&
              value.every(
                (item) => !!item && typeof item === 'object' && typeof (item as { brand?: unknown }).brand === 'string'
              )

            if (isBrandList && (key === 'brands' || key === 'fullVersionList' || key === 'uaFullVersionList')) {
              return (key === 'brands' ? payload.brands.major : payload.brands.full).map(({ brand, version }) => ({
                brand,
                version,
              }))
            }

            let changed = false
            const next = value.map((item) => {
              const result = transform(item, key, depth + 1, budget)
              changed = changed || result !== item

              return result
            })

            return changed ? next : value
          }

          if (value && typeof value === 'object' && (value.constructor === Object || value.constructor === undefined)) {
            let changed = false
            const next: Record<string, unknown> = {}
            const source = value as Record<string, unknown>

            for (const objectKey of Object.keys(source)) {
              const result = transform(source[objectKey], objectKey, depth + 1, budget)
              changed = changed || result !== source[objectKey]
              next[objectKey] = result
            }

            return changed ? next : value
          }

          return value
        }

        const scrubData = (data: unknown): unknown => transform(data, '', 0, { n: 5_000 })

        const wrapHandler = (handler: (this: unknown, event: MessageEvent) => unknown) =>
          function (this: unknown, event: MessageEvent): unknown {
            try {
              const scrubbed = scrubData(event.data)

              if (scrubbed !== event.data) {
                return handler.call(
                  this,
                  new Proxy(event, {
                    get(target, prop, receiver): unknown {
                      if (prop === 'data') {
                        return scrubbed
                      }

                      const resolved = Reflect.get(target, prop, receiver)

                      return typeof resolved === 'function' ? resolved.bind(target) : resolved
                    },
                  })
                )
              }
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (_) {
              // fall through to the original event
            }

            return handler.call(this, event)
          }

        const wrappedHandlers = new WeakMap<object, (this: unknown, event: MessageEvent) => unknown>()

        const patchMessageTarget = (proto: object | null | undefined): void => {
          if (!proto) {
            return
          }

          try {
            const realAdd = (proto as { addEventListener?: unknown }).addEventListener

            if (typeof realAdd === 'function') {
              ;(proto as { addEventListener: unknown }).addEventListener = new Proxy(realAdd, {
                apply(target, thisArg, args: Array<unknown>): unknown {
                  try {
                    if (args[0] === 'message' && typeof args[1] === 'function') {
                      const original = args[1] as (this: unknown, event: MessageEvent) => unknown
                      let wrapped = wrappedHandlers.get(original)

                      if (!wrapped) {
                        wrapped = wrapHandler(original)
                        wrappedHandlers.set(original, wrapped)
                      }

                      args = [args[0], wrapped, ...args.slice(2)]
                    }
                  } catch {
                    /* use the original arguments */
                  }

                  return Reflect.apply(target, thisArg, args)
                },
              })
            }

            const realRemove = (proto as { removeEventListener?: unknown }).removeEventListener

            if (typeof realRemove === 'function') {
              ;(proto as { removeEventListener: unknown }).removeEventListener = new Proxy(realRemove, {
                apply(target, thisArg, args: Array<unknown>): unknown {
                  try {
                    if (args[0] === 'message' && typeof args[1] === 'function') {
                      const mapped = wrappedHandlers.get(args[1] as object)

                      if (mapped) {
                        args = [args[0], mapped, ...args.slice(2)]
                      }
                    }
                  } catch {
                    /* use the original arguments */
                  }

                  return Reflect.apply(target, thisArg, args)
                },
              })
            }

            const descriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage')

            if (descriptor && descriptor.configurable && typeof descriptor.set === 'function' && descriptor.get) {
              // wrap the native get/set in Proxies of themselves so `toString` stays native; the set Proxy wraps the
              // assigned handler so worker messages are scrubbed
              const proxiedSet = new Proxy(descriptor.set, {
                apply(target, thisArg, args: Array<unknown>): unknown {
                  const handler = args[0]

                  return Reflect.apply(
                    target,
                    thisArg,
                    typeof handler === 'function'
                      ? [wrapHandler(handler as (this: unknown, event: MessageEvent) => unknown), ...args.slice(1)]
                      : args
                  )
                },
              })
              const proxiedGet = new Proxy(descriptor.get, {
                apply(target, thisArg, args): unknown {
                  return Reflect.apply(target, thisArg, args)
                },
              })

              Object.defineProperty(proto, 'onmessage', {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: proxiedGet as () => unknown,
                set: proxiedSet as (v: unknown) => void,
              })
            }
          } catch {
            /* ignore a target we could not patch */
          }
        }

        patchMessageTarget(typeof BroadcastChannel !== 'undefined' ? BroadcastChannel.prototype : null)
        patchMessageTarget(typeof ServiceWorkerContainer !== 'undefined' ? ServiceWorkerContainer.prototype : null)
      } catch (e) {
        console.warn('💣 RUA: an error occurred while installing the worker-message scrubber', e)
      }
    }

    // patch iframes navigators
    {
      // currently existing
      Array(...document.getElementsByTagName('iframe')).forEach(patchNavigatorInIframe)

      // Aggressive detectors (e.g. webbrowsertools.com "iframe navigator.userAgent" / "iframe navigator.appVersion"
      // methods) create a fresh iframe and read `iframe.contentWindow.navigator` (or `contentDocument.defaultView`)
      // directly - sometimes via innerHTML / insertAdjacentHTML, which bypass appendChild/insertBefore/append/prepend.
      // Patch the prototype accessors so the child frame's navigator is spoofed on EVERY access path, closing the
      // iframe leak that ua-parser-js / platform.js would otherwise read the real user agent from.
      const patchedWindows = new WeakSet<Window>()
      const patchWindowNavigator = (win: Window | null): void => {
        try {
          if (win && typeof win === 'object' && !patchedWindows.has(win) && win.navigator) {
            patchedWindows.add(win)
            patchNavigator(win.navigator)
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
          // cross-origin frames are inaccessible from here - nothing leaks from them, so nothing to patch
        }
      }

      const patchIframeAccessor = (prop: 'contentWindow' | 'contentDocument'): void => {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, prop)

          if (!descriptor || typeof descriptor.get !== 'function' || !descriptor.configurable) {
            return
          }

          const nativeGet = descriptor.get

          Object.defineProperty(HTMLIFrameElement.prototype, prop, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get(this: HTMLIFrameElement): Window | Document | null {
              const result = nativeGet.call(this) as Window | Document | null

              if (prop === 'contentWindow') {
                patchWindowNavigator(result as Window | null)
              } else {
                patchWindowNavigator((result as Document | null)?.defaultView ?? null)
              }

              return result
            },
          })
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
          // could not redefine the accessor - fall back to the DOM-method proxies / observer below
        }
      }

      patchIframeAccessor('contentWindow')
      patchIframeAccessor('contentDocument')

      const overloadOpts: Parameters<typeof overload>[3] = { configurable: true, force: true, writable: true }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proxyInvoke = <T extends (...args: readonly any[]) => unknown>(what: T): T =>
        new Proxy(what, {
          apply(target, thisArg, args) {
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect/apply
            const result = Reflect.apply(target, thisArg, args)

            // patch the navigator object in the appended node
            if (Array.isArray(args)) {
              args.forEach((node) => patchNavigatorInIframe(node))
            }

            return result
          },
        })

      // patch the methods that can add new nodes to the DOM
      // TY @Certseeds for the idea (https://github.com/tarampampam/random-user-agent/pull/173)
      overload(Node.prototype, 'appendChild', proxyInvoke(Node.prototype.appendChild), overloadOpts)
      overload(Node.prototype, 'insertBefore', proxyInvoke(Node.prototype.insertBefore), overloadOpts)
      overload(Element.prototype, 'append', proxyInvoke(Element.prototype.append), overloadOpts)
      overload(Element.prototype, 'prepend', proxyInvoke(Element.prototype.prepend), overloadOpts)

      // watch for the new dynamically created iframes
      new MutationObserver((mutations): void => {
        mutations.forEach((mutation): void => mutation.addedNodes.forEach(patchNavigatorInIframe))
      }).observe(document, { childList: true, subtree: true })
    }
  } catch (err) {
    console.warn('💣 RUA: An error occurred in the injected script', err)
  }
})()
