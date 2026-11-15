/** A short, original metallic strike, synthesized locally without audio downloads. */
export class SwordSound {
  private context?: AudioContext
  private master?: GainNode
  private volume = 0.45
  private muted = false
  private enabled = false

  async enable(): Promise<void> {
    const Audio =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Audio) throw new Error("Браузер не поддерживает звук Web Audio")
    if (!this.context || this.context.state === "closed") {
      this.context = new Audio()
      this.master = this.context.createGain()
      this.master.connect(this.context.destination)
      this.applyVolume()
    }
    await this.context.resume()
    if (this.context.state !== "running")
      throw new Error("Нажмите кнопку звука ещё раз, чтобы разрешить воспроизведение")
    this.enabled = true
  }

  setVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    this.applyVolume()
  }
  mute(value: boolean) {
    this.muted = value
    this.applyVolume()
  }
  private applyVolume() {
    if (this.master && this.context)
      this.master.gain.setValueAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
      )
  }

  play(): void {
    const context = this.context
    const master = this.master
    if (
      !this.enabled ||
      !context ||
      !master ||
      context.state !== "running" ||
      this.muted ||
      this.volume === 0
    )
      return
    const now = context.currentTime
    const duration = 0.46
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate,
    )
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index++) {
      const time = index / context.sampleRate
      samples[index] = (Math.random() * 2 - 1) * Math.exp(-time * 32)
    }
    const noise = context.createBufferSource()
    noise.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = "highpass"
    filter.frequency.value = 2100
    const impact = context.createGain()
    impact.gain.setValueAtTime(0.42, now)
    impact.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    noise.connect(filter)
    filter.connect(impact)
    impact.connect(master)
    noise.onended = () => {
      noise.disconnect()
      filter.disconnect()
      impact.disconnect()
    }
    noise.start(now)
    noise.stop(now + duration)

    for (const [frequency, strength, decay] of [
      [970, 0.21, 0.36],
      [1603, 0.13, 0.29],
      [2471, 0.08, 0.23],
      [3833, 0.045, 0.17],
    ]) {
      const tone = context.createOscillator()
      const envelope = context.createGain()
      tone.type = "sine"
      tone.frequency.setValueAtTime(frequency * 1.03, now)
      tone.frequency.exponentialRampToValueAtTime(frequency, now + 0.035)
      envelope.gain.setValueAtTime(0.0001, now)
      envelope.gain.exponentialRampToValueAtTime(strength, now + 0.003)
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      tone.connect(envelope)
      envelope.connect(master)
      tone.onended = () => {
        tone.disconnect()
        envelope.disconnect()
      }
      tone.start(now)
      tone.stop(now + duration)
    }
  }

  async destroy(): Promise<void> {
    this.enabled = false
    const context = this.context
    this.context = undefined
    this.master = undefined
    if (context && context.state !== "closed") await context.close()
  }
}
