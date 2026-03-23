import React, { useEffect, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { HistoryPoint } from '../types'

interface Props {
  refreshTrigger: number
}

const RANGES = [
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
]

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function fmtW(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)} kW`
  return `${Math.round(v)} W`
}

export default function HistoryChart({ refreshTrigger }: Props) {
  const [data, setData] = useState<HistoryPoint[]>([])
  const [range, setRange] = useState(60)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/history?minutes=${range}`)
      .then(r => r.json())
      .then((pts: HistoryPoint[]) => {
        // Downsample to max 300 points for performance
        const step = Math.max(1, Math.floor(pts.length / 300))
        setData(pts.filter((_, i) => i % step === 0))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [range, refreshTrigger])

  const chartData = data.map(p => ({
    time: fmtTime(p.ts),
    'Solar': Math.round(p.solar_w),
    'Verbrauch': Math.round(p.load_w),
    'Netz (Import)': Math.round(Math.max(0, p.grid_w)),
    'Laden EV': Math.round(p.ev_w),
    'Speicher': Math.round(p.battery_w),
  }))

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Verlauf</h2>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.minutes}
              onClick={() => setRange(r.minutes)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                range === r.minutes
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-600">Laden…</div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-gray-600">Noch keine Daten</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              {[
                ['solar', '#f59e0b'],
                ['load', '#8b5cf6'],
                ['grid', '#ef4444'],
                ['ev', '#10b981'],
                ['battery', '#3b82f6'],
              ].map(([k, c]) => (
                <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={c} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={v => `${(v / 1000).toFixed(1)}k`}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af' }}
              formatter={(v: number) => fmtW(v)}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            <Area type="monotone" dataKey="Solar" stroke="#f59e0b" fill="url(#grad-solar)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="Verbrauch" stroke="#8b5cf6" fill="url(#grad-load)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="Netz (Import)" stroke="#ef4444" fill="url(#grad-grid)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="Laden EV" stroke="#10b981" fill="url(#grad-ev)" strokeWidth={2} dot={false} />
            <Area type="monotone" dataKey="Speicher" stroke="#3b82f6" fill="url(#grad-battery)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
