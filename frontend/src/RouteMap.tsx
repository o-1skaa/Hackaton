import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import type { Route } from './services/api'
import geography from './assets/caspian-region.json'
import 'leaflet/dist/leaflet.css'

const colors: Record<string, string> = { main: '#087f78', alternative: '#db7a38' }
const countryLabels: [string, number, number][] = [
  ['РОССИЯ', 48.2, 43.8], ['КАЗАХСТАН', 46.5, 56.3], ['ИРАН', 32.8, 55.9],
  ['ТУРКМЕНИСТАН', 39.6, 59.4], ['ГРУЗИЯ', 42.1, 43], ['АЗЕРБАЙДЖАН', 40.4, 46.5],
]

export function RouteMap({ routes, selected, onSelect }: { routes: Route[]; selected: string; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const selection = useRef(onSelect)
  useEffect(() => { selection.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, {
      center: [38, 51], zoom: 4, scrollWheelZoom: false, zoomControl: false, attributionControl: false,
      minZoom: 4, maxZoom: 9, maxBounds: [[22, 35], [52, 66]], maxBoundsViscosity: 0.8,
    })
    map.current = instance
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(instance)
    L.control.attribution({ prefix: false, position: 'bottomleft' })
      .addAttribution('<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>')
      .addTo(instance)
    L.geoJSON(geography as GeoJsonObject, {
      interactive: false,
      style: { color: '#ccd9d3', weight: 1, fillColor: '#f3f5ed', fillOpacity: 1 },
    }).addTo(instance)
    for (const [name, lat, lng] of countryLabels) {
      L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: 'country-label', html: name, iconSize: [150, 20], iconAnchor: [75, 10] }) }).addTo(instance)
    }
    L.marker([41.8, 51.4], { interactive: false, icon: L.divIcon({ className: 'sea-label', html: 'Каспийское<br>море', iconSize: [100, 45], iconAnchor: [50, 22] }) }).addTo(instance)
    const observer = new ResizeObserver(() => instance.invalidateSize())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || !routes.length) return
    const layer = L.layerGroup().addTo(instance)
    const labels = L.layerGroup().addTo(instance)
    const activeRoute = routes.find(route => route.route_id === selected)
    const ordered = [...routes].sort((a, b) => Number(a.route_id === selected) - Number(b.route_id === selected))
    for (const route of ordered) {
      const active = route.route_id === selected
      // A wide transparent line is a comfortable touch target without thickening the visible route.
      L.polyline(route.waypoints, { color: colors[route.route_id], weight: 22, opacity: 0, interactive: true })
        .on('click', () => selection.current(route.route_id)).addTo(layer)
      L.polyline(route.waypoints, { color: '#fff', weight: active ? 8 : 6, opacity: active ? 0.95 : 0.55, interactive: false }).addTo(layer)
      L.polyline(route.waypoints, {
        color: colors[route.route_id], weight: active ? 4 : 3, opacity: active ? 1 : 0.5,
        dashArray: active ? undefined : '6 8', interactive: false,
      }).addTo(layer)
    }
    const stops = activeRoute?.legs.flatMap((leg, index) => leg.stops.slice(index ? 1 : 0)
      .map((name, i) => ({ point: leg.waypoints[i + (index ? 1 : 0)], name }))) ?? []
    const important = new Set([stops[0]?.name, stops.at(-1)?.name, 'Махачкала', 'Баку', 'Энзели'])
    for (const stop of stops) {
      const element = document.createElement('div')
      element.textContent = stop.name
      const icon = L.divIcon({ className: important.has(stop.name) ? 'map-stop key-stop' : 'map-stop', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] })
      L.marker(stop.point, { icon, title: stop.name, alt: stop.name, keyboard: true })
        .bindPopup(element, { closeButton: false, className: 'stop-popup' }).addTo(layer)
    }
    function drawLabels() {
      labels.clearLayers()
      const placed: {x:number; y:number; w:number; h:number}[] = []
      const size = instance!.getSize()
      const candidates = [...stops].sort((a,b) => Number(important.has(b.name))-Number(important.has(a.name)))
      for (const stop of candidates) {
        if (!important.has(stop.name) && instance!.getZoom() < 6) continue
        const point = instance!.latLngToContainerPoint(stop.point)
        const width = stop.name.length * 7 + 12
        const offsets = [[14,-12],[-width-14,-12],[14,10],[-width-14,10]]
        const offset = offsets.find(([x,y]) => {
          const box = { x:point.x+x, y:point.y+y, w:width, h:24 }
          return box.x>5 && box.y>5 && box.x+box.w<size.x-8 && box.y+box.h<size.y-8 &&
            !placed.some(p => box.x<p.x+p.w+8 && box.x+box.w+8>p.x && box.y<p.y+p.h+6 && box.y+box.h+6>p.y)
        })
        if (!offset) continue
        placed.push({x:point.x+offset[0], y:point.y+offset[1], w:width, h:24})
        const text = document.createElement('span'); text.textContent = stop.name
        L.marker(stop.point, { interactive:false, icon:L.divIcon({className:'stop-label', html:text, iconSize:[width,24], iconAnchor:[-offset[0],-offset[1]]}) }).addTo(labels)
      }
    }
    instance.on('zoomend moveend resize', drawLabels)
    drawLabels()
    return () => { instance.off('zoomend moveend resize', drawLabels); layer.remove(); labels.remove() }
  }, [routes, selected])

  useEffect(() => {
    if (!routes.length || !map.current) return
    const points = routes.flatMap(route => route.waypoints)
    map.current.fitBounds(L.latLngBounds(points), { paddingTopLeft: [55, 30], paddingBottomRight: [90, 35], maxZoom: 6, animate: false })
  }, [routes])

  function fitRoutes() {
    if (routes.length) map.current?.fitBounds(L.latLngBounds(routes.flatMap(route => route.waypoints)), { paddingTopLeft:[55,30], paddingBottomRight:[90,35], maxZoom:6 })
  }

  return <section className="route-map-section" aria-label="Карта маршрутов">
    <div className="map-route-controls" role="group" aria-label="Выбор маршрута">
      {routes.map(route => <button key={route.route_id} type="button" aria-pressed={route.route_id === selected} onClick={() => onSelect(route.route_id)}>
        <span className="route-dot" style={{ background: colors[route.route_id] }} />
        <span>{route.route_id === 'main' ? 'Через Махачкалу' : 'Через Баку'}</span>
        <strong>{route.eta_hours.toLocaleString('ru-RU', {maximumFractionDigits:1})} ч</strong>
      </button>)}
    </div>
    <div className="map-frame">
      <div className="route-map" ref={container} role="region" aria-label="Карта перевозки. Перемещайте карту, выбирайте маршрут или город." />
      <button className="map-reset" type="button" onClick={fitRoutes} aria-label="Показать весь маршрут" title="Весь маршрут">⌖</button>
      <span className="map-caption">Схема маршрутов</span>
    </div>
  </section>
}
