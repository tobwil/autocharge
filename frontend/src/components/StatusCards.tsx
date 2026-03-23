import React from 'react'
import { SystemState } from '../types'

interface Props { state: SystemState }

function fmt(w: number, digits = 1): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(digits)} kW`
  return `${Math.round(w)} W`
}

function Card({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string
}) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3`}>
      <div className={`text-2xl mt-0.5`}>{icon}</div>
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{label}</div>
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

const CAR_LABELS: Record<number, string> = {
  1: 'Bereit',
  2: 'Lädt',
  3: 'Warte auf Auto',
  4: 'Fertig',
  5: 'Fehler',
}

export default function StatusCards({ state }: Props) {
  const { solar_w, grid_w, load_w, ev_w, battery_w, charger, inverters } = state
  const gridImport = grid_w < 0 ? Math.abs(grid_w) : 0
  const gridExport = grid_w > 0 ? grid_w : 0
  const hasBattery = inverters.some(inv => inv.battery_soc_pct !== null)
  const battSoc = inverters.find(inv => inv.battery_soc_pct !== null)?.battery_soc_pct ?? null

  const selfConsumption = solar_w > 0 ? Math.min(100, ((solar_w - Math.max(0, grid_w)) / solar_w) * 100) : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card
        label="Solar"
        value={fmt(solar_w)}
        sub={`${inverters.filter(i => i.online).length}/${inverters.length} online`}
        color="text-yellow-400"
        icon="☀️"
      />
      <Card
        label="Verbrauch"
        value={fmt(load_w)}
        sub={`Eigenverbrauch ${selfConsumption.toFixed(0)}%`}
        color="text-purple-400"
        icon="🏠"
      />
      <Card
        label={gridExport > gridImport ? 'Einspeisung' : 'Netzbezug'}
        value={gridExport > gridImport ? `+${fmt(gridExport)}` : `-${fmt(gridImport)}`}
        color={gridExport > gridImport ? 'text-indigo-400' : 'text-red-400'}
        icon="🔌"
      />
      <Card
        label="Wallbox"
        value={charger.charging ? fmt(ev_w) : CAR_LABELS[charger.car_status] ?? '–'}
        sub={charger.charging ? `${charger.amp_set.toFixed(0)} A · ${charger.phases_active}P` : ''}
        color={charger.charging ? 'text-green-400' : charger.car_connected ? 'text-blue-400' : 'text-gray-400'}
        icon="⚡"
      />
      {hasBattery && (
        <Card
          label="Speicher"
          value={battSoc !== null ? `${battSoc.toFixed(0)}%` : '–'}
          sub={battery_w !== 0 ? (battery_w > 0 ? `Laden ${fmt(battery_w)}` : `Entladen ${fmt(Math.abs(battery_w))}`) : 'Standby'}
          color="text-blue-400"
          icon="🔋"
        />
      )}
      <Card
        label="Lademodus"
        value={{ off: 'Aus', solar: 'Solar', min_solar: 'Min+Solar', fast: 'Schnell' }[state.charging_mode] ?? '–'}
        sub={charger.online ? 'Wallbox online' : 'Wallbox offline'}
        color={state.charging_mode === 'off' ? 'text-gray-400' : 'text-green-400'}
        icon="🎛️"
      />
    </div>
  )
}
