import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './services/api'
import type { Shipment, Detail, Route, Event, Prediction, Check } from './services/api'
import './App.css'
const labels: Record<string, string> = {pending:'Ожидает', in_transit:'В пути', completed:'Завершён', not_submitted:'Не отправлены', submitted:'Отправлены', approved:'Приняты', rejected:'Отклонены', low:'Низкий', medium:'Средний', high:'Высокий', prediction_updated:'Обновлён прогноз'}
const message = (e: unknown) => e instanceof Error ? e.message : 'Не удалось выполнить запрос'
const tabs = ['Обзор', 'Прогноз задержки', 'Маршруты', 'Документы', 'Журнал']
function App() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [tab, setTab] = useState('Обзор')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [online, setOnline] = useState(false)
  const [weather, setWeather] = useState(2)
  const [load, setLoad] = useState(50)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [key, setKey] = useState('demo-local-key')
  const [documents, setDocuments] = useState<{type: string; filename: string}[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [checkId, setCheckId] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([api<Shipment[]>('/api/shipments', undefined, undefined, controller.signal), api<{status:string}>('/health', undefined, undefined, controller.signal)])
      .then(([items]) => { setShipments(items); setSelected(current => current || items[0]?.id || ''); setOnline(true) })
      .catch(e => { if (!controller.signal.aborted) {setError(message(e)); setOnline(false)} })
      .finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    Promise.all([api<Detail>(`/api/shipments/${selected}`, undefined, undefined, controller.signal), api<Route[]>(`/api/routes/${selected}`, undefined, undefined, controller.signal), api<Event[]>(`/api/shipments/${selected}/events`, undefined, undefined, controller.signal)])
      .then(([d,r,e]) => {setDetail(d); setRoutes(r); setEvents(e)})
      .catch(e => {if (!controller.signal.aborted) setError(message(e))})
    return () => controller.abort()
  }, [selected, revision])
  function chooseShipment(id: string) {
    if (id === selected) return
    setDetail(null); setRoutes([]); setEvents([]); setPrediction(null); setCheck(null); setCheckId(''); setDocuments([]); setError(''); setSelected(id)
  }
  function reload() { setLoading(true); setError(''); setRevision(r=>r+1) }
  async function refreshDetail() {
    const [d,r,e] = await Promise.all([api<Detail>(`/api/shipments/${selected}`),api<Route[]>(`/api/routes/${selected}`),api<Event[]>(`/api/shipments/${selected}/events`)])
    setDetail(d); setRoutes(r); setEvents(e)
  }
  async function predict(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {setPrediction(await api<Prediction>('/api/predict', {shipment_id:selected, weather_severity:weather, port_load:load})); await refreshDetail()} catch(e) {setError(message(e))} finally {setBusy(false)}
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {const result = await api<Check>('/api/preclearance', {shipment_id:selected, documents}, key); setCheckId(result.check_id); setCheck(await api<Check>(`/api/preclearance/${result.check_id}`)); await refreshDetail()} catch(e) {setError(message(e))} finally {setBusy(false)}
  }
  async function lookup(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setCheck(null)
    try {setCheck(await api<Check>(`/api/preclearance/${encodeURIComponent(checkId.trim())}`))} catch(e) {setError(message(e))} finally {setBusy(false)}
  }
  const visible = shipments.filter(s => (filter === 'all' || s.status === filter) && `${s.id} ${s.name} ${s.origin} ${s.destination}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="Smart Caspian Transit"><span className="brand-mark">C</span><span>SMART CASPIAN<small>TRANSIT / OPERATIONS</small></span></a><div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>{tabs.map((t,i)=><button key={t} className={tab===t?'nav active':'nav'} onClick={()=>setTab(t)}><span>{['▦','↗','⇄','▤','◷'][i]}</span>{t}</button>)}<div className="sidebar-bottom"><span className="demo-dot"/> Демонстрационная среда<small>Каспийский транспортный коридор</small></div></aside>
    <main><header><div><span className="eyebrow">ЛОГИСТИЧЕСКАЯ ПЛАТФОРМА</span><h1>Центр управления перевозками</h1></div><div className="header-actions"><span className={online?'connection online':'connection'}>{online?'● API подключён':'○ Нет соединения'}</span><button onClick={reload} disabled={busy || loading}>Обновить ↻</button></div></header>
    <div className="demo-banner">ДЕМО <span>Синтетические данные · прогноз и проверка комплектности для демонстрации · состояние сбрасывается при перезапуске.</span></div>
    {error && <div role="alert" className="error">{error}<button onClick={reload}>Повторить</button></div>}
    <section className="metrics"><article><span>Всего перевозок</span><strong>{shipments.length}</strong><small>В текущей демонстрации</small></article><article><span>Грузы в пути</span><strong>{shipments.filter(s=>s.status==='in_transit').length}</strong><small>Активные перевозки</small></article><article><span>Ожидают отправки</span><strong>{shipments.filter(s=>s.status==='pending').length}</strong><small>Подготовка к перевозке</small></article><article><span>Завершены</span><strong>{shipments.filter(s=>s.status==='completed').length}</strong><small>Доставка выполнена</small></article></section>
    <div className="workspace"><section className="panel shipments"><div className="panel-heading"><h2>Перевозки</h2><span>{visible.length} из {shipments.length}</span></div><label className="sr-only" htmlFor="search">Поиск груза</label><input id="search" placeholder="Номер, груз или направление…" value={search} onChange={e=>setSearch(e.target.value)}/><label className="sr-only" htmlFor="status">Статус перевозки</label><select id="status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все статусы</option>{['pending','in_transit','completed'].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select><div className="shipment-list">{loading && <p className="empty">Загрузка перевозок…</p>}{!loading && !visible.length && <p className="empty">Грузы не найдены.</p>}{visible.map(s=><button disabled={busy} key={s.id} className={`shipment ${selected===s.id?'selected':''}`} onClick={()=>chooseShipment(s.id)}><div><span className="mono">{s.id}</span><span className={`badge ${s.status}`}>{labels[s.status]}</span></div><h3>{s.name}</h3><p>{s.origin} <span>→</span> {s.destination}</p></button>)}</div></section>
    <section className="panel detail">{!detail ? <div className="empty">{selected?'Загрузка карточки…':'Выберите перевозку'}</div> : <><div className="detail-heading"><div><span className="eyebrow">{detail.id} / КАРТОЧКА ПЕРЕВОЗКИ</span><h2>{detail.name}</h2><p>{detail.origin} <span className="arrow">→</span> {detail.destination}</p></div><span className={`badge ${detail.status}`}>{labels[detail.status]}</span></div><div className="tabs" role="tablist" aria-label="Разделы перевозки">{tabs.map(t=><button key={t} role="tab" aria-selected={t===tab} onClick={()=>setTab(t)}>{t}</button>)}</div><div className="tab-content">
    {tab==='Обзор' && <><div className="section-title"><h3>Этапы перевозки</h3><span>По данным груза</span></div><ol className="stages">{detail.stages.map((s,i)=><li key={i} className={s.status}><span>{s.status==='completed'?'✓':i+1}</span><div><strong>{s.name}</strong><small>{s.status==='current'?'Текущий этап':s.status==='completed'?'Выполнено':'Ожидается'}</small></div></li>)}</ol><div className="summary-grid"><article><span>Средняя историческая задержка</span><strong>{detail.historical_avg_delay_hours} ч</strong></article><article><span>Последний прогноз задержки</span><strong>{detail.last_delay_hours===null?'Не рассчитан':`${detail.last_delay_hours} ч`}</strong></article><article><span>Комплектность документов</span><strong>{labels[detail.preclearance_status]}</strong></article></div><button className="primary" onClick={()=>setTab('Прогноз задержки')}>Рассчитать прогноз →</button></>}
    {tab==='Прогноз задержки' && <><h3>Условия перевозки</h3><p className="muted">Задайте сценарий. Погодные данные вводятся вручную.</p><form onSubmit={predict}><label>Сложность погоды <b>{weather} / 5</b><input type="range" min="0" max="5" step="0.1" value={weather} onChange={e=>setWeather(Number(e.target.value))}/></label><div className="range-labels"><span>Благоприятная</span><span>Экстремальная</span></div><label>Загрузка порта <b>{load}%</b><input type="range" min="0" max="100" value={load} onChange={e=>setLoad(Number(e.target.value))}/></label><button className="primary" disabled={busy}>{busy?'Расчёт…':'Рассчитать задержку'}</button></form>{prediction && <div className={`result ${prediction.risk}`} role="status"><span>Прогноз задержки</span><strong>{prediction.delay_hours} ч</strong><p>Риск: {labels[prediction.risk]}</p><ul>{prediction.reasons.map(r=><li key={r}>{r}</li>)}</ul></div>}<p className="footnote">Прогноз обновляет ETA маршрутов и сохраняется в журнале.</p></>}
    {tab==='Маршруты' && <><div className="section-title"><h3>Сравнение маршрутов</h3><span>Задержка учтена в ETA</span></div>{!routes.length && <p>Нет доступных маршрутов.</p>}<div className="route-grid">{routes.map(r=><article className={r.recommended?'route recommended':'route'} key={r.route_id}><span className="badge">{r.recommended?'Рекомендуемый':'Альтернативный'}</span><h3>{r.name}</h3><dl><div><dt>Расстояние</dt><dd>{r.distance_km.toLocaleString('ru-RU')} км</dd></div><div><dt>ETA / длительность</dt><dd>{r.eta_hours} ч</dd></div><div><dt>Выбросы CO₂e</dt><dd>{r.co2_kg} кг</dd></div></dl><p>{r.reason}</p></article>)}</div><p className="footnote">Маршруты и выбросы — модельные оценки. Сервис не отслеживает GPS.</p></>}
    {tab==='Документы' && <><h3>Проверка комплектности</h3><p className="muted">Добавьте invoice и packing_list. Проверяются типы документов; файлы и их содержимое не отправляются.</p><form onSubmit={submit}><label>Демонстрационный API-ключ<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required/></label>{['invoice','packing_list'].map(type=><label className="file-row" key={type}>{type==='invoice'?'Инвойс (invoice)':'Упаковочный лист (packing_list)'}<input key={`${selected}-${type}`} type="file" onChange={e=>{const file=e.target.files?.[0]; setDocuments(d=>[...d.filter(x=>x.type!==type), ...(file?[{type,filename:file.name}]:[])])}}/></label>)}<button className="primary" disabled={busy || !documents.length}>{busy?'Проверка…':'Проверить документы'}</button></form><form className="lookup" onSubmit={lookup}><label>Открыть проверку по ID<input placeholder="CHK-…" value={checkId} onChange={e=>setCheckId(e.target.value)} required/></label><button disabled={busy || !checkId.trim()}>Найти проверку</button></form>{check && <div className={`result ${check.status}`} role="status"><span className="mono">{check.check_id} · {check.shipment_id}</span><h3>{labels[check.status]}</h3>{check.reasons.length?check.reasons.map(r=><p key={r}>{r}</p>):<p>Обязательные типы документов присутствуют.</p>}<ul>{check.documents.map((d,i)=><li key={i}>{d.type} — {d.filename}</li>)}</ul></div>}</>}
    {tab==='Журнал' && <><div className="section-title"><h3>История событий</h3><span>{events.length} событий</span></div>{!events.length?<div className="empty">Событий пока нет. Рассчитайте прогноз или проверьте документы.</div>:<ol className="event-list">{[...events].reverse().map((e,i)=><li key={`${e.timestamp}-${i}`}><time dateTime={e.timestamp}>{new Date(e.timestamp).toLocaleString('ru-RU')}</time><strong>{labels[e.event] ?? e.event}</strong><p>{e.details}</p></li>)}</ol>}</>}
    </div></>}</section></div><footer>SMART CASPIAN TRANSIT <span>Демонстрационный MVP / Каспийский цифровой форум 2026</span></footer></main></div>
}
export default App
