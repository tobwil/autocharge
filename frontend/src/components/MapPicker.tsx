import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default icon paths broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface Props {
  lat: number
  lon: number
  onChange: (lat: number, lon: number) => void
}

export default function MapPicker({ lat, lon, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView([lat, lon], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const marker = L.marker([lat, lon], { draggable: true }).addTo(map)

    marker.on('dragend', () => {
      const { lat: la, lng: lo } = marker.getLatLng()
      onChange(parseFloat(la.toFixed(6)), parseFloat(lo.toFixed(6)))
    })

    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat: la, lng: lo } = e.latlng
      marker.setLatLng(e.latlng)
      onChange(parseFloat(la.toFixed(6)), parseFloat(lo.toFixed(6)))
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, []) // only on mount

  // Pan + move marker when lat/lon props change externally (e.g. address search)
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    const current = markerRef.current.getLatLng()
    if (Math.abs(current.lat - lat) > 0.0001 || Math.abs(current.lng - lon) > 0.0001) {
      markerRef.current.setLatLng([lat, lon])
      mapRef.current.setView([lat, lon], 14)
    }
  }, [lat, lon])

  return (
    <div
      ref={containerRef}
      className="w-full h-56 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700"
    />
  )
}
