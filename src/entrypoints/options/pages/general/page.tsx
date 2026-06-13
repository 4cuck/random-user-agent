import React, { useEffect, useId, useState } from 'react'
import { i18n } from '~/i18n'
import { send } from '~/shared/messaging'
import { Button, Grid, Input, Switch } from '../../shared/components'
import { debug } from '../../shared'
import { useTitle, useSaveSettings } from '../../shared/hooks'

/** Converts a multiline text to a list of strings. */
const textToList = (text: string): string[] =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

/** Validates the URL. */
const validateUrl = (url: string): boolean => {
  try {
    const u = new URL(url)

    return u.protocol === 'http:' || u.protocol === 'https:'
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // ignore invalid URLs
  }

  return false
}

export default function General(): React.JSX.Element {
  useTitle(i18n('general_settings'))

  const saveSettings = useSaveSettings()

  const [enabled, setEnabled, enabledId] = [...useState<boolean>(), useId()]
  const [renewEnabled, setRenewEnabled] = useState<boolean>()
  const [renewIntervalSec, setRenewIntervalSec, renewIntervalSecId] = [...useState<number>(), useId()]
  const [renewOnStartup, setRenewOnStartup, renewOnStartupId] = [...useState<boolean>(), useId()]
  const [jsProtectionEnabled, setJsProtectionEnabled, jsProtectionEnabledId] = [...useState<boolean>(), useId()]
  const [customUAEnabled, setCustomUAEnabled, customUAEnabledId] = [...useState<boolean>(), useId()]
  const [customUAText, setCustomUAText] = useState<string>()
  const [chFullVersion, setChFullVersion, chFullVersionId] = [...useState<string>(), useId()]
  const [chPlatformVersion, setChPlatformVersion, chPlatformVersionId] = [...useState<string>(), useId()]
  const [chPlatform, setChPlatform, chPlatformId] = [...useState<string>(), useId()]
  const [chFormFactors, setChFormFactors, chFormFactorsId] = [...useState<string>(), useId()]
  const [chModel, setChModel, chModelId] = [...useState<string>(), useId()]
  const [chArchitecture, setChArchitecture, chArchitectureId] = [...useState<string>(), useId()]
  const [chBitness, setChBitness, chBitnessId] = [...useState<string>(), useId()]
  const [chOperaMobileVersion, setChOperaMobileVersion, chOperaMobileVersionId] = [...useState<string>(), useId()]
  const [remoteUAListEnabled, setRemoteUAListEnabled, remoteUAListEnabledId] = [...useState<boolean>(), useId()]
  const [remoteUAListUrl, setRemoteUAListUrl] = useState<string>()
  const [remoteUAUpdIntervalSec, setRemoteUAUpdIntervalSec] = useState<number>()
  const [remoteListUpdateBtnEnabled, setRemoteListUpdateBtnEnabled] = useState<boolean>(true)
  const [remoteListUpdateStatus, setRemoteListUpdateStatus] = useState<string>()

  // on component mount
  useEffect(() => {
    send({ settings: undefined }).then(({ settings }) => {
      if (settings instanceof Error) {
        throw settings
      }

      setEnabled(settings.enabled)
      setRenewEnabled(settings.renew.enabled)
      setRenewIntervalSec(Math.round(settings.renew.intervalMillis / 1000))
      setRenewOnStartup(settings.renew.onStartup)
      setJsProtectionEnabled(settings.jsProtection.enabled)
      setCustomUAEnabled(settings.customUseragent.enabled)
      setCustomUAText(settings.customUseragent.list.join('\n'))
      setRemoteUAListEnabled(settings.remoteUseragentList.enabled)
      setRemoteUAListUrl(settings.remoteUseragentList.uri)
      setRemoteUAUpdIntervalSec(Math.round(settings.remoteUseragentList.updateIntervalMillis / 1000))
      setChFullVersion(settings.clientHints.fullVersion)
      setChPlatformVersion(settings.clientHints.platformVersion)
      setChPlatform(settings.clientHints.platform)
      setChFormFactors(settings.clientHints.formFactors)
      setChModel(settings.clientHints.model)
      setChArchitecture(settings.clientHints.architecture)
      setChBitness(settings.clientHints.bitness)
      setChOperaMobileVersion(settings.clientHints.operaMobileVersion)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const delayFor = { switch: 350, input: 550, textarea: 750 }

  return (
    <>
      <h1>{i18n('general_settings')}</h1>
      <p>{i18n('general_settings_hint')}:</p>

      <Grid>
        <Grid.Row>
          <Grid.Column>
            <label htmlFor={enabledId}>{i18n('enable_switcher')}</label>
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={enabledId}
              checked={enabled}
              onChange={async (v) => {
                setEnabled(v)
                await saveSettings({ enabled: v }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column>
            <label htmlFor={renewIntervalSecId}>{i18n('auto_renew')}</label>
            <Grid.Hint>{i18n('auto_renew_interval')}:</Grid.Hint>
            <Input.Number
              disabled={!renewEnabled}
              value={renewIntervalSec}
              min={30}
              max={86400}
              step={10}
              size={8}
              placeholder="60"
              onChange={async (num) => {
                setRenewIntervalSec(num)
                await saveSettings({ renew: { intervalMillis: Math.round(num * 1000) } }, delayFor.input)
              }}
            />
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={renewIntervalSecId}
              checked={renewEnabled}
              onChange={async (v) => {
                setRenewEnabled(v)
                await saveSettings({ renew: { enabled: v } }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column>
            <label htmlFor={renewOnStartupId}>{i18n('auto_renew_on_startup')}</label>
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={renewOnStartupId}
              checked={renewOnStartup}
              onChange={async (v) => {
                setRenewOnStartup(v)
                await saveSettings({ renew: { onStartup: v } }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column>
            <label htmlFor={jsProtectionEnabledId}>{i18n('js_protection')}</label>
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={jsProtectionEnabledId}
              checked={jsProtectionEnabled}
              onChange={async (v) => {
                setJsProtectionEnabled(v)
                await saveSettings({ jsProtection: { enabled: v } }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={customUAEnabledId}>{i18n('custom_useragent')}</label>
            <Grid.Hint>{i18n('custom_useragent_list')}:</Grid.Hint>
            <Input.Textarea
              disabled={!customUAEnabled}
              placeholder="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_7; rv:92.0) Gecko/20010101 Firefox/92.0"
              maxLength={4096}
              rows={7}
              value={customUAText}
              onChange={async (text) => {
                setCustomUAText(text)
                await saveSettings(
                  { customUseragent: { enabled: customUAEnabled, list: textToList(text) } },
                  delayFor.textarea
                )
              }}
            />
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={customUAEnabledId}
              checked={customUAEnabled}
              onChange={async (v) => {
                setCustomUAEnabled(v)
                await saveSettings({ customUseragent: { enabled: v } }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chFullVersionId}>{i18n('client_hints_full_version')}</label>
            <Grid.Hint>{i18n('client_hints_full_version_hint')}:</Grid.Hint>
            <Input.Text
              id={chFullVersionId}
              value={chFullVersion}
              maxLength={32}
              placeholder="149.0.7827.115"
              onChange={async (v) => {
                setChFullVersion(v)
                await saveSettings({ clientHints: { fullVersion: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chPlatformVersionId}>{i18n('client_hints_platform_version')}</label>
            <Grid.Hint>{i18n('client_hints_platform_version_hint')}:</Grid.Hint>
            <Input.Text
              id={chPlatformVersionId}
              value={chPlatformVersion}
              maxLength={32}
              placeholder="19.0.0"
              onChange={async (v) => {
                setChPlatformVersion(v)
                await saveSettings({ clientHints: { platformVersion: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chPlatformId}>{i18n('client_hints_platform')}</label>
            <Grid.Hint>{i18n('client_hints_platform_hint')}:</Grid.Hint>
            <Input.Text
              id={chPlatformId}
              value={chPlatform}
              maxLength={32}
              placeholder="Windows"
              onChange={async (v) => {
                setChPlatform(v)
                await saveSettings({ clientHints: { platform: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chFormFactorsId}>{i18n('client_hints_form_factors')}</label>
            <Grid.Hint>{i18n('client_hints_form_factors_hint')}:</Grid.Hint>
            <Input.Text
              id={chFormFactorsId}
              value={chFormFactors}
              maxLength={64}
              placeholder="Desktop"
              onChange={async (v) => {
                setChFormFactors(v)
                await saveSettings({ clientHints: { formFactors: v } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chModelId}>{i18n('client_hints_model')}</label>
            <Grid.Hint>{i18n('client_hints_model_hint')}:</Grid.Hint>
            <Input.Text
              id={chModelId}
              value={chModel}
              maxLength={64}
              placeholder="Pixel 7"
              onChange={async (v) => {
                setChModel(v)
                await saveSettings({ clientHints: { model: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chArchitectureId}>{i18n('client_hints_architecture')}</label>
            <Grid.Hint>{i18n('client_hints_architecture_hint')}:</Grid.Hint>
            <Input.Text
              id={chArchitectureId}
              value={chArchitecture}
              maxLength={16}
              placeholder="x86"
              onChange={async (v) => {
                setChArchitecture(v)
                await saveSettings({ clientHints: { architecture: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chBitnessId}>{i18n('client_hints_bitness')}</label>
            <Grid.Hint>{i18n('client_hints_bitness_hint')}:</Grid.Hint>
            <Input.Text
              id={chBitnessId}
              value={chBitness}
              maxLength={8}
              placeholder="64"
              onChange={async (v) => {
                setChBitness(v)
                await saveSettings({ clientHints: { bitness: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={chOperaMobileVersionId}>{i18n('client_hints_opera_mobile_version')}</label>
            <Grid.Hint>{i18n('client_hints_opera_mobile_version_hint')}:</Grid.Hint>
            <Input.Text
              id={chOperaMobileVersionId}
              value={chOperaMobileVersion}
              maxLength={32}
              placeholder="99.2.5094.88935"
              onChange={async (v) => {
                setChOperaMobileVersion(v)
                await saveSettings({ clientHints: { operaMobileVersion: v.trim() } }, delayFor.input)
              }}
              style={{ width: '100%' }}
            />
          </Grid.Column>
        </Grid.Row>

        <Grid.Row>
          <Grid.Column style={{ outer: { width: '100%' }, inner: { width: '97%' } }}>
            <label htmlFor={remoteUAListEnabledId}>{i18n('remote_useragent_list')}</label>
            <Grid.Hint>{i18n('remote_useragent_list_hint')}:</Grid.Hint>
            <Input.Text
              disabled={!remoteUAListEnabled}
              value={remoteUAListUrl}
              maxLength={256}
              placeholder="https://..."
              onChange={async (uri) => {
                setRemoteUAListUrl(uri)

                if (validateUrl(uri)) {
                  await saveSettings({ remoteUseragentList: { uri } }, delayFor.input)
                }
              }}
              style={{ width: '100%' }}
            />
            <Grid.Hint>{i18n('remote_useragent_updating_interval')}:</Grid.Hint>
            <Input.Number
              disabled={!remoteUAListEnabled}
              value={remoteUAUpdIntervalSec}
              min={0}
              max={604800}
              step={60}
              size={9}
              placeholder="3600"
              onChange={async (num) => {
                setRemoteUAUpdIntervalSec(num)
                await saveSettings(
                  { remoteUseragentList: { updateIntervalMillis: Math.round(num * 1000) } },
                  delayFor.input
                )
              }}
            />
            <Button.Primary
              disabled={
                !(remoteUAListEnabled && remoteUAListUrl && validateUrl(remoteUAListUrl) && remoteListUpdateBtnEnabled)
              }
              text={i18n('update_now')}
              style={{ marginLeft: '1em' }}
              onClick={() => {
                setRemoteListUpdateStatus('')
                setRemoteListUpdateBtnEnabled(false)

                send({ updateRemoteListNow: [true] })
                  .then(({ updateRemoteListNow }) => {
                    if (updateRemoteListNow instanceof Error) {
                      throw updateRemoteListNow
                    }

                    return updateRemoteListNow
                  })
                  .then((res) => setRemoteListUpdateStatus(`📜 ${res.gotListSize.toLocaleString()}`))
                  .catch((err) => {
                    setRemoteListUpdateStatus('🛑 Failed to update')
                    debug('remote list update failed', err)
                  })
                  .finally(() => setRemoteListUpdateBtnEnabled(true))
              }}
            />
            {remoteListUpdateStatus && <span style={{ marginLeft: '1em' }}>{remoteListUpdateStatus}</span>}
          </Grid.Column>
          <Grid.Column>
            <Switch
              id={remoteUAListEnabledId}
              checked={remoteUAListEnabled}
              onChange={async (v) => {
                setRemoteUAListEnabled(v)
                await saveSettings({ remoteUseragentList: { enabled: v } }, delayFor.switch)
              }}
            />
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </>
  )
}
