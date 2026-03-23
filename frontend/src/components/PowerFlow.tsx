/**
 * Energie-Fluss-Diagramm
 * Zeigt Solar, Haus, Netz, Auto (und optional Batterie) als SVG-Knoten
 * mit animierten Pfeilen die die Flussrichtung visualisieren.
 */

import React from 'react'
import { SystemState } from '../types'

interface Props {
  state: SystemState
}

function fmt(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`
  return `${Math.round(w)} W`
}

interface NodeProps {
  x: number
  y: number
  label: string
  sub: string
  icon: string
  color: string
  active?: boolean
}

function Node({ x, y, label, sub, icon, color, active }: NodeProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r={44} fill={color} opacity={active ? 0.18 : 0.08} />
      <circle r={44} fill="none" stroke={color} strokeWidth={active ? 2.5 : 1.5} opacity={active ? 0.9 : 0.4} />
      {active && <circle r={44} fill="none" stroke={color} strokeWidth={6} opacity={0.12} className="pulse-dot" />}
      <text textAnchor="middle" y={-12} fontSize={28} fill={color}>{icon}</text>
      <text textAnchor="middle" y={10} fontSize={13} fontWeight="600" fill={color}>{label}</text>
      <text textAnchor="middle" y={26} fontSize={11} fill={color} opacity={0.8}>{sub}</text>
    </g>
  )
}

interface ArrowProps {
  x1: number; y1: number; x2: number; y2: number
  power: number
  color: string
  reverse?: boolean
}

function FlowArrow({ x1, y1, x2, y2, power, color, reverse }: ArrowProps) {
  if (Math.abs(power) < 20) return null

  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const cls = reverse ? 'flow-line-rev' : 'flow-line'
  const opacity = Math.min(1, 0.4 + Math.abs(power) / 10000)

  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={Math.max(2, Math.min(6, Math.abs(power) / 800))}
        strokeLinecap="round"
        opacity={opacity}
        className={cls}
      />
      <text x={mx} y={my - 8} textAnchor="middle" fontSize={11} fill={color} fontWeight="600">
        {fmt(Math.abs(power))}
      </text>
    </g>
  )
}

export default function PowerFlow({ state }: Props) {
  const { solar_w, grid_w, load_w, battery_w, ev_w, charger, inverters } = state

  // grid_w: positive = export, negative = import
  const gridImport = grid_w < 0 ? Math.abs(grid_w) : 0
  const gridExport = grid_w > 0 ? grid_w : 0

  const hasBattery = inverters.some(inv => inv.battery_soc_pct !== null)
  const battSoc = inverters.find(inv => inv.battery_soc_pct !== null)?.battery_soc_pct ?? null
  const battCharge = battery_w > 0  // positive = charging battery

  // Layout positions
  const W = 700, H = hasBattery ? 360 : 300
  const solarX = 350, solarY = 70
  const houseX = 350, houseY = hasBattery ? 230 : 210
  const gridX = 100, gridY = hasBattery ? 230 : 210
  const evX = 600, evY = hasBattery ? 230 : 210
  const battX = 350, battY = 320

  const nodeDist = 44 // radius

  return (
    <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">Energiefluss</h2>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 360 }}
      >
        {/* Solar → House */}
        <FlowArrow
          x1={solarX} y1={solarY + nodeDist}
          x2={houseX} y2={houseY - nodeDist}
          power={solar_w}
          color="#f59e0b"
        />

        {/* Grid ↔ House */}
        <FlowArrow
          x1={gridX + nodeDist} y1={gridY}
          x2={houseX - nodeDist} y2={houseY}
          power={gridImport}
          color="#6366f1"
          reverse
        />
        <FlowArrow
          x1={houseX - nodeDist} y1={houseY}
          x2={gridX + nodeDist} y2={gridY}
          power={gridExport}
          color="#6366f1"
        />

        {/* House → EV */}
        <FlowArrow
          x1={houseX + nodeDist} y1={houseY}
          x2={evX - nodeDist} y2={evY}
          power={ev_w}
          color="#10b981"
        />

        {/* Battery ↔ House */}
        {hasBattery && (
          <>
            <FlowArrow
              x1={houseX} y1={houseY + nodeDist}
              x2={battX} y2={battY - nodeDist}
              power={battCharge ? Math.abs(battery_w) : 0}
              color="#3b82f6"
            />
            <FlowArrow
              x1={battX} y1={battY - nodeDist}
              x2={houseX} y2={houseY + nodeDist}
              power={!battCharge ? Math.abs(battery_w) : 0}
              color="#3b82f6"
              reverse
            />
          </>
        )}

        {/* Nodes */}
        <Node
          x={solarX} y={solarY}
          label="Solar"
          sub={fmt(solar_w)}
          icon="☀️"
          color="#f59e0b"
          active={solar_w > 50}
        />
        <Node
          x={houseX} y={houseY}
          label="Haus"
          sub={fmt(load_w)}
          icon="🏠"
          color="#8b5cf6"
          active={load_w > 50}
        />
        <Node
          x={gridX} y={gridY}
          label={gridExport > 50 ? 'Einspeisung' : 'Netz'}
          sub={gridExport > 50 ? `+${fmt(gridExport)}` : gridImport > 50 ? `-${fmt(gridImport)}` : '~0 W'}
          icon="🔌"
          color="#6366f1"
          active={gridImport > 50 || gridExport > 50}
        />
        <Node
          x={evX} y={evY}
          label={charger.car_connected ? 'Auto' : 'Wallbox'}
          sub={charger.charging ? fmt(ev_w) : charger.car_connected ? 'Bereit' : 'Frei'}
          icon={charger.car_connected ? '🚗' : '🔋'}
          color="#10b981"
          active={charger.charging}
        />
        {hasBattery && (
          <Node
            x={battX} y={battY}
            label="Speicher"
            sub={battSoc !== null ? `${battSoc.toFixed(0)}%` : '–'}
            icon="🔋"
            color="#3b82f6"
            active={Math.abs(battery_w) > 50}
          />
        )}
      </svg>
    </div>
  )
}
