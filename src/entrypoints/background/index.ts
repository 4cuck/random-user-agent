import { canonizeDomain, checkPermissions, detectBrowser, watchPermissionsChange } from '~/shared'
import { type HandlersMap, listen as listenRuntime } from '~/shared/messaging'
import { isApplicableForDomain, reloadRequestHeaders, renewUserAgent, updateRemoteUserAgentList } from './api'
import { highEntropyClientHintHeaders, registerContentScripts, unsetRequestHeaders } from './hooks'
import { registerHotkeys } from './hotkeys'
import {
  AcceptClientHints,
  CurrentUserAgent,
  RemoteUserAgentList,
  Settings,
  StorageArea,
  LatestBrowserVersions,
} from './persistent'
import { Timer, alarmHandlers } from './timer'
import { setExtensionIcon, setExtensionTitle } from './ui'

/** Debug logging */
const debug = (msg: string, ...args: Array<unknown>): void => console.debug(`%c😈 ${msg}`, 'font-weight:bold', ...args)
/** Convert milliseconds to seconds */
const m2s = (millis: number): number => Math.round(millis / 1000)
/** The high-entropy Client Hint header names (lowercased), used to filter `Accept-CH` directives. */
const highEntropyHintSet: ReadonlySet<string> = new Set(highEntropyClientHintHeaders.map((h) => h.toLowerCase()))

// ── MV3 listener registration ───────────────────────────────────────────────────────────────────────────────────
// In Manifest V3 the service worker is torn down when idle and RE-EVALUATED on every event (message, command, alarm,
// ...). Event listeners must be added SYNCHRONOUSLY during this top-level evaluation - a listener added later (after
// an `await`, as the bootstrap below used to do) is not present when Chrome dispatches the very event that woke the
// worker, so that event is dropped. That is the root cause of "the popup is dead until I toggle the extension off/on".
//
// The listener bodies need state that is built asynchronously in the bootstrap, so they await this readiness gate
// (which is opened once the bootstrap has wired everything up) before dispatching.
let api: HandlersMap | undefined
let resolveReady!: () => void
const ready: Promise<void> = new Promise((resolve) => {
  resolveReady = resolve
})

/** Resolves with the handler map once the bootstrap is ready (throws if the bootstrap failed before it was built). */
const whenReady = async (): Promise<HandlersMap> => {
  await ready

  if (!api) {
    throw new Error('background service worker failed to initialize')
  }

  return api
}

// messages from the popup / options / onboarding / content scripts (the entire UI talks to the background via this)
listenRuntime({
  ping: (...args) => args,
  version: () => chrome.runtime.getManifest().version,
  currentUserAgent: async () => (await whenReady()).currentUserAgent(),
  renewUserAgent: async () => (await whenReady()).renewUserAgent(),
  settings: async () => (await whenReady()).settings(),
  updateSettings: async (upd) => (await whenReady()).updateSettings(upd),
  isApplicableForDomain: async (domain) => (await whenReady()).isApplicableForDomain(domain),
  updateRemoteListNow: async (clear) => (await whenReady()).updateRemoteListNow(clear),
  delegateClientHints: async (delegations) => (await whenReady()).delegateClientHints(delegations),
})

// keyboard shortcuts (e.g. Ctrl+Shift+U to renew the user-agent)
registerHotkeys({
  renewUserAgent: async () => {
    await (await whenReady()).renewUserAgent()
  },
})

// a single dispatcher for all alarms, routed through the timer registry (each Timer registers its handler there)
chrome.alarms.onAlarm.addListener((alarm): void => {
  void (async (): Promise<void> => {
    await ready

    alarmHandlers.get(alarm.name)?.()
  })()
})

// renew the user-agent on a REAL browser startup (not on every service-worker wake) when the user opted in
chrome.runtime.onStartup?.addListener((): void => {
  void (async (): Promise<void> => {
    try {
      const handlers = await whenReady()

      if ((await handlers.settings()).renew.onStartup) {
        await handlers.renewUserAgent()
      }
    } catch (err) {
      debug('on-startup renew error', err)
    }
  })()
})

// run the background script
;(async () => {
  // register the content scripts
  await registerContentScripts()

  // detect the host OS
  const hostOS = (await chrome.runtime.getPlatformInfo()).os

  // at least FireFox does not allow the extension to work with all URLs by default, and the user must grant the
  // necessary permissions. in addition, the user can revoke the permissions at any time, so we need to monitor the
  // changes in the permissions and open the onboarding page if the necessary permissions are missing
  watchPermissionsChange(async () => await checkPermissions(true))

  // if the permissions are not granted, we open the onboarding page to explain the situation to the user
  await checkPermissions(true)

  // settings are stored in the 'sync' storage area because they need to be synchronized between different devices,
  // and only if the 'sync' storage area is not available, we use the 'local' storage area
  const settings = new Settings(new StorageArea('settings-struct-v3', 'sync', 'local'), detectBrowser())
  const initSettings = await settings.get()
  debug('settings', initSettings)

  // for the current user-agent, we need to use the 'local' storage area because it supports much more frequent
  // updates and does not require synchronization between devices. do not use the 'sync' storage area for this purpose
  const currentUserAgent = new CurrentUserAgent(new StorageArea('useragent-state', 'local'))
  debug('current user-agent', await currentUserAgent.get())

  // remote user-agent list is used to store the list, fetched from the remote server. it uses the local storage area
  // because it does not require synchronization between devices
  const remoteUserAgentList = new RemoteUserAgentList(new StorageArea('useragent-remote-list', 'local'))
  debug('remote user-agent list', await remoteUserAgentList.get(false))

  // the latest browser versions are stored in the 'local' storage area because they do not require synchronization
  // between devices. the data is updated automatically
  const latestBrowserVersions = new LatestBrowserVersions(new StorageArea('latest-browser-versions', 'local'))
  debug('initial latest browser versions', ...(await latestBrowserVersions.get()))

  // tracks which origins opted into high-entropy Client Hints via the Accept-CH response header (see the
  // webRequest listener below), so those hints are only sent to servers that requested them - like a real browser
  const acceptClientHints = new AcceptClientHints()

  // handlers is a map of functions that can be called from the popup or content scripts (and not only from them).
  // think about them as a kind of API for the extension
  const handlers: HandlersMap = {
    ping: (...args) => args,
    version: () => chrome.runtime.getManifest().version,
    currentUserAgent: async () => (await currentUserAgent.get())?.userAgent,
    renewUserAgent: async () => {
      const gen = await renewUserAgent(settings, currentUserAgent, remoteUserAgentList, hostOS, latestBrowserVersions)
      return gen.new?.userAgent ?? ''
    },
    settings: async () => settings.get(),
    updateSettings: async (part) => (await settings.update(part)) && settings.get(),
    isApplicableForDomain: async (domain) => isApplicableForDomain(await settings.get(), domain),
    updateRemoteListNow: async (clear) => await updateRemoteUserAgentList(remoteUserAgentList, clear),
    delegateClientHints: async (delegations) => {
      // canonicalize the delegated target hostnames so they match the DNR rule / blacklist comparisons
      const canonical: Record<string, ReadonlyArray<string>> = {}

      for (const [host, hints] of Object.entries(delegations ?? {})) {
        try {
          const canon = canonizeDomain(host)

          if (canon) {
            canonical[canon] = hints
          }
        } catch {
          // ignore invalid hostnames
        }
      }

      // rebuild the header rules only if a new delegation was actually recorded
      if (await acceptClientHints.delegate(canonical)) {
        const s = await settings.get()

        if (s.enabled) {
          await reloadRequestHeaders(s, await currentUserAgent.get(), await acceptClientHints.getAll())
        }
      }
    },
  }

  // publish the handler map so the synchronously-registered listeners above can dispatch into it. Do this BEFORE the
  // remaining (timer / network / rule) setup so the UI keeps working even if a later step fails; the readiness gate
  // itself is opened only at the very end, once everything is wired up.
  api = handlers

  // create a timer to renew the user-agent automatically
  const userAgentRenewTimer = new Timer('renew-user-agent', m2s(initSettings.renew.intervalMillis), async () => {
    await renewUserAgent(settings, currentUserAgent, remoteUserAgentList, hostOS, latestBrowserVersions)
    debug('user-agent was renewed automatically', await currentUserAgent.get())
  })

  // create a timer to update the remote user-agents list automatically
  const remoteListUpdateTimer = new Timer(
    'update-remote-list',
    m2s(initSettings.remoteUseragentList.updateIntervalMillis),
    async () => {
      await remoteUserAgentList.update()
      debug('remote user-agent list updated automatically', await remoteUserAgentList.get(false))
    }
  )

  // create a timer to update the latest browser versions automatically (once in 6 hours)
  const latestBrowserVersionsTimer = new Timer('update-latest-browser-versions', 60 * 60 * 6, async () => {
    await latestBrowserVersions.update()
    debug('latest browser versions updated automatically', latestBrowserVersions.get())
  })

  // on current user-agent changes, save it to the storage area, and update the browser request headers
  currentUserAgent.onChange(async (c) => {
    debug('current user-agent was changed', c)

    // update the extension title with the current user-agent information
    await setExtensionTitle(c)

    // reload the request headers with the new user-agent information
    const reloaded = await reloadRequestHeaders(
      await settings.get(),
      await currentUserAgent.get(),
      await acceptClientHints.getAll()
    )
    debug('the request header rules have been ' + (reloaded ? 'set' : 'unset'), reloaded)
  })

  settings.onChange(async (s) => {
    debug('settings were changed', s)

    if (s.enabled) {
      // 🌝 if the extension is enabled, we need to enable required features

      // 🚀 automatic user-agent renewal
      if (s.renew.enabled) {
        // update the user-agent renewal timer on changes, if needed
        if (m2s(s.renew.intervalMillis) !== userAgentRenewTimer.getIntervalSec) {
          await userAgentRenewTimer.changeInterval(m2s(s.renew.intervalMillis))
        }

        // start the renewal timer if it's not started yet
        if (!userAgentRenewTimer.isStarted) {
          await userAgentRenewTimer.start()
        }
      } else {
        // stop the renewal timer if the extension is enabled, but the user-agent renewal is disabled
        await userAgentRenewTimer.stop()
      }

      // 🚀 remote user-agent list
      if (s.remoteUseragentList.enabled) {
        const intervalSec = m2s(s.remoteUseragentList.updateIntervalMillis)

        // update the remote user-agents list update timer on changes, if needed
        if (intervalSec !== remoteListUpdateTimer.getIntervalSec) {
          if (intervalSec > 0) {
            await remoteListUpdateTimer.changeInterval(intervalSec)
          } else {
            await remoteListUpdateTimer.stop()
          }
        }

        if (!remoteListUpdateTimer.isStarted && s.remoteUseragentList.updateIntervalMillis > 0) {
          await remoteListUpdateTimer.start()
        }
      } else {
        await remoteListUpdateTimer.stop()
      }

      // 🚀 update the browser request headers with the current user-agent information
      const reloaded = await reloadRequestHeaders(
        await settings.get(),
        await currentUserAgent.get(),
        await acceptClientHints.getAll()
      )
      debug('the request header rules have been ' + (reloaded ? 'set' : 'unset'), reloaded)

      // 🚀 automatic latest browser versions update (opt-in, off by default - it makes third-party network requests)
      if (s.generator.autoUpdateVersions) {
        // start the timer (and do an immediate update) only when it is not running yet
        if (!latestBrowserVersionsTimer.isStarted) {
          latestBrowserVersions.update().catch((err) => debug('latest browser versions update error', err))

          await latestBrowserVersionsTimer.start()
        }
      } else {
        await latestBrowserVersionsTimer.stop()
      }
    } else {
      // 🌚 otherwise, if the extension is disabled, we need to disable everything
      await Promise.allSettled([
        // disable headers replacement
        unsetRequestHeaders(),
        // disable the user-agent renewal timer
        userAgentRenewTimer.stop(),
        // disable the remote user-agents list update timer
        remoteListUpdateTimer.stop(),
        // disable the latest browser versions update timer
        latestBrowserVersionsTimer.stop(),
      ])

      debug('all features have been disabled')
    }

    // 🚀 update the remote user-agents list URI on changes, if needed
    if (remoteUserAgentList.url?.toString() !== s.remoteUseragentList.uri) {
      if (remoteUserAgentList.setUrl(s.remoteUseragentList.uri)) {
        // note: we do not await the result because we do not want to block the execution
        remoteUserAgentList.update().catch((err) => debug('remote user-agent list update error', err))

        if (s.remoteUseragentList.updateIntervalMillis > 0) {
          await remoteListUpdateTimer.restart()
        }
      }
    }

    // update the extension icon state
    await setExtensionIcon(s.enabled)
  })

  // observe (read-only) the Accept-CH / Critical-CH response headers so high-entropy Client Hints are only spoofed
  // for origins that actually requested them - a real browser never sends high-entropy hints to a server that did
  // not opt in. Only responses that (re)declare these headers change the opt-in state, so everything else is a
  // cheap no-op.
  if (chrome.webRequest?.onHeadersReceived) {
    chrome.webRequest.onHeadersReceived.addListener(
      (details) => {
        const headers = details.responseHeaders

        if (!headers) {
          return undefined
        }

        // a real browser opts in via Accept-CH and may force an immediate retry via Critical-CH - honor both
        const accept = headers.find((h) => h.name.toLowerCase() === 'accept-ch')
        const critical = headers.find((h) => h.name.toLowerCase() === 'critical-ch')

        if (!accept && !critical) {
          return undefined
        }

        void (async (): Promise<void> => {
          let origin: string

          try {
            origin = canonizeDomain(new URL(details.url).hostname)
          } catch {
            return // ignore non-parseable URLs
          }

          const parse = (value: string | undefined): Array<string> =>
            (value ?? '')
              .split(',')
              .map((token) => token.trim().toLowerCase())
              .filter((token) => highEntropyHintSet.has(token))

          const requested = [...new Set([...parse(accept?.value), ...parse(critical?.value)])]

          // rebuild the header rules only when the origin's opted-in hint set actually changed
          if (await acceptClientHints.remember(origin, requested)) {
            const s = await settings.get()

            if (s.enabled) {
              await reloadRequestHeaders(s, await currentUserAgent.get(), await acceptClientHints.getAll())
            }
          }
        })()

        return undefined
      },
      { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] },
      ['responseHeaders']
    )
  }

  // configure the remote user-agent list service
  if (initSettings.remoteUseragentList.enabled) {
    if (initSettings.remoteUseragentList.uri) {
      if (remoteUserAgentList.setUrl(initSettings.remoteUseragentList.uri)) {
        // note: we do not await the result because we do not want to block the execution
        remoteUserAgentList.update().catch((err) => debug('remote user-agent list update error', err))

        if (initSettings.remoteUseragentList.updateIntervalMillis > 0) {
          await remoteListUpdateTimer.start()
        }
      }
    }
  }

  // generate the INITIAL user-agent only when none is stored yet (first run). The previous `renew.onStartup ||`
  // condition regenerated it on EVERY service-worker wake (not just at browser startup), churning the user-agent and
  // the request-header rules constantly - a source of erratic behaviour. Real browser-startup renewal is handled by
  // the chrome.runtime.onStartup listener registered synchronously above.
  if (!(await currentUserAgent.get())) {
    await renewUserAgent(settings, currentUserAgent, remoteUserAgentList, hostOS, latestBrowserVersions)
  }

  // start the renewal timer on startup, if the extension and this feature are enabled
  if (initSettings.enabled && initSettings.renew.enabled) {
    await userAgentRenewTimer.start()
  }

  // start the latest browser versions update timer on startup, if the extension is enabled and the user opted in
  // (this feature is off by default because it makes periodic network requests to third-party services)
  if (initSettings.enabled && initSettings.generator.autoUpdateVersions) {
    // initial update of the latest browser versions
    latestBrowserVersions.update().catch((err) => debug('latest browser versions update error', err))

    await latestBrowserVersionsTimer.start()
  }

  // ensure the request-header (declarativeNetRequest) rules reflect the persisted settings + user-agent on every
  // startup. These rules persist across restarts, but previously they were also re-applied as a side effect of the
  // on-startup renewal we no longer perform on every wake - so re-assert them explicitly to guarantee spoofing is
  // active after a cold start.
  await reloadRequestHeaders(initSettings, await currentUserAgent.get(), await acceptClientHints.getAll()).catch(
    (err: unknown): void => debug('request header rules error on startup', err)
  )

  // set the extension icon state on startup
  await setExtensionIcon(initSettings.enabled)

  // everything is wired up: open the readiness gate so the synchronously-registered listeners start dispatching
  // (note: the onMessage and onCommand listeners are registered at top-level evaluation, NOT here, so they survive
  // a cold wake; see the top of this file)
  resolveReady()
})().catch((error: unknown): void => {
  // never leave the readiness gate closed - the synchronously-registered listeners must still respond (with whatever
  // state was published) instead of hanging, and an init failure must not surface as an unhandled rejection
  debug('bootstrap error', error)
  resolveReady()
})
