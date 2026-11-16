import { useEffect, useState } from "react"
import OBR from "@owlbear-rodeo/sdk"
import { vortexRoomUrl } from "./vortex"

export type VortexRoomState = { url: string | null; loading: boolean }

/** Observe the official room binding without modifying its metadata. */
export function useVortexRoom(): VortexRoomState {
  const [state, setState] = useState<VortexRoomState>({ url: null, loading: true })
  useEffect(() => {
    const room = OBR.room
    if (typeof room?.getMetadata !== "function") {
      setState({ url: null, loading: false })
      return
    }
    let active = true
    let changed = false
    let stop: (() => void) | undefined
    const apply = (metadata: unknown) => {
      if (active) setState({ url: vortexRoomUrl(metadata), loading: false })
    }
    // Subscribe before reading. A newer event must win over an in-flight read.
    try {
      stop = room.onMetadataChange?.(metadata => {
        changed = true
        apply(metadata)
      })
    } catch {
      // Older SDK mocks may expose only the initial read.
    }
    void Promise.resolve()
      .then(() => room.getMetadata())
      .then(metadata => {
        if (!changed) apply(metadata)
      })
      .catch(() => {
        if (!changed) apply(null)
      })
    return () => {
      active = false
      stop?.()
    }
  }, [])
  return state
}
