import React from 'react'
import { InverterState } from '../types'

interface Props { inverters: InverterState[] }

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function InverterCards({ inverters }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {inverters.map(inv => (
        <div
          key={inv.id}
          className={`bg-gray-900 border rounded-xl p-4 ${inv.online ? 'border-gray-800' : 'border-red-900 opacity-60'}`}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-white">{inv.name}</div>
              <div className="text-xs text-gray-500">{inv.id} · {inv.online ? 'Online' : 'Offline'}</div>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${inv.online ? 'bg-green-400' : 'bg-red-500'}`} />
          </div>

          {inv.error && (
            <div className="text-xs text-red-400 mb-2 bg-red-900/20 rounded px-2 py-1">{inv.error}</div>
          )}

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">PV-Leistung</span>
                <span className="text-yellow-400 font-bold">
                  {inv.pv_power_w >= 1000 ? `${(inv.pv_power_w / 1000).toFixed(2)} kW` : `${Math.round(inv.pv_power_w)} W`}
                </span>
              </div>
              <Bar value={inv.pv_power_w} max={6000} color="bg-yellow-400" />
            </div>

            {inv.battery_soc_pct !== null && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">Batteriestand</span>
                  <span className="text-blue-400 font-bold">{inv.battery_soc_pct?.toFixed(0)}%</span>
                </div>
                <Bar value={inv.battery_soc_pct ?? 0} max={100} color="bg-blue-400" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {inv.grid_power_w !== 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Netz</span>
                  <span className={inv.grid_power_w > 0 ? 'text-indigo-400' : 'text-red-400'}>
                    {inv.grid_power_w > 0 ? '+' : ''}{Math.round(inv.grid_power_w)} W
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
