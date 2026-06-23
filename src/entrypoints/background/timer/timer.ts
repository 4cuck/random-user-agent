/**
 * Shared registry mapping an alarm name to its handler.
 *
 * The service worker registers ONE `chrome.alarms.onAlarm` listener synchronously during top-level evaluation (see
 * `background/index.ts`) and dispatches firing alarms through this map. This is required by MV3: a listener added
 * later (after an `await`, e.g. inside `Timer.start()`) is not present when Chrome dispatches the alarm that woke the
 * service worker, so that tick would be silently dropped.
 */
export const alarmHandlers = new Map<string, () => void>()

export default class Timer {
  // Chrome 120: Starting in Chrome 120, the minimum alarm interval has been reduced from 1 minute to 30 seconds
  // for an alarm to trigger in 30 seconds, set periodInMinutes: 0.5
  // https://developer.chrome.com/docs/extensions/reference/api/alarms
  //
  // for FireFox, the minimum interval is 1 minute
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create#alarminfo
  private readonly minDelayInSeconds: number = 30

  // is set only after the timer is started (acts as the "started" marker and the registry handler)
  private listener: (() => void) | undefined
  private intervalSec: number

  private readonly name: string
  private readonly handler: (timer: this) => void

  /**
   * Create a new timer. Keep in mind that the minimum interval is 30 seconds, and the timer should be started
   * manually. The name of the timer should be unique.
   */
  constructor(name: string, intervalSec: number, handler: (timer: Timer) => void) {
    this.intervalSec = Math.max(this.minDelayInSeconds, intervalSec)

    this.name = name
    this.handler = handler
  }

  /** Start the timer */
  async start(): Promise<void> {
    // only (re)create the alarm if it does not already exist. Recreating with the same name resets its next-fire
    // time, so on a busy browser (where unrelated events wake the service worker more often than the period) the
    // alarm could be perpetually postponed and never fire.
    if (!(await chrome.alarms.get(this.name))) {
      await chrome.alarms.create(this.name, { periodInMinutes: this.intervalSec / 60 })
    }

    this.listener = () => this.handler(this)

    // dispatch happens via the single, synchronously-registered onAlarm listener (see background/index.ts)
    alarmHandlers.set(this.name, this.listener)
  }

  /** Stop the timer */
  async stop(): Promise<boolean> {
    if (this.listener) {
      alarmHandlers.delete(this.name)

      this.listener = undefined
    }

    return await chrome.alarms.clear(this.name)
  }

  /** Restart the timer */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /** Change the timer interval (in seconds) */
  async changeInterval(intervalSec: number): Promise<void> {
    this.intervalSec = Math.max(this.minDelayInSeconds, intervalSec)

    if (this.listener) {
      await this.restart()
    }
  }

  /** Get the timer interval (in seconds) */
  get getIntervalSec(): number {
    return this.intervalSec
  }

  /** Is the timer started? */
  get isStarted(): boolean {
    return !!this.listener
  }
}
