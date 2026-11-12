import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { Route } from './services/api'
import 'leaflet/dist/leaflet.css'

const colors: Record<string, string> = { main: '#168780', alternative: '#d97724' }

export function RouteMap({ routes, selected, onSelect }: { routes: Route[]; selected: string; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, { scrollWheelZoom: false })
    map.current = instance
    const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
    }).addTo(instance)
    tiles.on('tileerror', () => setTileError(true))
    L.control.scale({ imperial: false }).addTo(instance)
    const observer = new ResizeObserver(() => instance.invalidateSize())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const layer = L.layerGroup().addTo(instance)
    // Draw the selected route last so shared segments stay clickable and visible.
    const ordered = [...routes].sort((a, b) => Number(a.route_id === selected) - Number(b.route_id === selected))
    for (const route of ordered) {
      const active = route.route_id === selected
      const line = L.polyline(route.waypoints, {
        color: colors[route.route_id] || '#64748b', weight: active ? 6 : 4,
        opacity: active ? 1 : 0.5, dashArray: active ? undefined : '8 8',
      }).addTo(layer)
      line.bindTooltip(`${route.name} · ETA ${route.eta_hours} ч`)
      line.on('click', () => onSelect(route.route_id))
      if (active) {
        const stops = route.legs.flatMap((leg, index) => leg.stops.slice(index ? 1 : 0).map((name, i) => ({point: leg.waypoints[i + (index ? 1 : 0)], name})))
        for (const stop of stops) {
          const marker = L.circleMarker(stop.point, { radius: 7, color: '#fff', weight: 2, fillColor: colors[route.route_id], fillOpacity: 1 }).addTo(layer)
          const popup = document.createElement('div')
          popup.textContent = `${stop.name}. ETA маршрута: ${route.eta_hours} ч.`
          marker.bindPopup(popup).bindTooltip(stop.name, {permanent:true, direction:"top"})
        }
      }
    }
    return () => { layer.remove() }
  }, [routes, selected, onSelect])

  useEffect(() => {
    const route = routes.find(item => item.route_id === selected)
    if (route && map.current) map.current.fitBounds(L.latLngBounds(route.waypoints), { padding: [30, 30] })
  }, [routes, selected])

  function fitRoutes() {
    const points = routes.flatMap(route => route.waypoints)
    if (points.length) map.current?.fitBounds(L.latLngBounds(points), { padding: [30, 30] })
  }

  return <section className="route-map-section" aria-label="Карта маршрутов">
    <div className="section-title"><h3>Карта маршрутов</h3><button type="button" onClick={fitRoutes}>Показать оба</button></div>
    <div className="map-route-controls">{routes.map(route => <button key={route.route_id} type="button" aria-pressed={route.route_id === selected} onClick={() => onSelect(route.route_id)}><span style={{ background: colors[route.route_id] }} />{route.route_id === 'main' ? 'Основной · Махачкала' : 'Альтернативный · Баку'} · {route.eta_hours.toLocaleString('ru-RU')} ч</button>)}</div>
    <div className="route-map" ref={container} role="region" aria-label="Интерактивная карта: перетаскивайте для перемещения, используйте плюс и минус для масштаба" />
    {tileError && <p className="notice" role="status">Не удалось загрузить подложку карты. Проверьте интернет; линии маршрутов и переключение доступны.</p>}
    <p className="footnote">Двигайте карту мышью, меняйте масштаб кнопками + / −, нажимайте на точки и линии. Русские подписи остановок. Расстояние считается по той же схематичной линии, что показана на карте.</p>
  </section>
}
