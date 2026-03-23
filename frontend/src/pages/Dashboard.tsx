import React, { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { AppState, ChargerState } from '../types'

const MODES = [
  { id: 'off',   icon: '⏸', label: 'Aus',   desc: 'Kein Laden' },
  { id: 'solar', icon: '☀️', label: 'Solar',  desc: 'PV-Überschuss' },
  { id: 'fixed', icon: '🔧', label: 'Fest',   desc: 'Feste Leistung' },
]

const STATUS_COLOR: Record<string, string> = {
  Available:    'text-green-500',
  Preparing:    'text-yellow-500',
  Charging:     'text-indigo-500',
  SuspendedEVSE:'text-orange-500',
  SuspendedEV:  'text-orange-500',
  Finishing:    'text-blue-500',
  Unavailable:  'text-gray-400',
  Faulted:      'text-red-500',
}

function fmtW(w: number) {
  return w >= 950 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`
}

function fmtAge(ts: number): string {
  if (!ts) return '–'
  const s = Math.round(Date.now() / 1000 - ts)
  if (s < 60) return `vor ${s}s`
  return `vor ${Math.floor(s / 60)} min`
}

function fmtCountdown(ts: number): string {
  if (!ts) return '–'
  const s = Math.round(ts - Date.now() / 1000)
  if (s <= 0) return 'gleich'
  if (s < 60) return `in ${s}s`
  return `in ${Math.ceil(s / 60)} min`
}

function StatCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1 mb-2">
        <span>{icon}</span>{label}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

function ChargerCard({ cp, mode }: { cp: ChargerState; mode: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900 dark:text-white">{cp.id}</div>
          <div className={`text-sm ${STATUS_COLOR[cp.status] ?? 'text-gray-400'}`}>{cp.status}</div>
          {cp.vendor ? <div className="text-xs text-gray-400 mt-0.5">{cp.vendor} · {cp.model}</div> : null}
        </div>
        <div className="text-right">
          {cp.charging && (
            <div>
              <div className="text-indigo-500 font-bold">{fmtW(cp.power_w)}</div>
              <div className="text-xs text-gray-500">
                {cp.amp_actual.toFixed(1)} A · {cp.voltage.toFixed(0)} V · {cp.phases_actual ?? 3}×
              </div>
              <div className="text-xs text-gray-400">{(cp.energy_session_wh / 1000).toFixed(3)} kWh</div>
            </div>
          )}
          {!cp.charging && cp.car_connected && <div className="text-yellow-500 text-sm">Warte…</div>}
          {!cp.car_connected && <div className="text-gray-400 text-sm">Kein Fahrzeug</div>}
        </div>
      </div>
      {cp.car_connected && mode !== 'off' && (
        <div className="mt-3 flex gap-2">
          {!cp.charging
            ? <button onClick={() => fetch(`/api/charger/${cp.id}/start`, { method: 'POST' })}
                className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white">▶ Starten</button>
            : <button onClick={() => fetch(`/api/charger/${cp.id}/stop`,  { method: 'POST' })}
                className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 rounded-lg text-white">⏹ Stoppen</button>
          }
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ state }: { state: AppState | null }) {
  const mode = state?.charging_mode ?? 'solar'
  const phases = state?.phases ?? 3
  const bufPct = Math.round((state?.buffer_fraction ?? 0.10) * 100)

  // Fixed-mode kW state – local pending until applied
  const [pendingKw, setPendingKw] = useState<string | null>(null)
  const displayKw = pendingKw ?? String(state?.fixed_kw ?? 5.52)
  const displayKwNum = parseFloat(displayKw) || 0
  const approxAmps = Math.round(displayKwNum * 1000 / (phases * 230))

  // Weather countdown (re-renders every second)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  function setMode(id: string, kw?: number) {
    const kwParam = id === 'fixed' && kw ? `?kw=${kw}` : ''
    fetch(`/api/mode/${id}${kwParam}`, { method: 'POST' })
  }

  function applyFixed() {
    const kw = parseFloat(displayKw)
    if (isNaN(kw) || kw <= 0) return
    setMode('fixed', kw)
    setPendingKw(null)
  }

  const forecastData = (state?.forecast ?? []).map(p => ({
    time: p.time.slice(11, 16),
    kw: +(p.solar_w / 1000).toFixed(1),
  }))

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          icon="☀️" label="Solar (geschätzt)"
          value={fmtW(state?.solar_estimate_w ?? 0)}
          color="text-yellow-500"
        />
        <StatCard
          icon="⚡" label="Verfügbar für EV"
          value={fmtW(state?.available_for_ev_w ?? 0)}
          sub={`nach ${bufPct}% Puffer`}
          color="text-indigo-500"
        />
        <StatCard
          icon="🔋" label="EV lädt"
          value={fmtW(state?.ev_power_w ?? 0)}
          color="text-green-500"
        />
      </div>

      {/* Weather timing + attribution */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 px-1">
        {state?.weather_updated_at ? (
          <>
            <span>🌤 Wetterdaten: {fmtAge(state.weather_updated_at)}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span>nächstes Update {fmtCountdown(state.weather_next_at)}</span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
          </>
        ) : null}
        <span>
          Quelle:{' '}
          <a
            href="https://open-meteo.com"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:underline"
          >
            Open-Meteo
          </a>
          {' '}(Irradianz GHI/DNI/DHI) · Solar-Ertrag aus PV-Spezifikation (kWp, Neigung, Azimut)
        </span>
      </div>

      {/* Mode selector */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Lademodus</h2>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`p-4 rounded-xl border text-center transition-all ${
                mode === m.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-white'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600'
              }`}
            >
              <div className="text-2xl mb-1">{m.icon}</div>
              <div className="text-sm font-semibold">{m.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>

        {/* Fixed kW input */}
        {mode === 'fixed' && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 shrink-0">Ladeleistung</span>
              <input
                type="number"
                min={0.5} max={22} step={0.1}
                value={displayKw}
                onChange={e => setPendingKw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyFixed()}
                className="w-28 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
              <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">kW</span>
              <span className="text-xs text-gray-400">≈ {approxAmps} A @ {phases}×230 V</span>
              <button
                onClick={applyFixed}
                className="ml-auto px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold"
              >
                Setzen
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Chargers */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Ladepunkte (OCPP)</h2>
        {!state?.chargers.length ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-4xl mb-2">🔌</div>
            <p>Keine Wallbox verbunden</p>
            <p className="text-sm mt-1 text-gray-400">
              OCPP-URL in der Wallbox eintragen → Seite <strong>Ladepunkte</strong>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {state.chargers.map(cp => <ChargerCard key={cp.id} cp={cp} mode={mode} />)}
          </div>
        )}
      </section>

      {/* Forecast */}
      {forecastData.length > 0 && (
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Solar-Prognose (kW)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={forecastData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" tick={{ fill: '#9ca3af', fontSize: 11 }} interval={2} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} unit=" kW" width={40} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [`${v} kW`, 'Solar']}
              />
              <Area type="monotone" dataKey="kw" stroke="#f59e0b" fill="#fef3c7" strokeWidth={2} fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {state && (
        <p className="text-xs text-gray-400 text-right">
          {new Date(state.ts * 1000).toLocaleTimeString('de-DE')}
        </p>
      )}
    </div>
  )
}
