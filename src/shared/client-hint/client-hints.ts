type Brand = { readonly brand: string; readonly version: string }

/**
 * Browser Client Hints provide information about the browser to the server through HTTP headers, which is then
 * exposed in the JavaScript environment. While it doesn't contain extensive user-specific information, it's
 * better to mask or replace the real browser name and version for privacy reasons.
 *
 * For example, the `Sec-CH-UA` header can be used to provide information about the browser engine and version.
 * The syntax of the header is as follows: `Sec-CH-UA: "<brand>";v="<significant version>", ...`. Here, `<brand>`
 * represents a brand associated with the user agent, such as "Chromium", "Google Chrome", or an intentionally
 * incorrect brand like "Not A;Brand". `<significant version>` is the "marketing" version number associated with
 * distinguishable web-exposed features.
 *
 * Real Example of the `Sec-CH-UA` Header (Google Chrome v123.0.6312.86):
 *
 * ```
 * Sec-Ch-Ua: "Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"
 * ```
 *
 * The same data is exposed in `navigator.userAgentData.getHighEntropyValues()` method. Executing this snippet on
 * any Chromium-based browser provides the same information as in the `Sec-CH-UA` header:
 *
 * ```javascript
 * JSON.stringify(await navigator.userAgentData.getHighEntropyValues(["brands"]))
 * ```
 *
 * This returns a JSON object with the following structure:
 *
 * ```json
 * {"brands":[
 *   {"brand":"Google Chrome","version":"123"},
 *   {"brand":"Not:A-Brand","version":"8"},
 *   {"brand":"Chromium","version":"123"}
 * ],"mobile":false,"platform":"Linux"}
 * ```
 *
 * Some more examples of the `Sec-CH-UA` header:
 *
 * - `"(Not(A:Brand";v="8", "Chromium";v="98"` (Chromium)
 * - `" Not A;Brand";v="99", "Chromium";v="96", "Google Chrome";v="96"` (Google Chrome)
 * - `" Not A;Brand";v="99", "Chromium";v="96", "Microsoft Edge";v="96"` (Microsoft Edge)
 * - `"Opera";v="81", " Not;A Brand";v="99", "Chromium";v="95"` (Opera)
 *
 * Note: not all browsers support client hints, you can check the support status here:
 * https://caniuse.com/?search=Sec-CH-UA (that's why we limit the support to Chromium-based browsers only at the
 * moment).
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Full-Version-List
 * @link https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues#brands
 */
export const browserBrands: {
  (browser: 'chrome', version: string | number, underHoodVersion?: never): ReadonlyArray<Brand>
  (browser: 'opera', version: string | number, underHoodVersion: string | number): ReadonlyArray<Brand>
  (browser: 'edge', version: string | number, underHoodVersion: string | number): ReadonlyArray<Brand>
  (browser: 'brave', version: string | number, underHoodVersion?: never): ReadonlyArray<Brand>
} = (
  browser: 'chrome' | 'opera' | 'edge' | 'brave',
  version: string | number,
  underHoodVersion?: string | number
): ReadonlyArray<Brand> => {
  // when a string version is passed we build the "full version" list (e.g. for Sec-CH-UA-Full-Version-List),
  // otherwise (a number) we build the "significant/major version" list (e.g. for Sec-CH-UA)
  const isFull = typeof version === 'string'

  const extractMajor = (full: string | number): string => {
    if (typeof full !== 'string') {
      return Math.max(Math.floor(full === Infinity ? 0 : full), 0).toString()
    }

    const asNumber = parseInt(full.split('.')[0])

    return isNaN(asNumber) ? '0' : Math.max(asNumber, 0).toString()
  }

  // returns the full version string when building the "full" list, the major version otherwise
  const brandVersion = (v: string | number): string => (isFull && typeof v === 'string' ? v : extractMajor(v))

  // The GREASE brand, its version, and the brand ordering are produced by a deterministic algorithm seeded by the
  // browser major version. We replicate Chromium's implementation 1:1 so the values are indistinguishable from a
  // real Chromium-based browser (instead of the previous hard-coded "(Not(A:Brand";v="99" which no modern Chrome
  // emits, and which leaked only the major version in the full-version list).
  //
  // @link https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/embedder_support/user_agent_utils.cc
  // The GREASE brand/version/order are seeded by the Chromium engine major version. For Chromium wrappers
  // (Opera, Edge) that is the under-the-hood Chromium version, which can differ from the brand version (e.g.
  // Opera 132 runs on Chromium 148, and a real Opera seeds its GREASE with 148, not 132).
  const seed = parseInt(underHoodVersion ? extractMajor(underHoodVersion) : extractMajor(version), 10) || 0
  const greaseChars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
  const greaseVersions = ['8', '99', '24']
  const greaseBrand = `Not${greaseChars[seed % greaseChars.length]}A${greaseChars[(seed + 1) % greaseChars.length]}Brand`
  const greaseVersion = greaseVersions[seed % greaseVersions.length]
  const grease: Brand = { brand: greaseBrand, version: isFull ? `${greaseVersion}.0.0.0` : greaseVersion }

  // the list is built as [GREASE, Chromium (base), <brand>], exactly like Chromium does before shuffling
  const brands: Array<Brand> = [grease]

  switch (browser) {
    case 'chrome': {
      const chromeVersion: string = brandVersion(version)

      brands.push({ brand: 'Chromium', version: chromeVersion }, { brand: 'Google Chrome', version: chromeVersion })

      break
    }

    case 'opera': {
      // for the Opera we set a version for the Chromium engine under "Chromium", and for the Opera
      // itself under "Opera" (from the `version` argument) - keep this in mind
      if (underHoodVersion) {
        brands.push({ brand: 'Chromium', version: brandVersion(underHoodVersion) })
      }

      brands.push({ brand: 'Opera', version: brandVersion(version) })

      break
    }

    case 'edge': {
      // and the same logic for the Microsoft Edge
      if (underHoodVersion) {
        brands.push({ brand: 'Chromium', version: brandVersion(underHoodVersion) })
      }

      brands.push({ brand: 'Microsoft Edge', version: brandVersion(version) })

      break
    }

    case 'brave': {
      // Brave is Chromium-based and exposes a "Brave" brand alongside Chromium (same version, like Chrome).
      // Note: Brave's user agent string is a plain Chrome one, and it reports reduced (major.0.0.0) versions.
      const braveVersion: string = brandVersion(version)

      brands.push({ brand: 'Chromium', version: braveVersion }, { brand: 'Brave', version: braveVersion })

      break
    }
  }

  if (brands.length < 2) {
    return brands
  }

  // a stable permutation seeded by the major version (Chromium's `ShuffleBrandList`)
  const orders: ReadonlyArray<ReadonlyArray<number>> = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  const order = brands.length === 3 ? orders[seed % orders.length] : [seed % 2, (seed + 1) % 2]
  const shuffled: Array<Brand> = new Array<Brand>(brands.length)

  for (let i = 0; i < order.length; i++) {
    shuffled[order[i]] = brands[i]
  }

  return shuffled
}

/** The default Opera Mobile ("OperaMobile" brand) version, taken from a real Opera Mobile build. */
export const defaultOperaMobileVersion = '99.2.5094.88935'

/**
 * Opera Mobile reports a unique, four-brand Client Hints structure that differs from desktop Opera (and from every
 * other Chromium browser): it adds an extra "OperaMobile" brand (whose version is also what `uaFullVersion` /
 * `Sec-CH-UA-Full-Version` report), keeps a separate "Opera" brand, and - unlike modern Chromium - still uses the
 * *legacy* GREASE algorithm (e.g. `;Not A Brand";v="99"`). The brand order is fixed to match a real Opera Mobile.
 *
 * Example (real Opera Mobile, Chromium 148):
 * `"Opera";v="133", ";Not A Brand";v="99", "Chromium";v="148", "OperaMobile";v="99"`
 */
export const operaMobileBrands = (
  operaVersion: string | number,
  chromiumVersion: string | number,
  operaMobileVersion: string | number
): ReadonlyArray<Brand> => {
  const isFull = typeof operaVersion === 'string'

  const extractMajor = (full: string | number): string => {
    if (typeof full !== 'string') {
      return Math.max(Math.floor(full === Infinity ? 0 : full), 0).toString()
    }

    const asNumber = parseInt(full.split('.')[0])

    return isNaN(asNumber) ? '0' : Math.max(asNumber, 0).toString()
  }

  const brandVersion = (v: string | number): string => (isFull && typeof v === 'string' ? v : extractMajor(v))

  // the legacy GREASE algorithm (still used by Opera Mobile), seeded by the Chromium engine major version
  const seed = parseInt(extractMajor(chromiumVersion), 10) || 0
  const legacyChars = [' ', ' ', ';']
  const orders: ReadonlyArray<ReadonlyArray<number>> = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  const o = orders[seed % orders.length]
  const greaseBrand = `${legacyChars[o[0]]}Not${legacyChars[o[1]]}A${legacyChars[o[2]]}Brand`
  const grease: Brand = { brand: greaseBrand, version: isFull ? '99.0.0.0' : '99' }

  // the order is fixed to match a real Opera Mobile capture: Opera, GREASE, Chromium, OperaMobile
  return [
    { brand: 'Opera', version: brandVersion(operaVersion) },
    grease,
    { brand: 'Chromium', version: brandVersion(chromiumVersion) },
    { brand: 'OperaMobile', version: brandVersion(operaMobileVersion) },
  ]
}

/**
 * Platform is used to determine the operating system of the user's device, but without detailed information. For
 * instance, the Browser may send the `Sec-CH-UA-Platform` header with the value of the operating system, such as
 * "Windows", "Linux", "macOS", "iOS", or "Android" (I'm not sure is the list is full, but those are the most
 * common ones).
 *
 * Also, this information is then exposed in the JavaScript environment through the
 * `navigator.userAgentData.getHighEntropyValues()` method:
 *
 * ```javascript
 * JSON.stringify(await navigator.userAgentData.getHighEntropyValues(["brands"]))
 * ```
 *
 * ```json
 * {"brands":[
 *   {"brand":"Google Chrome","version":"123"},
 *   {"brand":"Not:A-Brand","version":"8"},
 *   {"brand":"Chromium","version":"123"}
 * ],"mobile":false,"platform":"Linux"}
 * ```
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/sec-ch-ua-platform#directives
 * @link https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues#brands
 */
export const platform = (
  os: 'windows' | 'linux' | 'macOS' | 'iOS' | 'android' | string
): 'Windows' | 'Linux' | 'macOS' | 'iOS' | 'Android' | 'Unknown' => {
  switch (os.toLowerCase().trim()) {
    case 'windows':
      return 'Windows'

    case 'linux':
      return 'Linux'

    case 'macos':
      return 'macOS'

    case 'ios':
      return 'iOS'

    case 'android':
      return 'Android'
  }

  return 'Unknown'
}

/**
 * One more function from the same series. It's used to determine whether the user's device is a mobile device or not.
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Mobile
 */
export const isMobile = (os: 'windows' | 'linux' | 'macOS' | 'iOS' | 'android' | string): boolean => {
  switch (os.toLowerCase().trim()) {
    case 'ios':
    case 'android':
      return true
  }

  return false
}

/**
 * Returns a reasonable, common default for the platform version (used for the `Sec-CH-UA-Platform-Version` header
 * and the `platformVersion` high-entropy value). The user can override this value in the extension settings.
 *
 * On Windows the value is based on the `Windows.Foundation.UniversalApiContract` version (e.g. Windows 11 24H2 maps
 * to "19.0.0"), not the kernel version.
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-UA-Platform-Version
 * @link https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11
 */
export const platformVersion = (
  platformName: 'Windows' | 'Linux' | 'macOS' | 'iOS' | 'Android' | 'Unknown' | string
): string => {
  switch (platformName) {
    case 'Windows':
      return '19.0.0' // Windows 11 24H2

    case 'Linux':
      return '6.5.0'

    case 'Android':
      return '13.0.0'

    case 'macOS':
    case 'iOS':
      return '14.2.1'
  }

  return ''
}
