import { describe, expect, test } from 'vitest'
import type { ReadonlyUserAgentState } from '~/shared/types'
import { normalizeUserAgentForJS } from './http-requests'

describe('normalizeUserAgentForJS', () => {
  test('reduces a Chromium browser + under-the-hood version so the header matches navigator.userAgent', () => {
    const ua: ReadonlyUserAgentState = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.115 Safari/537.36 Edg/149.0.4022.69',
      browser: 'edge',
      os: 'windows',
      version: {
        browser: { major: 149, full: '149.0.4022.69' },
        underHood: { major: 149, full: '149.0.7827.115' },
      },
    }

    expect(normalizeUserAgentForJS(ua)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0'
    )
  })

  test('reduces a plain Chrome user agent (the webbrowsertools UA-header vs navigator case)', () => {
    const ua: ReadonlyUserAgentState = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.115 Safari/537.36',
      browser: 'chrome',
      os: 'macOS',
      version: { browser: { major: 149, full: '149.0.7827.115' } },
    }

    expect(normalizeUserAgentForJS(ua)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
    )
  })

  test('leaves non-Chromium (Firefox/Safari) user agents unchanged', () => {
    const firefox: ReadonlyUserAgentState = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0',
      browser: 'firefox',
      os: 'windows',
      version: { browser: { major: 149, full: '149.0' } },
    }

    expect(normalizeUserAgentForJS(firefox)).toBe(firefox.userAgent)
  })
})
