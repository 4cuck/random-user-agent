import RegisteredContentScript = chrome.scripting.RegisteredContentScript

// the common properties for the content scripts
const common: Omit<RegisteredContentScript, 'id'> = {
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_start',
}

// properties for the content script that will be executed in the isolated world (as a content script)
const content: RegisteredContentScript = { ...common, id: 'content', js: ['content.js'] }

// properties for the content script that will be executed in the main world (as an injected script)
const inject: RegisteredContentScript = { ...common, id: 'inject', js: [__UNIQUE_INJECT_FILENAME__] }

/** Register the content scripts */
export async function registerContentScripts() {
  // Registered content scripts persist across service-worker restarts, so on a normal (cold) wake they are already
  // present. Re-registering on every wake is wasteful, and the unregister→register sequence below briefly leaves
  // pages with NO content scripts. So if our scripts are already registered, there is nothing to do.
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts()

    if (existing.some((script) => script.id === content.id)) {
      return
    }
  } catch {
    // ignore - fall through and (re)register below
  }

  // unregister any stale/partial registrations first (no-op on a fresh install)
  try {
    await chrome.scripting.unregisterContentScripts()
  } catch {
    // ignore - nothing to unregister (or a transient error); the registration below is what matters
  }

  try {
    await chrome.scripting.registerContentScripts([
      { ...content, world: 'ISOLATED' },
      { ...inject, world: 'MAIN' },
    ])
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes('unexpected property') &&
      err.message.includes('world')
    ) {
      // if so, it means that the "world" property is not supported by the current browser (FireFox at this moment)
      // so we need to register the content scripts without the "world" property
      //
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript#browser_compatibility
      try {
        await chrome.scripting.registerContentScripts([content])
      } catch {
        // ignore - do not abort the bootstrap on a registration hiccup
      }

      return
    }

    // a concurrent wake may have registered them already - treat a duplicate-id error as success
    if (err instanceof Error && err.message.toLowerCase().includes('duplicate')) {
      return
    }

    // never rethrow: a content-script registration hiccup must not abort the rest of the service-worker bootstrap
    // (which would leave the message/command/alarm listeners unregistered until the user toggles the extension)
    console.warn('🧨 RUA: content script registration failed', err)
  }
}
