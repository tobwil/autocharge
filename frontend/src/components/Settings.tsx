import React, { useEffect, useRef, useState } from 'react'
import { AppConfig, MqttConfig, SungrowConfig } from '../types'

interface Props {
  onClose: () => void
}

interface DiscoveredDevice {
  ip: string
  type: 'goe' | 'sungrow'
  name: string
  details: Record<string, unknown>
}

function DiscoveryPanel({ onApply }: { onApply: (devices: DiscoveredDevice[]) => void }) {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function startScan() {
    setStatus('scanning')
    setDevices([])
    await fetch('/api/discover?background=true')

    // Poll for result every 2s
    pollRef.current = setInterval(async () => {
      const res = await fetch('/api/discover/result')
      const data = await res.json()
      if (data.status === 'done') {
        clearInterval(pollRef.current!)
        setDevices(data.devices)
        setStatus('done')
      }
    }, 2000)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  return (
    <div className="bg-gray-800 rounded-xl p-4 mb-6 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-white text-sm">Geräte im Netzwerk suchen</div>
          <div className="text-xs text-gray-500">Scannt das lokale /24-Subnetz (~10 Sekunden)</div>
        </div>
        <button
          onClick={startScan}
          disabled={status === 'scanning'}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-wait text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          {status === 'scanning' ? (
            <><span className="animate-spin inline-block">⟳</span> Suche läuft…</>
          ) : '🔍 Suchen'}
        </button>
      </div>

      {status === 'done' && devices.length === 0 && (
        <p className="text-sm text-gray-500">Keine Geräte gefunden. IPs manuell eintragen.</p>
      )}

      {devices.length > 0 && (
        <div className="space-y-2">
          {devices.map(d => (
            <div key={d.ip} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">{d.name}</div>
                <div className="text-xs text-gray-500">
                  {d.ip}
                  {d.type === 'sungrow' && ` · ${(d.details.model_series as string)} · Slave ${d.details.slave_id}`}
                  {d.type === 'goe' && d.details.serial ? ` · S/N ${d.details.serial}` : ''}
                </div>
              </div>
              <button
                onClick={() => onApply([d])}
                className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg"
              >
                Übernehmen
              </button>
            </div>
          ))}
          <button
            onClick={() => onApply(devices)}
            className="w-full mt-1 text-sm px-3 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg font-semibold"
          >
            Alle übernehmen
          </button>
        </div>
      )}
    </div>
  )
}

const DEFAULT_CFG: AppConfig = {
  inverters: [
    { id: 'inv1', name: 'Wechselrichter 1', host: '192.168.1.100', port: 502, slave_id: 1, model_series: 'SH', enabled: true },
    { id: 'inv2', name: 'Wechselrichter 2', host: '192.168.1.101', port: 502, slave_id: 1, model_series: 'SH', enabled: true },
  ],
  charger: { host: '192.168.1.200', api_version: 2, enabled: true },
  charging: {
    mode: 'solar',
    start_threshold_w: 1380,
    stop_threshold_w: 500,
    min_amps: 6,
    max_amps: 16,
    phases: 3,
    update_interval_s: 10,
    grid_voltage: 230,
    buffer_fraction: 0.05,
  },
  poll_interval_s: 5,
  mqtt: { enabled: false, host: '', port: 1883, username: '', password: '', topic: 'sungrow/#', name: 'MQTT Wechselrichter' },
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-gray-400 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}

function Input({ value, onChange, type = 'text', step }: {
  value: string | number; onChange: (v: string) => void; type?: string; step?: string
}) {
  return (
    <input
      type={type}
      step={step}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
    />
  )
}

function Select({ value, onChange, options }: {
  value: string | number; onChange: (v: string) => void
  options: { value: string | number; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function Settings({ onClose }: Props) {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CFG)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  const [testing, setTesting] = useState<string | null>(null)

  async function testConnection(id: string, url: string) {
    setTesting(id)
    try {
      const res = await fetch(url)
      const data = await res.json()
      setTestResults(r => ({ ...r, [id]: data }))
    } catch (e: any) {
      setTestResults(r => ({ ...r, [id]: { reachable: false, error: e.message } }))
    } finally {
      setTesting(null)
    }
  }

  function TestResult({ id }: { id: string }) {
    const r = testResults[id]
    if (!r) return null
    if (r.reachable) {
      return (
        <div className="mt-2 bg-green-900/30 border border-green-700 rounded-lg p-3 text-xs">
          <div className="text-green-400 font-semibold mb-1">✓ Verbunden</div>
          <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(r.raw ?? r.registers, null, 2)}
          </pre>
        </div>
      )
    }
    return (
      <div className="mt-2 bg-red-900/30 border border-red-700 rounded-lg p-3 text-xs">
        <div className="text-red-400 font-semibold mb-1">✗ Verbindungsfehler</div>
        <div className="text-gray-300">{r.error}</div>
      </div>
    )
  }

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => setCfg(c))
      .catch(() => {})
  }, [])

  function updateInverter(idx: number, patch: Partial<SungrowConfig>) {
    setCfg(c => ({
      ...c,
      inverters: c.inverters.map((inv, i) => i === idx ? { ...inv, ...patch } : inv),
    }))
  }

  function applyDiscovered(devices: DiscoveredDevice[]) {
    const goe = devices.filter(d => d.type === 'goe')
    const sungrow = devices.filter(d => d.type === 'sungrow')

    setCfg(c => {
      let next = { ...c }

      // go-e: nimm das erste gefundene Gerät
      if (goe.length > 0) {
        next = { ...next, charger: { ...next.charger, host: goe[0].ip, enabled: true } }
      }

      // Sungrow: verteile auf Wechselrichter-Slots
      if (sungrow.length > 0) {
        const newInverters = [...next.inverters]
        sungrow.forEach((d, i) => {
          if (i < newInverters.length) {
            newInverters[i] = {
              ...newInverters[i],
              host: d.ip,
              enabled: true,
              model_series: (d.details.model_series as 'SH' | 'SG') ?? 'SH',
              slave_id: (d.details.slave_id as number) ?? 1,
            }
          }
        })
        next = { ...next, inverters: newInverters }
      }

      return next
    })
  }

  async function save() {
    setError(null)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 overflow-y-auto py-8 px-4">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Einstellungen</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-8">
          {/* MQTT / Inverter Source */}
          <section>
            <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-3">Wechselrichter-Datenquelle</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Datenquelle" hint="MQTT-Broker statt direktem Modbus nutzen">
                <Select
                  value={cfg.mqtt.enabled ? 'true' : 'false'}
                  onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, enabled: v === 'true' } }))}
                  options={[
                    { value: 'false', label: 'Lokal (Modbus direkt)' },
                    { value: 'true', label: 'MQTT (lokaler Broker)' },
                  ]}
                />
              </Field>
              {cfg.mqtt.enabled && <>
                <Field label="Anzeigename" hint="Name in der Übersicht">
                  <Input value={cfg.mqtt.name}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, name: v } }))} />
                </Field>
                <Field label="Broker-IP / Hostname">
                  <Input value={cfg.mqtt.host}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, host: v } }))} />
                </Field>
                <Field label="Port" hint="Standard: 1883">
                  <Input type="number" value={cfg.mqtt.port}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, port: Number(v) } }))} />
                </Field>
                <Field label="Benutzername" hint="Leer lassen wenn kein Auth">
                  <Input value={cfg.mqtt.username}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, username: v } }))} />
                </Field>
                <Field label="Passwort">
                  <Input type="password" value={cfg.mqtt.password}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, password: v } }))} />
                </Field>
                <Field label="Topic" hint="z.B. sungrow/# oder tele/inverter/SENSOR">
                  <Input value={cfg.mqtt.topic}
                    onChange={v => setCfg(c => ({ ...c, mqtt: { ...c.mqtt, topic: v } }))} />
                </Field>
              </>}
            </div>
          </section>

          {/* Network Discovery (only relevant for local Modbus mode) */}
          {!cfg.mqtt.enabled && <DiscoveryPanel onApply={applyDiscovered} />}

          {/* Inverters (only relevant for local Modbus mode) */}
          {!cfg.mqtt.enabled && cfg.inverters.map((inv, idx) => (
            <section key={inv.id}>
              <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-3">
                Sungrow {inv.name}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name">
                  <Input value={inv.name} onChange={v => updateInverter(idx, { name: v })} />
                </Field>
                <Field label="IP-Adresse">
                  <Input value={inv.host} onChange={v => updateInverter(idx, { host: v })} />
                </Field>
                <Field label="Modbus-Port" hint="Standard: 502">
                  <Input type="number" value={inv.port} onChange={v => updateInverter(idx, { port: Number(v) })} />
                </Field>
                <Field label="Slave-ID" hint="Standard: 1">
                  <Input type="number" value={inv.slave_id} onChange={v => updateInverter(idx, { slave_id: Number(v) })} />
                </Field>
                <Field label="Modell-Serie" hint="SH = Hybrid (mit Batterie), SG = String">
                  <Select
                    value={inv.model_series}
                    onChange={v => updateInverter(idx, { model_series: v as 'SG' | 'SH' })}
                    options={[{ value: 'SH', label: 'SH – Hybrid-Wechselrichter' }, { value: 'SG', label: 'SG – String-Wechselrichter' }]}
                  />
                </Field>
                <Field label="Aktiviert">
                  <Select
                    value={inv.enabled ? 'true' : 'false'}
                    onChange={v => updateInverter(idx, { enabled: v === 'true' })}
                    options={[{ value: 'true', label: 'Ja' }, { value: 'false', label: 'Nein' }]}
                  />
                </Field>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => testConnection(
                    inv.id,
                    `/api/test/sungrow?host=${inv.host}&port=${inv.port}&slave_id=${inv.slave_id}&series=${inv.model_series}`
                  )}
                  disabled={testing === inv.id}
                  className="px-4 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg font-semibold"
                >
                  {testing === inv.id ? '⟳ Teste…' : '🔌 Verbindung testen'}
                </button>
                {testResults[inv.id] && (
                  <span className={testResults[inv.id].reachable ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                    {testResults[inv.id].reachable ? '✓ Erreichbar' : '✗ Nicht erreichbar'}
                  </span>
                )}
              </div>
              <TestResult id={inv.id} />
            </section>
          ))}

          {/* Charger */}
          <section>
            <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-3">go-e Wallbox</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="IP-Adresse">
                <Input value={cfg.charger.host} onChange={v => setCfg(c => ({ ...c, charger: { ...c.charger, host: v } }))} />
              </Field>
              <Field label="Aktiviert">
                <Select
                  value={cfg.charger.enabled ? 'true' : 'false'}
                  onChange={v => setCfg(c => ({ ...c, charger: { ...c.charger, enabled: v === 'true' } }))}
                  options={[{ value: 'true', label: 'Ja' }, { value: 'false', label: 'Nein' }]}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => testConnection('goe', `/api/test/goe?host=${cfg.charger.host}`)}
                disabled={testing === 'goe'}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg font-semibold"
              >
                {testing === 'goe' ? '⟳ Teste…' : '🔌 Verbindung testen'}
              </button>
              {testResults['goe'] && (
                <span className={testResults['goe'].reachable ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                  {testResults['goe'].reachable ? '✓ Erreichbar' : '✗ Nicht erreichbar'}
                </span>
              )}
            </div>
            <TestResult id="goe" />
          </section>

          {/* Charging */}
          <section>
            <h3 className="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-3">Lade-Parameter</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Min. Überschuss zum Starten (W)" hint="Standard: 1380 W (= 6A × 230V)">
                <Input type="number" value={cfg.charging.start_threshold_w}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, start_threshold_w: Number(v) } }))} />
              </Field>
              <Field label="Stopp-Schwellwert (W)" hint="Unter diesem Wert wird pausiert">
                <Input type="number" value={cfg.charging.stop_threshold_w}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, stop_threshold_w: Number(v) } }))} />
              </Field>
              <Field label="Min. Ladestrom (A)" hint="Minimum: 6A (Norm)">
                <Input type="number" value={cfg.charging.min_amps}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, min_amps: Number(v) } }))} />
              </Field>
              <Field label="Max. Ladestrom (A)" hint="go-e Gemini 2: max 16A">
                <Input type="number" value={cfg.charging.max_amps}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, max_amps: Number(v) } }))} />
              </Field>
              <Field label="Phasen" hint="1P ≈ 3.7 kW, 3P ≈ 11 kW max">
                <Select value={cfg.charging.phases}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, phases: Number(v) as 1 | 3 } }))}
                  options={[{ value: 1, label: '1-phasig' }, { value: 3, label: '3-phasig' }]}
                />
              </Field>
              <Field label="Puffer (% Reserve)" hint="z.B. 0.05 = 5% Reserve">
                <Input type="number" step="0.01" value={cfg.charging.buffer_fraction}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, buffer_fraction: Number(v) } }))} />
              </Field>
              <Field label="Update-Intervall (s)" hint="Wie oft der Ladestrom angepasst wird">
                <Input type="number" value={cfg.charging.update_interval_s}
                  onChange={v => setCfg(c => ({ ...c, charging: { ...c.charging, update_interval_s: Number(v) } }))} />
              </Field>
              <Field label="Abfrageintervall (s)" hint="Wie oft Geräte abgefragt werden">
                <Input type="number" value={cfg.poll_interval_s}
                  onChange={v => setCfg(c => ({ ...c, poll_interval_s: Number(v) }))} />
              </Field>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-gray-800">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {saved && <p className="text-green-400 text-sm">Gespeichert ✓</p>}
          {!error && !saved && <div />}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Abbrechen</button>
            <button onClick={save} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold">
              Speichern & Anwenden
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
