import { afterEach, describe, expect, it, vi } from "vitest"
import { SwordSound } from "../src/sword"

function audioMock(staysSuspended = false) {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: param(),
    frequency: param(),
    start: vi.fn(),
    stop: vi.fn(),
    type: "",
    onended: undefined,
  })
  const master = node()
  const context = {
    state: "suspended",
    currentTime: 1,
    sampleRate: 24000,
    destination: {},
    createGain: vi.fn().mockReturnValueOnce(master).mockImplementation(node),
    createBuffer: vi.fn((_channels: number, size: number) => ({
      getChannelData: () => new Float32Array(size),
    })),
    createBufferSource: vi.fn(node),
    createBiquadFilter: vi.fn(node),
    createOscillator: vi.fn(node),
    resume: vi.fn(async () => {
      if (!staysSuspended) context.state = "running"
    }),
    close: vi.fn(async () => {
      context.state = "closed"
    }),
  }
  vi.stubGlobal("window", { AudioContext: vi.fn(() => context) })
  return { context, master }
}

describe("synthesized sword strike", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("requires activation, respects mute/volume, and closes its audio context", async () => {
    const { context, master } = audioMock()
    const sound = new SwordSound()
    sound.play()
    expect(context.createBufferSource).not.toHaveBeenCalled()
    await sound.enable()
    sound.setVolume(2)
    expect(master.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 1)
    sound.play()
    expect(context.createBufferSource).toHaveBeenCalledTimes(1)
    expect(context.createOscillator).toHaveBeenCalledTimes(4)
    sound.mute(true)
    sound.play()
    expect(context.createBufferSource).toHaveBeenCalledTimes(1)
    expect(master.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 1)
    sound.mute(false)
    sound.setVolume(-1)
    sound.play()
    expect(context.createBufferSource).toHaveBeenCalledTimes(1)
    await sound.destroy()
    expect(context.close).toHaveBeenCalledOnce()
    sound.play()
    expect(context.createBufferSource).toHaveBeenCalledTimes(1)
  })

  it("reports browser activation failures without playing a strike", async () => {
    const { context } = audioMock(true)
    const sound = new SwordSound()
    await expect(sound.enable()).rejects.toThrow("Нажмите кнопку звука")
    sound.play()
    expect(context.createBufferSource).not.toHaveBeenCalled()
    await sound.destroy()
  })
})
