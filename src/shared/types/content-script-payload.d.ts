import type { DeepReadonly } from '~/types'
import type { ReadonlyUserAgentState } from './user-agent-state'

/** The payload sent by the background script to the content script. */
export type ContentScriptPayload<TBrand = { readonly brand: string; readonly version: string }> = DeepReadonly<{
  current: ReadonlyUserAgentState
  brands: {
    major: Array<TBrand>
    full: Array<TBrand>
  }
  // a known platform name (e.g. "Windows"), or any user-provided override
  platform: string
  // value for `Sec-CH-UA-Platform-Version` / the `platformVersion` high-entropy value
  platformVersion: string
  isMobile: boolean
  // effective full browser version for the full-version Client Hints / `uaFullVersion`
  fullVersion: string
  // form factors for `Sec-CH-UA-Form-Factors` (empty = keep the browser default)
  formFactors: Array<string>
  // device model for `Sec-CH-UA-Model` (empty = none)
  model: string
  // CPU architecture / bitness for `Sec-CH-UA-Arch` / `Sec-CH-UA-Bitness` (empty on mobile)
  architecture: string
  bitness: string
}>
