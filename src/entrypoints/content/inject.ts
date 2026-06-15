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
            newAttributes.get = () => value
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

      switch (payload.current.os) {
        case 'windows':
          overload(n, 'oscpu', payload.current.browser === 'firefox' ? 'Windows NT; Win64; x64' : undefined, {
            force: true,
          })
          break

        case 'linux':
          overload(n, 'oscpu', payload.current.browser === 'firefox' ? 'Linux x86_64' : undefined, { force: true })
          break

        case 'android':
          overload(n, 'oscpu', payload.current.browser === 'firefox' ? 'Linux armv8l' : undefined, { force: true })
          break

        case 'macOS':
          overload(n, 'oscpu', payload.current.browser === 'firefox' ? 'Mac OS X' : undefined, { force: true })
          break

        case 'iOS':
          overload(n, 'oscpu', payload.current.browser === 'firefox' ? 'Mac OS X' : undefined, { force: true })
          break

        default:
          overload(n, 'oscpu', undefined, { force: true })
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

    // patch iframes navigators
    {
      // currently existing
      Array(...document.getElementsByTagName('iframe')).forEach(patchNavigatorInIframe)

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
