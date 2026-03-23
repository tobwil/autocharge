import React, { useEffect, useRef, useState } from 'react'

interface LogEntry {
  ts: number
  level: string
  name: string
  msg: string
}

const LEVEL_CLS: Record<string, string> = {
  DEBUG:    'text-gray-400',
  INFO:     'text-blue-400',
  WARNING:  'text-yellow-400',
  ERROR:    'text-red-400',
  CRITICAL: 'text-red-500 font-bold',
}

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', { hour12: false })
}

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    async function poll() {
      while (active) {
        try {
          const r = await fetch('/api/logs')
          if (r.ok) setLogs(await r.json())
        } catch {}
        await new Promise(res => setTimeout(res, 2000))
      }
    }
    poll()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  const visible = filter
    ? logs.filter(l => l.msg.toLowerCase().includes(filter.toLowerCase()) || l.name.toLowerCase().includes(filter.toLowerCase()) || l.level.toLowerCase().includes(filter.toLowerCase()))
    : logs

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-Scroll
        </label>
        <button
          onClick={() => setLogs([])}
          className="px-3 py-2 text-xs text-gray-400 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          Leeren
        </button>
      </div>

      <div className="bg-gray-950 rounded-2xl border border-gray-800 p-4 h-[calc(100vh-220px)] overflow-y-auto font-mono text-xs leading-5">
        {visible.length === 0 && (
          <p className="text-gray-600 text-center py-8">Keine Einträge</p>
        )}
        {visible.map((l, i) => (
          <div key={i} className="flex gap-2 hover:bg-gray-900 px-1 rounded">
            <span className="text-gray-600 shrink-0 w-20">{fmt(l.ts)}</span>
            <span className={`shrink-0 w-16 ${LEVEL_CLS[l.level] ?? 'text-gray-400'}`}>{l.level}</span>
            <span className="text-gray-500 shrink-0 w-28 truncate">{l.name}</span>
            <span className={`flex-1 break-all ${LEVEL_CLS[l.level] ?? 'text-gray-300'}`}>{l.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <p className="text-xs text-gray-400 text-right">{visible.length} / {logs.length} Einträge</p>
    </div>
  )
}
