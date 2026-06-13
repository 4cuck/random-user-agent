/** Generate a random number between a range. */
const fromRange = (min: number, max: number): number => {
  min = Math.ceil(min)

  return Math.floor(Math.random() * (Math.floor(max) - min + 1)) + min
}

/** @link https://chromereleases.googleblog.com/search/label/Desktop%20Update */
export const chrome = (maxMajor?: number, majorDelta: number = 2): [major: number, full: string] => {
  const variants = {
    major: { min: 148, max: 151 }, // 👈 periodically we should update those values
    patch: { min: 7700, max: 8200 }, // 👈 same here
    build: { min: 30, max: 230 }, // 👈 and here
  }

  // only let the fetched (remote) versions list raise the range when it is actually newer than our known-current
  // values - a stale/behind remote list (e.g. MDN browser-compat-data lagging) must never make the generator
  // produce versions older than the hard-coded range below
  if (maxMajor && maxMajor > variants.major.max) {
    variants.major.max = maxMajor
    variants.major.min = Math.max(maxMajor - majorDelta, 0)
  }

  const major = fromRange(variants.major.min, variants.major.max)

  return [
    major,
    `${major}.0.${fromRange(variants.patch.min, variants.patch.max)}.${fromRange(variants.build.min, variants.build.max)}`,
  ]
}

/** @link https://www.mozilla.org/en-US/firefox/releases/ */
export const firefox = (maxMajor?: number, majorDelta: number = 2): [major: number, full: string] => {
  const variants = {
    major: { min: 149, max: 151 }, // 👈 periodically we should update those values
  }

  // only let the fetched (remote) versions list raise the range when it is actually newer than our known-current
  // values - a stale/behind remote list (e.g. MDN browser-compat-data lagging) must never make the generator
  // produce versions older than the hard-coded range below
  if (maxMajor && maxMajor > variants.major.max) {
    variants.major.max = maxMajor
    variants.major.min = Math.max(maxMajor - majorDelta, 0)
  }

  const major = fromRange(variants.major.min, variants.major.max)

  return [major, `${major}.0`]
}

/** @link https://en.wikipedia.org/wiki/Opera_version_history */
export const opera = (maxMajor?: number, majorDelta: number = 2): [major: number, full: string] => {
  const variants = {
    major: { min: 131, max: 134 }, // 👈 periodically we should update those values
    patch: { min: 5800, max: 5990 }, // 👈 same here
    build: { min: 16, max: 120 }, // 👈 and here
  }

  // only let the fetched (remote) versions list raise the range when it is actually newer than our known-current
  // values - a stale/behind remote list (e.g. MDN browser-compat-data lagging) must never make the generator
  // produce versions older than the hard-coded range below
  if (maxMajor && maxMajor > variants.major.max) {
    variants.major.max = maxMajor
    variants.major.min = Math.max(maxMajor - majorDelta, 0)
  }

  const major = fromRange(variants.major.min, variants.major.max)

  return [
    major,
    `${major}.0.${fromRange(variants.patch.min, variants.patch.max)}.${fromRange(variants.build.min, variants.build.max)}`,
  ]
}

export const safari = (maxMajor?: number, majorDelta: number = 2): [major: number, full: string] => {
  const variants = {
    major: { min: 614, max: 632 }, // 👈 periodically we should update those values
    minor: { min: 1, max: 36 }, // 👈 same here
    patch: { min: 1, max: 15 }, // 👈 and here
  }

  // only let the fetched (remote) versions list raise the range when it is actually newer than our known-current
  // values - a stale/behind remote list (e.g. MDN browser-compat-data lagging) must never make the generator
  // produce versions older than the hard-coded range below
  if (maxMajor && maxMajor > variants.major.max) {
    variants.major.max = maxMajor
    variants.major.min = Math.max(maxMajor - majorDelta, 0)
  }

  const major = fromRange(variants.major.min, variants.major.max)

  return [
    major,
    `${major}.${fromRange(variants.minor.min, variants.minor.max)}${Math.random() < 0.3 ? `.${fromRange(variants.patch.min, variants.patch.max)}` : ''}`,
  ]
}

/** @link https://docs.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel */
export const edge = (maxMajor?: number, majorDelta: number = 2): [major: number, full: string] => {
  const variants = {
    major: { min: 148, max: 151 }, // 👈 periodically we should update those values
    patch: { min: 3900, max: 4350 }, // 👈 same here
    build: { min: 30, max: 130 }, // 👈 and here
  }

  // only let the fetched (remote) versions list raise the range when it is actually newer than our known-current
  // values - a stale/behind remote list (e.g. MDN browser-compat-data lagging) must never make the generator
  // produce versions older than the hard-coded range below
  if (maxMajor && maxMajor > variants.major.max) {
    variants.major.max = maxMajor
    variants.major.min = Math.max(maxMajor - majorDelta, 0)
  }

  const major = fromRange(variants.major.min, variants.major.max)

  return [
    major,
    `${major}.0.${fromRange(variants.patch.min, variants.patch.max)}.${fromRange(variants.build.min, variants.build.max)}`,
  ]
}
