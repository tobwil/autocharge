import React, { useState } from 'react'
import { SystemState } from '../types'

interface Props {
  state: SystemState
  onModeChange: (mode: string) => void
  onAmpsChange: (amps: number, allowed: boolean) => void
}

const MODES = [
  { key: 'off', label: 'Aus', desc: 'Kein Laden', icon: '⛔', color: 'border-gray-600 text-gray-400' },
  { key: 'solar', label: 'Solar', desc: 'Nur Überschuss', icon: '☀️', color: 'border-yellow-500 text-yellow-400' },
  { key: 'min_solar', label: 'Hybrid', desc: 'Immer + Solar', icon: '⚡', color: 'border-blue-500 text-blue-400' },
  { key: 'fast', label: 'Schnell', desc: 'Maximum', icon: '🚀', color: 'border-green-500 text-green-400' },
]

export default function ChargingControl({ state, onModeChange, onAmpsChange }: Props) {
  const { charger, charging_mode } = state
  const [manualAmps, setManualAmps] = useState(charger.amp_set || 6)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Ladesteuerung</h2>

      {/* Mode selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            className={`rounded-xl border-2 p-3 text-center transition-all ${
              charging_mode === m.key
                ? m.color + ' bg-gray-800'
                : 'border-gray-700 text-gray-500 hover:border-gray-600'
            }`}
          >
            <div className="text-2xl mb-1">{m.icon}</div>
            <div className="font-bold text-sm">{m.label}</div>
            <div className="text-xs opacity-70">{m.desc}</div>
          </button>
        ))}
      </div>

      {/* Status */}
      <div className="flex flex-wrap gap-4 text-sm mb-5">
        <div>
          <span className="text-gray-500">Status: </span>
          <span className={charger.charging ? 'text-green-400 font-semibold' : charger.car_connected ? 'text-blue-400' : 'text-gray-400'}>
            {charger.charging ? `Lädt · ${charger.amp_set.toFixed(0)} A · ${charger.phases_active} Phase(n)` :
             charger.car_connected ? 'Verbunden · wartet' : 'Kein Auto'}
          </span>
        </div>
        {charger.energy_session_wh > 0 && (
          <div>
            <span className="text-gray-500">Session: </span>
            <span className="text-white font-semibold">{(charger.energy_session_wh / 1000).toFixed(2)} kWh</span>
          </div>
        )}
        {charger.car_connected && (
          <div>
            <span className="text-gray-500">Spannung: </span>
            <span className="text-white">{charger.voltage_l1.toFixed(0)} V</span>
          </div>
        )}
      </div>

      {/* Manual amp override */}
      {charging_mode === 'fast' && (
        <div className="bg-gray-800 rounded-xl p-4">
          <label className="text-sm text-gray-400 block mb-2">
            Ladeampere: <span className="text-white font-bold">{manualAmps} A</span>
            <span className="text-gray-500 ml-2">
              ({(manualAmps * charger.phases_active * 230 / 1000).toFixed(1)} kW)
            </span>
          </label>
          <input
            type="range"
            min={6} max={16} step={1}
            value={manualAmps}
            onChange={e => setManualAmps(Number(e.target.value))}
            className="w-full accent-green-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>6 A (1.4 kW)</span>
            <span>16 A (11 kW)</span>
          </div>
          <button
            onClick={() => onAmpsChange(manualAmps, true)}
            className="mt-3 w-full bg-green-600 hover:bg-green-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
          >
            Setzen
          </button>
        </div>
      )}

      {/* Phase indicator */}
      <div className="mt-4 flex gap-3 text-xs text-gray-500">
        {['L1', 'L2', 'L3'].map((l, i) => {
          const cur = [charger.current_l1, charger.current_l2, charger.current_l3][i]
          const active = cur > 0.5
          return (
            <div key={l} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${active ? 'bg-gray-800 text-green-400' : 'bg-gray-900 text-gray-600'}`}>
              <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-400' : 'bg-gray-700'}`} />
              {l}: {cur.toFixed(1)} A
            </div>
          )
        })}
      </div>
    </div>
  )
}
