import React, { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { HistoryPoint } from '../types'

const RANGES = [
  { label: '3h', hours: 3 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

function fmt(ts: number, hours: number) {
  const d = new Date(ts * 1000)
  if (hours > 24) return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export default function History() {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/history?hours=${hours}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [hours])

  const chartData = data.map(p => ({
    time: fmt(p.ts, hours),
    Solar: +(p.solar_w / 1000).toFixed(2),
    Verfügbar: +(p.available_w / 1000).toFixed(2),
    EV: +(p.ev_w / 1000).toFixed(2),
  }))

  const totalEv = data.reduce((s, p) => {
    const dt = data.indexOf(p) > 0 ? (p.ts - data[data.indexOf(p) - 1].ts) / 3600 : 0
    return s + p.ev_w * dt
  }, 0)

  const avgSolar = data.length ? data.reduce((s, p) => s + p.solar_w, 0) / data.length : 0

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {RANGES.map(r => (
          <button
            key={r.hours}
            onClick={() => setHours(r.hours)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              hours === r.hours
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {r.label}
          </button>
        ))}
        {loading && <span className="text-xs text-gray-400 ml-2">Lade…</span>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Ø Solar</div>
          <div className="text-xl font-bold text-yellow-500">{(avgSolar / 1000).toFixed(1)} kW</div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">EV geladen</div>
          <div className="text-xl font-bold text-indigo-500">{(totalEv / 1000).toFixed(2)} kWh</div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Datenpunkte</div>
          <div className="text-xl font-bold text-gray-700 dark:text-gray-300">{data.length}</div>
        </div>
      </div>

      {/* Chart */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Leistungsverlauf (kW)</h2>
        {chartData.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Noch keine Daten vorhanden</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                interval={Math.max(1, Math.floor(chartData.length / 12))}
              />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} unit=" kW" width={42} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any, name: string) => [`${v} kW`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Area type="monotone" dataKey="Solar" stroke="#f59e0b" fill="#78350f" strokeWidth={2} fillOpacity={0.4} />
              <Area type="monotone" dataKey="Verfügbar" stroke="#6366f1" fill="#312e81" strokeWidth={2} fillOpacity={0.4} />
              <Area type="monotone" dataKey="EV" stroke="#22c55e" fill="#14532d" strokeWidth={2} fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  )
}
