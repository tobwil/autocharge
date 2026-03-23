import { useEffect, useRef, useState } from 'react'
import { AppState } from '../types'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export function useWebSocket() {
  const [state, setState] = useState<AppState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function connect() {
    if (wsRef.current && wsRef.current.readyState < 2) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => { setConnected(true); if (retryRef.current) clearTimeout(retryRef.current) }
    ws.onmessage = (e) => { try { setState(JSON.parse(e.data)) } catch {} }
    ws.onclose = () => { setConnected(false); retryRef.current = setTimeout(connect, 3000) }
    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    connect()
    return () => { retryRef.current && clearTimeout(retryRef.current); wsRef.current?.close() }
  }, [])

  return { state, connected }
}
