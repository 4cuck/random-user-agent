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

    ds[key] = flag

    setTimeout(() => delete ds[key], 1000) // remove the dataset attribute after 1 second
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

    // CreepJS-resistant navigator spoofing.
    //
    // Instead of redefining getters on `Navigator.prototype` (detected via the clean `Function.prototype.toString`)
    // or adding own properties to the navigator instance (detected by the dedicated navigator/screen
    // "failed undefined properties" check), we REPLACE `window.navigator` with a Proxy over the real navigator. The
    // prototype keeps its native getters and the instance reports no own properties, so a fingerprinter (e.g. CreepJS,
    // see its src/lies) cannot flag the spoof as a "lie", yet every read returns the spoofed value.
    const spoofedNavigatorWindows = new WeakSet<object>()

    const spoofedVendor = ((): string | undefined => {
      switch (payload.current.browser) {
        case 'chrome':
        case 'opera':
        case 'edge':
        case 'brave':
          return 'Google Inc.'
        case 'firefox':
          return '' // firefox always with an empty vendor
        case 'safari':
          return 'Apple Computer, Inc.'
      }

      return undefined
    })()

    const spoofedOscpu = ((): string | undefined => {
      if (payload.current.browser !== 'firefox') {
        return undefined // only firefox exposes navigator.oscpu
      }

      switch (payload.current.os) {
        case 'windows':
          return 'Windows NT; Win64; x64'
        case 'linux':
          return 'Linux x86_64'
        case 'android':
          return 'Linux armv8l'
        default:
          return 'Mac OS X'
      }
    })()

    const isMobileOS = payload.current.os === 'android' || payload.current.os === 'iOS'

    /** Builds the spoofed `userAgentData` object (undefined for firefox / safari), wrapping the real one. */
    const buildSpoofedUserAgentData = (realNav: Navigator): NavigatorUAData | undefined => {
      if (payload.current.browser === 'firefox' || payload.current.browser === 'safari') {
        return undefined
      }

      const realUAData = (realNav as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
      const majorBrands = (): Array<{ brand: string; version: string }> =>
        payload.brands.major.map(({ brand, version }) => ({ brand, version }))
      const fullBrands = (): Array<{ brand: string; version: string }> =>
        payload.brands.full.map(({ brand, version }) => ({ brand, version }))
      const toJSON = (): UALowEntropyJSON => ({
        brands: majorBrands(),
        mobile: payload.isMobile,
        platform: payload.platform,
      })
      const merge = (values: Partial<UADataValues>): UADataValues => {
        const data: DeepWriteable<UADataValues> = {
          ...values,
          brands: majorBrands(),
          fullVersionList: fullBrands(),
          mobile: payload.isMobile,
          model: payload.model || '',
          platform: payload.platform,
          platformVersion: payload.platformVersion,
          architecture: payload.architecture,
          bitness: payload.bitness,
        }

        if (payload.formFactors.length) {
          ;(data as unknown as { formFactors: ReadonlyArray<string> }).formFactors = payload.formFactors
        }

        if (values && 'uaFullVersion' in values) {
          data.uaFullVersion = payload.fullVersion || payload.current.version.browser.full
        }

        return data
      }
      const getHighEntropyValues = (hints?: ReadonlyArray<string>): Promise<UADataValues> => {
        const realGetter =
          realUAData && typeof realUAData.getHighEntropyValues === 'function'
            ? realUAData.getHighEntropyValues.bind(realUAData)
            : undefined

        return (realGetter ? realGetter([...(hints ?? [])]) : Promise.resolve({} as UADataValues))
          .then((values) => merge(values || {}))
          .catch(() => merge({}))
      }

      const overrides: Record<string, unknown> = {
        brands: majorBrands(),
        mobile: payload.isMobile,
        platform: payload.platform,
        toJSON,
        getHighEntropyValues,
      }

      if (realUAData) {
        const cache = new Map<PropertyKey, unknown>()

        return new Proxy(realUAData, {
          get(target, prop) {
            if (typeof prop === 'string' && prop in overrides) {
              return overrides[prop]
            }

            const value = (target as unknown as Record<PropertyKey, unknown>)[prop]

            if (typeof value === 'function') {
              if (!cache.has(prop)) {
                cache.set(prop, (value as (...args: ReadonlyArray<unknown>) => unknown).bind(target))
              }

              return cache.get(prop)
            }

            return value
          },
        })
      }

      return overrides as unknown as NavigatorUAData
    }

    /** Replaces a window's `navigator` with a spoofed Proxy (leaving `Navigator.prototype` native and untouched). */
    const spoofWindowNavigator = (win: Window | null): void => {
      try {
        if (!win || spoofedNavigatorWindows.has(win)) {
          return
        }

        const realNav = win.navigator

        if (!realNav || typeof realNav !== 'object' || !('userAgent' in realNav)) {
          return
        }

        spoofedNavigatorWindows.add(win)

        const spoofedUAData = buildSpoofedUserAgentData(realNav)
        const hideUserAgentData = payload.current.browser === 'firefox' || payload.current.browser === 'safari'

        // value overrides (read via the Proxy's `get` trap; never written to the prototype or instance)
        const overrides: Record<string, () => unknown> = {
          userAgent: () => spoofedUserAgent,
          appVersion: () => spoofedAppVersion,
          vendor: () => spoofedVendor,
          userAgentData: () => spoofedUAData,
        }

        if (spoofedPlatform) {
          overrides.platform = () => spoofedPlatform
        }

        if (spoofedOscpu !== undefined) {
          overrides.oscpu = () => spoofedOscpu
        }

        if (isMobileOS) {
          overrides.maxTouchPoints = () => realNav.maxTouchPoints || 10
        }

        if (payload.current.browser === 'brave') {
          overrides.brave = () => Object.freeze({ isBrave: (): Promise<boolean> => Promise.resolve(true) })
        }

        // properties to report as present even if the real navigator lacks them (e.g. oscpu / brave on Chromium)
        const present = new Set<string>()
        if (spoofedOscpu !== undefined) present.add('oscpu')
        if (payload.current.browser === 'brave') present.add('brave')

        // properties to report as absent (userAgentData when spoofing firefox / safari)
        const hidden = new Set<string>()
        if (hideUserAgentData) hidden.add('userAgentData')

        const methodCache = new Map<PropertyKey, unknown>()

        const proxy = new Proxy(realNav, {
          get(target, prop) {
            if (typeof prop === 'string') {
              if (hidden.has(prop)) {
                return undefined
              }

              const override = overrides[prop]

              if (override) {
                return override()
              }
            }

            // read through the REAL navigator (receiver = target) so prototype getters such as serviceWorker,
            // mediaDevices, permissions, etc. work; bind + cache methods so their identity stays stable
            const value = (target as unknown as Record<PropertyKey, unknown>)[prop]

            if (typeof value === 'function') {
              if (!methodCache.has(prop)) {
                methodCache.set(prop, (value as (...args: ReadonlyArray<unknown>) => unknown).bind(target))
              }

              return methodCache.get(prop)
            }

            return value
          },
          has(target, prop) {
            if (typeof prop === 'string') {
              if (hidden.has(prop)) {
                return false
              }

              if (present.has(prop)) {
                return true
              }
            }

            return Reflect.has(target, prop)
          },
          getOwnPropertyDescriptor(target, prop) {
            // navigator properties live on the prototype, so the instance must report no own descriptors (mirrors real)
            return Reflect.getOwnPropertyDescriptor(target, prop)
          },
          getPrototypeOf(target) {
            return Reflect.getPrototypeOf(target)
          },
        })

        Object.defineProperty(win, 'navigator', { configurable: true, get: () => proxy })
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // a window we could not spoof (e.g. cross-origin) - leave it untouched
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

        // replace the iframe window's navigator with the spoofed Proxy (idempotent via the WeakSet guard inside)
        spoofWindowNavigator(iFrame.contentWindow)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // An error occurred while patching the navigator object in the iframe
      }
    }

    // Capture the REAL navigator values BEFORE patching. They never leave this closure - they are only used to scrub
    // the real values back out of any response body / worker message that echoes them (see the scrubbers below).
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
    // capture the REAL high-entropy Client Hints (before patching replaces getHighEntropyValues), so a worker that
    // echoes them back to the page (e.g. CreepJS) can be scrubbed. Resolves long before any worker message arrives.
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

    // replace the page's navigator with the spoofed Proxy
    spoofWindowNavigator(window)

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

    // Universal defense against worker-scope UA leaks (e.g. CreepJS, which reads navigator inside a service / shared /
    // dedicated worker loaded from a script URL and posts it back to the page to reveal the real user agent + OS). We
    // cannot patch a script-URL worker's own navigator, but every worker reports its result to the page via a `message`
    // event, so we scrub the real values out of that message - covering ALL worker types, CSP-safe, without breaking
    // workers. Messages that do not contain a real value are passed through untouched.
    if (realUserAgent && realUserAgent !== spoofedUserAgent) {
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

        // Recursively rebuild a structured-clone message, swapping real identity values for the spoofed ones. Returns
        // the SAME reference when nothing changed, so ordinary worker messages are passed through untouched.
        const transform = (value: unknown, key: string, depth: number, budget: { n: number }): unknown => {
          if (depth > 8 || budget.n <= 0) {
            return value
          }

          budget.n--

          if (typeof value === 'string') {
            // exact-match Client Hints fields first (short values like "64" are only swapped when the key matches)
            if (realClientHints && key in spoofedClientHints && value === realClientHints[key]) {
              return spoofedClientHints[key]
            }

            if ((key === 'platform' || key === 'oscpu') && realPlatform && value === realPlatform) {
              return spoofedPlatform ?? value
            }

            let out = replaceStrings(value)

            // brand version strings (e.g. "Google Chrome 142.0.0.0") leak the real major - swap it for the spoofed one
            if (realMajor && realMajor !== spoofedMajor && /brand|version/i.test(key)) {
              out = out.replace(new RegExp(`\\b${realMajor}\\b`, 'g'), spoofedMajor)
            }

            return out
          }

          if (Array.isArray(value)) {
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

            if (descriptor && descriptor.configurable && typeof descriptor.set === 'function') {
              const realSet = descriptor.set
              const realGet = descriptor.get

              Object.defineProperty(proto, 'onmessage', {
                configurable: true,
                enumerable: descriptor.enumerable,
                get(this: object): unknown {
                  return realGet ? realGet.call(this) : undefined
                },
                set(this: object, handler: unknown): void {
                  realSet.call(
                    this,
                    typeof handler === 'function'
                      ? wrapHandler(handler as (this: unknown, event: MessageEvent) => unknown)
                      : handler
                  )
                },
              })
            }
          } catch {
            /* ignore a target we could not patch */
          }
        }

        // Only scrub SERVICE worker messages (CreepJS's primary worker scope). We deliberately do NOT tamper
        // `Worker.prototype` or `MessagePort.prototype`: Cloudflare Turnstile spawns a dedicated blob Worker and is
        // extremely sensitive to any Worker / MessageChannel tampering, and the Blob patch above already re-spoofs that
        // worker's navigator from the inside - so scrubbing dedicated/shared worker messages is unnecessary here and
        // only broke the Turnstile challenge. Service workers (which Turnstile does not use) are still scrubbed.
        patchMessageTarget(typeof ServiceWorkerContainer !== 'undefined' ? ServiceWorkerContainer.prototype : null)
      } catch (e) {
        console.warn('💣 RUA: an error occurred while installing the worker-message scrubber', e)
      }
    }

    // spoof navigators of iframes
    {
      // currently existing iframes
      Array(...document.getElementsByTagName('iframe')).forEach(patchNavigatorInIframe)

      // Spoof an iframe's navigator synchronously on access - even for a sandboxed ("allow-same-origin" without
      // "allow-scripts") iframe where NO script can run inside it to self-spoof (e.g. the webbrowsertools.com
      // "[aggressive] iframe navigator.userAgent" method). The only way to reach such a frame is from the parent via
      // `contentWindow` / `contentDocument`, so we wrap those getters - but in a Proxy of the NATIVE getter, not a
      // plain function. `Function.prototype.toString` forwards to the native source, and the getter is otherwise
      // indistinguishable from native, so it passes a fingerprinter's prototype-lie checks (verified against CreepJS's
      // src/lies: known-native toString, descriptor keys = length,name, no own arguments/caller/prototype, valid
      // proxy stack, and the advanced proxy probes that only run once Function.toString / Permissions.query lie).
      const patchIframeAccessor = (prop: 'contentWindow' | 'contentDocument'): void => {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, prop)

          if (!descriptor || typeof descriptor.get !== 'function' || !descriptor.configurable) {
            return
          }

          const proxiedGet = new Proxy(descriptor.get, {
            apply(target, thisArg, args): unknown {
              const result = Reflect.apply(target, thisArg, args)

              try {
                if (prop === 'contentWindow') {
                  spoofWindowNavigator(result as Window | null)
                } else {
                  spoofWindowNavigator((result as Document | null)?.defaultView ?? null)
                }
              } catch {
                /* cross-origin frame - inaccessible, nothing to spoof */
              }

              return result
            },
          })

          Object.defineProperty(HTMLIFrameElement.prototype, prop, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: proxiedGet as () => Window | Document | null,
            set: descriptor.set,
          })
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
          // could not redefine the accessor - the MutationObserver below still patches added iframes
        }
      }

      patchIframeAccessor('contentWindow')
      patchIframeAccessor('contentDocument')

      // watch for dynamically created iframes (a passive observer is not detectable as a prototype lie)
      new MutationObserver((mutations): void => {
        mutations.forEach((mutation): void => mutation.addedNodes.forEach(patchNavigatorInIframe))
      }).observe(document, { childList: true, subtree: true })
    }
  } catch (err) {
    console.warn('💣 RUA: An error occurred in the injected script', err)
  }
})()
