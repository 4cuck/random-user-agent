import type { ReadonlyUserAgentState } from '~/shared/types'

/**
 * Set the extension icon, depending on the state. Can be limited to a specific tab.
 *
 * @link https://developer.chrome.com/docs/extensions/reference/api/action#method-setIcon
 * @link https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserAction/setIcon
 */
export const setExtensionIcon = async (active: boolean, tabId?: number): Promise<void> => {
  await chrome.action.setIcon({
    path: active
      ? {
          16: '/assets/icons/16.png',
          32: '/assets/icons/32.png',
          48: '/assets/icons/48.png',
          128: '/assets/icons/128.png',
        }
      : {
          16: '/assets/icons/16-gray.png',
          32: '/assets/icons/32-gray.png',
          48: '/assets/icons/48-gray.png',
          128: '/assets/icons/128-gray.png',
        },
    tabId,
  })
}

/**
 * Set the extension icon title. Can be limited to a specific tab.
 *
 * @link https://developer.chrome.com/docs/extensions/reference/api/action#method-setTitle
 * @link https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserAction/setTitle
 */
export const setExtensionTitle = async (title: ReadonlyUserAgentState | string, tabId?: number): Promise<void> => {
  if (typeof title === 'string') {
    return await chrome.action.setTitle({ title, tabId })
  }

  return await chrome.action.setTitle({
    title: [
      ((): string => {
        switch (title.browser) {
          case 'chrome':
            return '🌐 Chrome'
          case 'firefox':
            return '🦊 FireFox'
          case 'opera':
            return '⭕ Opera'
          case 'safari':
            return '🧭 Safari'
          case 'edge':
            return '🛸 Edge'
          case 'brave':
            return '🦁 Brave'
          default:
            return '👻 Browser'
        }
      })(),
      `(v${title.version.browser.major})`,
      ((): string => {
        switch (title.os) {
          case 'windows':
            return '🖥 Windows'
          case 'linux':
            return '🐧 Linux'
          case 'macOS':
            return '🍏 macOS'
          case 'iOS':
            return '🍏 iOS'
          case 'android':
            return '📱 Android'
          default:
            return '🧮 Device'
        }
      })(),
    ].join(' '),
    tabId,
  })
}
