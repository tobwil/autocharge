export interface LocationConfig {
  lat: number
  lon: number
  altitude_m: number
  timezone: string
  address: string
}

export interface PVArrayConfig {
  name: string
  kwp: number
  tilt_deg: number
  azimuth_deg: number
  efficiency: number
}

export interface ChargingConfig {
  mode: string
  fixed_kw: number
  start_threshold_w: number
  stop_threshold_w: number
  min_amps: number
  max_amps: number
  phases: number
  phases_switching: boolean
  goe_ip: string
  buffer_fraction: number
  update_interval_s: number
}

export interface AppConfig {
  location: LocationConfig
  pv_arrays: PVArrayConfig[]
  charging: ChargingConfig
  weather_interval_s: number
  ocpp_port: number
}

export interface ChargerState {
  id: string
  status: string
  car_connected: boolean
  charging: boolean
  power_w: number
  energy_session_wh: number
  phases_actual: number
  amp_set: number
  amp_actual: number
  voltage: number
  transaction_id: number | null
  last_seen: number
  error: string | null
  vendor: string
  model: string
}

export interface ForecastPoint {
  time: string
  solar_w: number
  ghi: number
}

export interface AppState {
  ts: number
  solar_estimate_w: number
  available_for_ev_w: number
  ev_power_w: number
  charging_mode: string
  fixed_kw: number
  phases: number
  buffer_fraction: number
  chargers: ChargerState[]
  forecast: ForecastPoint[]
  ocpp_port: number
  weather_updated_at: number
  weather_next_at: number
}

export interface HistoryPoint {
  ts: number
  solar_w: number
  available_w: number
  ev_w: number
  mode: string
}
