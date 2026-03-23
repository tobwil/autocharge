import React, { useEffect, useRef, useState } from 'react'
import { AppConfig, PVArrayConfig } from '../types'
import MapPicker from '../components/MapPicker'

const DEFAULT: AppConfig = {
  location: { lat: 48.1351, lon: 11.582, altitude_m: 520, timezone: 'Europe/Berlin', address: '' },
  pv_arrays: [{ name: 'Anlage 1', kwp: 10, tilt_deg: 30, azimuth_deg: 180, efficiency: 0.85 }],
  charging: {
    mode: 'solar', fixed_kw: 5.52,
    start_threshold_w: 1380, stop_threshold_w: 500,
    min_amps: 6, max_amps: 16, phases: 3,
    phases_switching: false, goe_ip: '',
    buffer_fraction: 0.10, update_interval_s: 30,
  },
  weather_interval_s: 900,
  ocpp_port: 9000,
}

const inputCls = 'w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-500'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function Num({ value, onChange, step, min, max }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number
}) {
  return <input type="number" step={step} min={min} max={max} value={value}
    onChange={e => onChange(Number(e.target.value))} className={inputCls} />
}

function Sel({ value, onChange, options }: {
  value: string | number; onChange: (v: string) => void
  options: { value: string | number; label: string }[]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

const AZIMUTH_PRESETS = [
  { value: 0,   label: 'Nord (0°)' },
  { value: 90,  label: 'Ost (90°)' },
  { value: 135, label: 'Südost (135°)' },
  { value: 180, label: 'Süd (180°)' },
  { value: 225, label: 'Südwest (225°)' },
  { value: 270, label: 'West (270°)' },
]

interface NominatimResult { display_name: string; lat: string; lon: string }

function LocationSection({
  cfg, setCfg,
}: {
  cfg: AppConfig
  setCfg: React.Dispatch<React.SetStateAction<AppConfig>>
}) {
  const [query, setQuery] = useState(cfg.location.address || '')
  const [results, setResults] = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
        { headers: { 'Accept-Language': 'de' } }
      )
      setResults(await r.json())
    } catch {}
    setSearching(false)
  }

  function pick(res: NominatimResult) {
    setCfg(c => ({
      ...c,
      location: { ...c.location, lat: parseFloat(res.lat), lon: parseFloat(res.lon), address: res.display_name },
    }))
    setQuery(res.display_name)
    setResults([])
  }

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
      <h2 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-4">Standort</h2>

      {/* Address search */}
      <div className="mb-4">
        <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Adresse suchen</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="z.B. Marienplatz, München"
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={search}
            disabled={searching}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shrink-0"
          >
            {searching ? '…' : '🔍 Suchen'}
          </button>
        </div>
        {results.length > 0 && (
          <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-lg">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 last:border-0 bg-white dark:bg-gray-900"
              >
                {r.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Interactive map */}
      <div className="mb-4">
        <p className="text-xs text-gray-400 mb-1">
          Marker ziehen oder auf Karte klicken zum Verfeinern ·{' '}
          Wetterdaten von{' '}
          <a href="https://open-meteo.com" target="_blank" rel="noreferrer"
             className="text-indigo-500 hover:underline">open-meteo.com</a>
          {' '}· Karte:{' '}
          <a href="https://www.openstreetmap.org" target="_blank" rel="noreferrer"
             className="text-indigo-500 hover:underline">OpenStreetMap</a>
        </p>
        <MapPicker
          lat={cfg.location.lat}
          lon={cfg.location.lon}
          onChange={(lat, lon) => setCfg(c => ({ ...c, location: { ...c.location, lat, lon } }))}
        />
      </div>

      {/* Coordinates (read-only / fine-tune) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Breitengrad">
          <Num value={cfg.location.lat} step={0.0001}
            onChange={v => setCfg(c => ({ ...c, location: { ...c.location, lat: v } }))} />
        </Field>
        <Field label="Längengrad">
          <Num value={cfg.location.lon} step={0.0001}
            onChange={v => setCfg(c => ({ ...c, location: { ...c.location, lon: v } }))} />
        </Field>
        <Field label="Zeitzone">
          <Sel value={cfg.location.timezone}
            onChange={v => setCfg(c => ({ ...c, location: { ...c.location, timezone: v } }))}
            options={[
              { value: 'Europe/Berlin', label: 'Europe/Berlin' },
              { value: 'Europe/Vienna', label: 'Europe/Vienna' },
              { value: 'Europe/Zurich', label: 'Europe/Zurich' },
            ]} />
        </Field>
      </div>
    </section>
  )
}

export default function Config() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setCfg(d)).catch(() => {})
  }, [])

  async function save() {
    setStatus('saving')
    try {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const d = await r.json()
      if (d.ok) { setStatus('saved'); setMsg('') }
      else { setStatus('error'); setMsg(d.error ?? 'Fehler') }
    } catch (e: any) {
      setStatus('error'); setMsg(e.message)
    }
    setTimeout(() => setStatus('idle'), 3000)
  }

  function patchArr(idx: number, patch: Partial<PVArrayConfig>) {
    setCfg(c => ({ ...c, pv_arrays: c.pv_arrays.map((a, i) => i === idx ? { ...a, ...patch } : a) }))
  }

  return (
    <div className="space-y-6">

      {/* Location with map */}
      <LocationSection cfg={cfg} setCfg={setCfg} />

      {/* PV Arrays */}
      {cfg.pv_arrays.map((arr, idx) => (
        <section key={idx} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
              PV-Anlage {idx + 1}
            </h2>
            {cfg.pv_arrays.length > 1 && (
              <button
                onClick={() => setCfg(c => ({ ...c, pv_arrays: c.pv_arrays.filter((_, i) => i !== idx) }))}
                className="text-xs text-red-500 hover:text-red-600"
              >Entfernen</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Bezeichnung">
              <input type="text" value={arr.name} onChange={e => patchArr(idx, { name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Nennleistung (kWp)">
              <Num value={arr.kwp} step={0.1} min={0.1} onChange={v => patchArr(idx, { kwp: v })} />
            </Field>
            <Field label="Neigung (°)" hint="0°=flach, 90°=senkrecht">
              <Num value={arr.tilt_deg} step={1} min={0} max={90} onChange={v => patchArr(idx, { tilt_deg: v })} />
            </Field>
            <Field label="Ausrichtung (Azimut)" hint="0°=N, 90°=O, 180°=S, 270°=W">
              <Sel value={arr.azimuth_deg} onChange={v => patchArr(idx, { azimuth_deg: Number(v) })}
                options={AZIMUTH_PRESETS} />
            </Field>
            <Field label="Systemeffizienz" hint="Wechselrichter + Temperatur + Kabel (0.80–0.92)">
              <Num value={arr.efficiency} step={0.01} min={0.5} max={1.0} onChange={v => patchArr(idx, { efficiency: v })} />
            </Field>
          </div>
        </section>
      ))}

      <button
        onClick={() => setCfg(c => ({
          ...c,
          pv_arrays: [...c.pv_arrays, { name: `Anlage ${c.pv_arrays.length + 1}`, kwp: 5, tilt_deg: 30, azimuth_deg: 180, efficiency: 0.85 }]
        }))}
        className="w-full py-2 text-sm text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-300 dark:border-indigo-800 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
      >
        + Weitere PV-Anlage hinzufügen
      </button>

      {/* Charging */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-4">Ladeparameter</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Puffer (%)" hint="Sicherheitsabzug vom Solar-Schätzwert (empfohlen: 10–15 %)">
            <Num value={cfg.charging.buffer_fraction * 100} step={1} min={0} max={30}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, buffer_fraction: v / 100 } }))} />
          </Field>
          <Field label="Feste Ladeleistung (kW)" hint="Genutzt im Fest-Modus (Dashboard)">
            <Num value={cfg.charging.fixed_kw} step={0.1} min={0.5} max={22}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, fixed_kw: v } }))} />
          </Field>
          <Field label="Start-Schwelle (W)" hint="Mindest-Solarertrag zum automatischen Starten">
            <Num value={cfg.charging.start_threshold_w}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, start_threshold_w: v } }))} />
          </Field>
          <Field label="Stopp-Schwelle (W)" hint="Solarertrag, unterhalb dem pausiert wird">
            <Num value={cfg.charging.stop_threshold_w}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, stop_threshold_w: v } }))} />
          </Field>
          <Field label="Min. Ladestrom (A)">
            <Num value={cfg.charging.min_amps} min={6} max={32}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, min_amps: v } }))} />
          </Field>
          <Field label="Max. Ladestrom (A)">
            <Num value={cfg.charging.max_amps} min={6} max={32}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, max_amps: v } }))} />
          </Field>
          <Field label="Phasen (max.)">
            <Sel value={cfg.charging.phases}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, phases: Number(v) } }))}
              options={[{ value: 1, label: '1-phasig (~3.7 kW)' }, { value: 3, label: '3-phasig (~11 kW)' }]} />
          </Field>
          <Field label="Automatische Phasenumschaltung"
            hint="Solar-Modus wechselt automatisch 1↔3 Phasen je nach verfügbarer Leistung">
            <label className="flex items-center gap-3 mt-1 cursor-pointer select-none">
              <div
                onClick={() => setCfg(c => ({ ...c, charging: { ...c.charging, phases_switching: !c.charging.phases_switching } }))}
                className={`relative w-10 h-6 rounded-full transition-colors ${cfg.charging.phases_switching ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.charging.phases_switching ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {cfg.charging.phases_switching
                  ? `An – lädt 1-phasig ab ${cfg.charging.min_amps * 230} W`
                  : 'Aus – immer ' + cfg.charging.phases + '-phasig'}
              </span>
            </label>
          </Field>
          {cfg.charging.phases_switching && (
            <Field label="go-e Wallbox IP (für Phasenumschaltung)"
              hint="Lokale IP der go-e Wallbox. Leer lassen wenn nicht benötigt.">
              <input
                type="text"
                value={cfg.charging.goe_ip}
                onChange={e => setCfg(c => ({ ...c, charging: { ...c.charging, goe_ip: e.target.value } }))}
                placeholder="z.B. 192.168.1.50"
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Regelintervall (s)">
            <Num value={cfg.charging.update_interval_s} min={10}
              onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, update_interval_s: v } }))} />
          </Field>
        </div>
      </section>

      {/* System */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">System</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Wetter-Update-Intervall (s)" hint="Empfohlen: 900 (15 min)">
            <Num value={cfg.weather_interval_s} min={300}
              onChange={v => setCfg(c => ({ ...c, weather_interval_s: v }))} />
          </Field>
          <Field label="OCPP-Port" hint="Wallbox verbindet sich auf diesen Port">
            <Num value={cfg.ocpp_port} min={1024} max={65535}
              onChange={v => setCfg(c => ({ ...c, ocpp_port: v }))} />
          </Field>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-between pb-4">
        <div>
          {status === 'saved' && <p className="text-green-600 dark:text-green-400 text-sm">✓ Gespeichert</p>}
          {status === 'error' && <p className="text-red-500 text-sm">✗ {msg}</p>}
        </div>
        <button
          onClick={save}
          disabled={status === 'saving'}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
        >
          {status === 'saving' ? 'Speichere…' : 'Speichern & Anwenden'}
        </button>
      </div>
    </div>
  )
}
