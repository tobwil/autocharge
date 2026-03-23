import React, { useEffect, useState } from 'react'
import { AppState, ChargerState } from '../types'

const STATUS_DOT: Record<string, string> = {
  Available:    'bg-green-500',
  Preparing:    'bg-yellow-500',
  Charging:     'bg-indigo-500',
  SuspendedEVSE:'bg-orange-500',
  SuspendedEV:  'bg-orange-500',
  Finishing:    'bg-blue-500',
  Unavailable:  'bg-gray-400',
  Faulted:      'bg-red-500',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium">{value}</span>
    </div>
  )
}

function ChargerDetail({ cp }: { cp: ChargerState }) {
  const [amps, setAmps] = useState(cp.amp_set)
  const age = Math.round(Date.now() / 1000 - cp.last_seen)

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_DOT[cp.status] ?? 'bg-gray-400'}`} />
          <div>
            <div className="font-semibold text-gray-900 dark:text-white text-lg">{cp.id}</div>
            <div className="text-sm text-gray-500">{cp.status}</div>
          </div>
        </div>
        {cp.error && <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded">{cp.error}</div>}
      </div>

      <div className="mb-4">
        {cp.vendor && <Row label="Gerät" value={`${cp.vendor} · ${cp.model}`} />}
        <Row label="Fahrzeug" value={cp.car_connected ? '✓ Verbunden' : '✗ Nicht verbunden'} />
        <Row label="Laden"    value={cp.charging ? '✓ Aktiv' : '✗ Inaktiv'} />
        <Row label="Leistung" value={cp.power_w    ? `${(cp.power_w / 1000).toFixed(2)} kW` : '—'} />
        <Row label="Strom"    value={cp.amp_actual ? `${cp.amp_actual.toFixed(1)} A (Limit: ${cp.amp_set} A)` : '—'} />
        <Row label="Spannung" value={cp.voltage    ? `${cp.voltage.toFixed(0)} V` : '—'} />
        <Row label="Session"  value={cp.energy_session_wh ? `${(cp.energy_session_wh / 1000).toFixed(3)} kWh` : '—'} />
        <Row label="Transaktion" value={cp.transaction_id ?? '—'} />
        <Row label="Zuletzt" value={`vor ${age}s`} />
      </div>

      <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-2 items-center">
        <button onClick={() => fetch(`/api/charger/${cp.id}/start`, { method: 'POST' })}
          className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-semibold">
          ▶ Remote Start
        </button>
        <button onClick={() => fetch(`/api/charger/${cp.id}/stop`, { method: 'POST' })}
          className="px-4 py-1.5 text-xs bg-red-600 hover:bg-red-500 rounded-lg text-white font-semibold">
          ⏹ Remote Stop
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <input type="range" min={6} max={32} step={1} value={amps}
            onChange={e => setAmps(Number(e.target.value))}
            className="w-24 accent-indigo-500" />
          <span className="text-sm text-gray-900 dark:text-white w-10">{Math.round(amps)} A</span>
          <button onClick={() => fetch(`/api/charger/${cp.id}/limit/${Math.round(amps)}`, { method: 'POST' })}
            className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-gray-900 dark:text-white">
            Setzen
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Chargers({ state }: { state: AppState | null }) {
  const [networkInfo, setNetworkInfo] = useState<{ ips: string[]; ocpp_port: number } | null>(null)

  useEffect(() => {
    fetch('/api/network-info').then(r => r.json()).then(setNetworkInfo).catch(() => {})
  }, [])

  const port = networkInfo?.ocpp_port ?? state?.ocpp_port ?? 9000
  const ips = networkInfo?.ips ?? []

  return (
    <div className="space-y-6">
      {/* Connection info */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">OCPP 1.6 Server</h2>
        {ips.length > 0 ? (
          <div className="space-y-2">
            {ips.map(ip => (
              <div key={ip} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono text-sm text-indigo-600 dark:text-indigo-300 break-all select-all">
                ws://{ip}:{port}/<span className="text-gray-400">[wallbox-id]</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono text-sm text-indigo-600 dark:text-indigo-300 break-all">
            ws://{window.location.hostname}:{port}/<span className="text-gray-400">[wallbox-id]</span>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Diese URL in der OCPP-Konfiguration der Wallbox eintragen. Als Wallbox-ID einen beliebigen Namen wählen (z.B. <code className="font-mono">wallbox1</code>).
        </p>
      </section>

      {/* Charger list */}
      {!state?.chargers.length ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">🔌</div>
          <p className="text-lg text-gray-600 dark:text-gray-400">Keine Wallbox verbunden</p>
          <p className="text-sm mt-2">Warte auf eingehende OCPP-Verbindung auf Port {port}…</p>
        </div>
      ) : (
        <div className="space-y-4">
          {state.chargers.map(cp => <ChargerDetail key={cp.id} cp={cp} />)}
        </div>
      )}
    </div>
  )
}
