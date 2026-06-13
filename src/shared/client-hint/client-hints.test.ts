import { describe, expect, test } from 'vitest'
import { browserBrands, isMobile, operaMobileBrands, platform } from './client-hints'

describe('client hints', () => {
  test('browserBrands', () => {
    // The GREASE brand, version, and ordering follow Chromium's deterministic algorithm seeded by the major version.
    expect(browserBrands('chrome', 98.4)).toStrictEqual([
      { brand: 'Chromium', version: '98' },
      { brand: 'Not_A Brand', version: '24' },
      { brand: 'Google Chrome', version: '98' },
    ])

    expect(browserBrands('chrome', '98.0.0.0')).toStrictEqual([
      { brand: 'Chromium', version: '98.0.0.0' },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
      { brand: 'Google Chrome', version: '98.0.0.0' },
    ])

    // for Opera/Edge the GREASE is seeded by the under-the-hood Chromium major (22 here), not the brand major (11)
    expect(browserBrands('opera', 11, 22)).toStrictEqual([
      { brand: 'Chromium', version: '22' },
      { brand: 'Opera', version: '11' },
      { brand: 'Not A(Brand', version: '99' },
    ])

    expect(browserBrands('opera', '11.1', 22.2)).toStrictEqual([
      { brand: 'Chromium', version: '22' },
      { brand: 'Opera', version: '11.1' },
      { brand: 'Not A(Brand', version: '99.0.0.0' },
    ])

    expect(browserBrands('opera', '11.1', '33.33.33.33')).toStrictEqual([
      { brand: 'Opera', version: '11.1' },
      { brand: 'Not A(Brand', version: '8.0.0.0' },
      { brand: 'Chromium', version: '33.33.33.33' },
    ])

    expect(browserBrands('opera', '11.1', '')).toStrictEqual([
      { brand: 'Opera', version: '11.1' },
      { brand: 'Not A(Brand', version: '24.0.0.0' },
    ])

    // real Opera desktop: Opera 132 on Chromium 148 (GREASE seeded by 148)
    expect(browserBrands('opera', 132, 148)).toStrictEqual([
      { brand: 'Chromium', version: '148' },
      { brand: 'Opera', version: '132' },
      { brand: 'Not/A)Brand', version: '99' },
    ])

    expect(browserBrands('edge', 11, 22)).toStrictEqual([
      { brand: 'Chromium', version: '22' },
      { brand: 'Microsoft Edge', version: '11' },
      { brand: 'Not A(Brand', version: '99' },
    ])

    expect(browserBrands('edge', '11.1', 22.2)).toStrictEqual([
      { brand: 'Chromium', version: '22' },
      { brand: 'Microsoft Edge', version: '11.1' },
      { brand: 'Not A(Brand', version: '99.0.0.0' },
    ])

    // not a number
    expect(browserBrands('edge', 'not-a-version', 'not-a-version')).toStrictEqual([
      { brand: 'Not A(Brand', version: '8.0.0.0' },
      { brand: 'Chromium', version: 'not-a-version' },
      { brand: 'Microsoft Edge', version: 'not-a-version' },
    ])

    // negative number
    expect(browserBrands('edge', -1, -1)).toStrictEqual([
      { brand: 'Not A(Brand', version: '8' },
      { brand: 'Chromium', version: '0' },
      { brand: 'Microsoft Edge', version: '0' },
    ])

    // infinity
    expect(browserBrands('edge', +Infinity, -Infinity)).toStrictEqual([
      { brand: 'Not A(Brand', version: '8' },
      { brand: 'Chromium', version: '0' },
      { brand: 'Microsoft Edge', version: '0' },
    ])

    // Brave (Chromium-based, exposes a "Brave" brand, uses reduced versions and a plain Chrome user agent)
    expect(browserBrands('brave', 149)).toStrictEqual([
      { brand: 'Brave', version: '149' },
      { brand: 'Chromium', version: '149' },
      { brand: 'Not)A;Brand', version: '24' },
    ])

    expect(browserBrands('brave', '149.0.0.0')).toStrictEqual([
      { brand: 'Brave', version: '149.0.0.0' },
      { brand: 'Chromium', version: '149.0.0.0' },
      { brand: 'Not)A;Brand', version: '24.0.0.0' },
    ])
  })

  test('operaMobileBrands', () => {
    // real Opera Mobile: Opera 133, Chromium 148, OperaMobile 99.x - legacy GREASE seeded by Chromium, fixed order
    expect(operaMobileBrands(133, 148, 99)).toStrictEqual([
      { brand: 'Opera', version: '133' },
      { brand: ';Not A Brand', version: '99' },
      { brand: 'Chromium', version: '148' },
      { brand: 'OperaMobile', version: '99' },
    ])

    expect(operaMobileBrands('133.0.5950.0', '148.0.7778.215', '99.2.5094.88935')).toStrictEqual([
      { brand: 'Opera', version: '133.0.5950.0' },
      { brand: ';Not A Brand', version: '99.0.0.0' },
      { brand: 'Chromium', version: '148.0.7778.215' },
      { brand: 'OperaMobile', version: '99.2.5094.88935' },
    ])
  })

  test('platform', () => {
    expect(platform('windows')).toBe('Windows')
    expect(platform('linux')).toBe('Linux')
    expect(platform('macOS')).toBe('macOS')
    expect(platform('iOS')).toBe('iOS')
    expect(platform('android')).toBe('Android')
    expect(platform('unknown')).toBe('Unknown')

    expect(platform('   WiNdOwS ')).toBe('Windows')
    expect(platform('LiNuX   ')).toBe('Linux')
    expect(platform('ios')).toBe('iOS')
  })

  test('isMobile', () => {
    expect(isMobile('iOS')).toBe(true)
    expect(isMobile('android')).toBe(true)
    expect(isMobile('windows')).toBe(false)
    expect(isMobile('linux')).toBe(false)
    expect(isMobile('macOS')).toBe(false)
    expect(isMobile('unknown')).toBe(false)

    expect(isMobile('   WiNdOwS ')).toBe(false)
    expect(isMobile('LiNuX   ')).toBe(false)
    expect(isMobile('ios')).toBe(true)
    expect(isMobile(' aNdRoId ')).toBe(true)
  })
})
