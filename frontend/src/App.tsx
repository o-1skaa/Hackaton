import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './services/api'
import type { Shipment, Detail, Route, Event, Prediction, Check, PredictionContext } from './services/api'
import { buildPredictionRequest, validatePrediction } from './services/prediction'
import { RouteMap } from './RouteMap'
import { OperationsPanel } from './OperationsPanel'
import type { Operations } from './services/api'
import './App.css'

const labels: Record<string, string> = {pending:'Ожидает', in_transit:'В пути', completed:'Завершён', not_submitted:'Не отправлены', submitted:'Отправлены', verified:'Проверено', approved:'Pre-clearance пройдено (демо)', route_applied:'Применён маршрут', error:'Ошибка', rejected:'Отклонены', low:'Низкий', medium:'Средний', high:'Высокий', prediction_updated:'Обновлён прогноз'}
const pages = [
  { id: 'monitor', title: 'Перевозки', icon: 'box' },
  { id: 'documents', title: 'Документы', icon: 'file' },
  { id: 'events', title: 'Журнал', icon: 'history' },
] as const
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'
const hours = (value: number) => `${value.toLocaleString('ru-RU', {maximumFractionDigits: 1})} ч`
const number = (n:number) => n.toLocaleString('ru-RU', {maximumFractionDigits:1})
const date = (s:string) => new Date(s).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
const icons:Record<string,string> = {
  box:'M12 3 3 8v9l9 5 9-5V8l-9-5ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5',
  file:'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h6',
  history:'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2',
  plus:'M12 5v14M5 12h14',refresh:'M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 12-2L20 9M4 15l2.5 3a7 7 0 0 0 12-2',
  arrow:'M4 12h16M14 6l6 6-6 6',close:'m6 6 12 12M6 18 18 6',chevron:'m7 10 5 5 5-5',
}
function Icon({name}:{name:string}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]||icons.box}/></svg>
}
type Forecast = {results:Prediction[]; baseline:Route[]}
function ShipmentDialog({busy,onClose,onSave,error}:{busy:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void;error:string}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>previous?.focus()},[])
  const [now]=useState(()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16))
  return <dialog ref={ref} className="shipment-dialog" aria-labelledby="new-shipment-title" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <div className="dialog-heading"><h2 id="new-shipment-title">Новая отправка</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Закрыть"><Icon name="close"/></button></div>
    <p className="dialog-direction">Астрахань <Icon name="arrow"/> Бендер-Аббас</p>
    {error&&<p role="alert" className="error">{error}</p>}
    <form onSubmit={onSave}><fieldset disabled={busy}>
      <label>Название груза<input name="name" placeholder="Например, оборудование" required maxLength={120} autoFocus/></label>
      <div className="form-row"><label>Масса, т<input name="weight" type="number" min="0.01" max="10000" step="0.01" defaultValue="20" required/></label><label>Дата и время отправления<input name="departure" type="datetime-local" defaultValue={now} required/></label></div>
      <details className="form-conditions"><summary>Условия перевозки</summary><div className="form-row">{[
        {name:'weather',label:'Погода, 0–5',max:5,value:3},{name:'load',label:'Загрузка порта, %',max:100,value:70},
        {name:'rail',label:'Опоздание поезда, ч',max:720,value:4},{name:'wind',label:'Ветер, м/с',max:100,value:10},{name:'wave',label:'Волны, м',max:30,value:1},
      ].map(field=><label key={field.name}>{field.label}<input name={field.name} type="number" min="0" max={field.max} step="0.1" defaultValue={field.value} required/></label>)}</div></details>
      <div className="dialog-actions"><button type="button" onClick={onClose}>Отмена</button><button className="primary" type="submit">{busy?'Сохраняем…':'Добавить отправку'}</button></div>
    </fieldset></form>
  </dialog>
}
function RouteDetails({route,baseline}:{route:Route;baseline?:Route}) {
  return <div>
    {route.transfer.applicable&&route.transfer.missed_ferry&&<div className="transfer-alert"><span className="transfer-icon">!</span><div><strong>Паром пропущен · срок сдвинут на {hours(route.transfer.delay_hours)}</strong><p>Следующий рейс через {hours(route.transfer.wait_hours)} после подготовки груза.</p></div></div>}
    <details className="disclosure"><summary>Этапы и стыковка</summary><div className="disclosure-content">
      {route.transfer.applicable?<ol className="connection-steps"><li><span>1</span><div>Прибытие поезда<strong>Через {hours(route.transfer.actual_train_arrival_hours)} от отправления</strong></div></li><li><span>2</span><div>{route.transfer.missed_ferry?'Плановый паром пропущен':'Посадка на плановый паром'}<strong>Отправление парома на {number(route.transfer.ferry_departure_hours)}-м часу</strong></div></li><li><span>3</span><div>Доставка<strong>{date(route.eta_at)}</strong></div></li></ol>:<p>Железная дорога до Баку, далее автотранспорт. Паром на этом маршруте не нужен.</p>}
      {baseline&&<p className="muted">Срок до расчёта: {hours(baseline.eta_hours)}. Сейчас: {hours(route.eta_hours)}.</p>}
    </div></details>
    <details className="disclosure"><summary>Расстояния и выбросы</summary><div className="disclosure-content table-scroll"><table><thead><tr><th>Участок</th><th>км</th><th>кг CO₂e</th></tr></thead><tbody>{route.legs.map((leg,i)=><tr key={i}><td>{leg.stops[0]} → {leg.stops.at(-1)}<small>{({rail:'Железная дорога',ferry:'Паром',road:'Автотранспорт'})[leg.mode]}</small></td><td>{number(leg.distance_km)}</td><td>{number(leg.co2_kg)}</td></tr>)}</tbody></table><p className="muted">Выбросы = расстояние × масса × коэффициент транспорта. Геометрия и коэффициенты учебные.</p></div></details>
  </div>
}

function App() {
  const [operations, setOperations] = useState<Operations|null>(null)
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [page, setPage] = useState<(typeof pages)[number]['id']>('monitor')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [online, setOnline] = useState(false)
  const [routeId, setRouteId] = useState('main')
  const [context, setContext] = useState<PredictionContext | null>(null)
  const [contextError, setContextError] = useState('')
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [key, setKey] = useState('demo-local-key')
  const [documents, setDocuments] = useState<{type: string; filename: string; content:string}[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [checkId, setCheckId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      api<Shipment[]>('/api/shipments', undefined, undefined, controller.signal),
      api<{status:string}>('/health', undefined, undefined, controller.signal),
    ]).then(([items]) => {
      if (controller.signal.aborted) return
      setShipments(items); setDetailLoading(items.length > 0); setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id || '')
      setOnline(true)
    }).catch(error => {
      if (!controller.signal.aborted) {setError(message(error)); setOnline(false)}
    }).finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    Promise.all([
      api<Detail>(`/api/shipments/${encodeURIComponent(selected)}`, undefined, undefined, controller.signal),
      api<Operations>(`/api/shipments/${encodeURIComponent(selected)}/operations`, undefined, undefined, controller.signal),
            api<Event[]>(`/api/shipments/${encodeURIComponent(selected)}/events`, undefined, undefined, controller.signal),
    ]).then(async ([d, o, e]) => {
      if (controller.signal.aborted) return
      setDetail(d); setOperations(o); setRoutes(o.routes); setEvents(e)
      setRouteId(o.twin.route_id)
      if(d.latest_check_id){
        const saved=await api<Check>(`/api/preclearance/${d.latest_check_id}`,undefined,undefined,controller.signal)
        if(!controller.signal.aborted){setCheck(saved);setCheckId(saved.check_id)}
      }
    }).catch(error => {if (!controller.signal.aborted) setError(message(error))})
      .finally(() => {if (!controller.signal.aborted) setDetailLoading(false)})
    return () => controller.abort()
  }, [selected, revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    api<PredictionContext>(`/api/prediction-context/${encodeURIComponent(selected)}`, undefined, undefined, controller.signal)
      .then(value => {if (!controller.signal.aborted) {setContext(value); setContextError('')}})
      .catch(error => {if (!controller.signal.aborted) setContextError(message(error))})
    return () => controller.abort()
  }, [selected, revision])

  useEffect(()=>{
    if(!selected||busy)return
    const controller=new AbortController()
    const timer=setInterval(()=>{
      api<Operations>(`/api/shipments/${encodeURIComponent(selected)}/operations`,undefined,undefined,controller.signal)
        .then(o=>{if(!controller.signal.aborted){setOperations(o);setRoutes(o.routes)}})
        .catch(()=>{ /* Explicit refresh still reports connection failures. */ })
    },60000)
    return ()=>{controller.abort();clearInterval(timer)}
  },[selected,busy])

  function chooseShipment(id: string) {
    if (busy) return
    setPickerOpen(false)
    if(id===selected)return
    setOperations(null); setNotice(''); setRouteId('main'); setContext(null); setContextError(''); setDetail(null); setRoutes([]); setEvents([]); setForecast(null); setCheck(null); setCheckId(''); setDocuments([]); setError(''); setDetailLoading(true); setSelected(id)
  }
  function reload() {
    setOperations(null); setNotice(''); setContext(null); setContextError(''); setLoading(true); setDetailLoading(Boolean(selected)); setDetail(null); setRoutes([]); setEvents([]); setForecast(null); setCheck(null); setError(''); setRevision(value => value + 1)
  }
  async function refreshDetail() {
    const [d, o, e, c] = await Promise.all([
      api<Detail>(`/api/shipments/${encodeURIComponent(selected)}`),
      api<Operations>(`/api/shipments/${encodeURIComponent(selected)}/operations`),
      api<Event[]>(`/api/shipments/${encodeURIComponent(selected)}/events`),
      api<PredictionContext>(`/api/prediction-context/${encodeURIComponent(selected)}`),
    ])
    setDetail(d); setOperations(o); setRoutes(o.routes); setEvents(e); setContext(c); setContextError('')
  }
  async function predict() {
    setBusy(true);setError('')
    const baseline=[...routes];const results:Prediction[]=[]
    try {
      for(const route of routes) results.push(validatePrediction(await api<Prediction>('/api/predict',buildPredictionRequest(selected,route.route_id))))
      setForecast({results,baseline});await refreshDetail()
    } catch(error) {
      setError(message(error))
      if(results.length){setForecast({results,baseline});try{await refreshDetail()}catch{ /* Keep the initial error. */ }}
    } finally {setBusy(false)}
  }
  async function addShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    try {
      const created = await api<Shipment>('/api/shipments', {name: String(form.get('name')).trim(), weight_tonnes: Number(form.get('weight')), departure_at: new Date(String(form.get('departure'))).toISOString(), conditions: {weather_severity:Number(form.get('weather')), port_load:Number(form.get('load')), rail_delay:Number(form.get('rail')), wind_speed:Number(form.get('wind')), wave_height:Number(form.get('wave'))}})
      setOperations(null); setNotice(''); setShipments(current=>[...current,created]); setSelected(created.id); setDetail(null); setRoutes([]); setForecast(null); setContext(null); setCheck(null); setDocuments([]); setEvents([]); setDetailLoading(true); setRouteId('main'); setPickerOpen(false); setPage('monitor'); setContextError(''); setCheckId(''); setAdding(false)
    } catch(error) {setError(message(error))} finally {setBusy(false)}
  }
  async function applyRoute() {
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await api<Operations>(`/api/shipments/${encodeURIComponent(selected)}/route`,{route_id:'alternative'})
      setOperations(next); setRoutes(next.routes); setRouteId(next.twin.route_id)
      await refreshDetail(); setNotice('Маршрут через Баку применён. ETA и CO₂e обновлены.')
    } catch(error) {setError(message(error))} finally {setBusy(false)}
  }
  async function readDocument(type:string,file?:File) {
    setCheck(null); setCheckId(''); setError('')
    setDocuments(current=>current.filter(item=>item.type!==type))
    if(!file)return
    if(file.size>100000){setError('Документ должен быть не больше 100 КБ');return}
    setBusy(true)
    try {
      const content=await file.text()
      setDocuments(current=>[...current.filter(item=>item.type!==type),{type,filename:file.name,content}])
    } catch(error) {setError(message(error))} finally {setBusy(false)}
  }
  function downloadTemplate(type:string) {
    if(!detail)return
    const blob=new Blob([JSON.stringify({shipment_id:selected,weight_tonnes:detail.weight_tonnes,document_number:type==='invoice'?'INV-001':'PL-001'},null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob), link=document.createElement('a')
    link.href=url;link.download=type+'.json';link.click();URL.revokeObjectURL(url)
  }
  async function sendPreclearance() {
    if(!check)return
    setBusy(true);setError('')
    try {setCheck(await api<Check>(`/api/preclearance/${check.check_id}/submit`,{},key));await refreshDetail()}
    catch(error){setError(message(error))}finally{setBusy(false)}
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setCheck(null)
    try {
      const result = await api<Check>('/api/preclearance', {shipment_id:selected, documents}, key)
      setCheckId(result.check_id); setCheck(await api<Check>(`/api/preclearance/${result.check_id}`)); await refreshDetail()
    } catch (error) {setError(message(error))} finally {setBusy(false)}
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setCheck(null)
    try {setCheck(await api<Check>(`/api/preclearance/${encodeURIComponent(checkId.trim())}`))} catch (error) {setError(message(error))} finally {setBusy(false)}
  }
  const visible = shipments.filter(item => (filter === 'all' || item.status === filter) && `${item.id} ${item.name} ${item.origin} ${item.destination}`.toLowerCase().includes(search.toLowerCase()))
  const currentPage = pages.find(item => item.id === page)!
  const route=routes.find(item=>item.route_id===routeId)
  const result=forecast?.results.find(item=>item.route_id===routeId)
  const metrics=forecast?.results[0]?.metrics

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Smart Caspian Transit"><span className="brand-mark">sct<span>.</span></span><span>Smart Caspian</span></a>
      <nav aria-label="Основная навигация">{pages.map(item=><button key={item.id} aria-label={item.title} title={item.title} className={page===item.id?'nav active':'nav'} aria-current={page===item.id?'page':undefined} disabled={busy} onClick={()=>setPage(item.id)}><Icon name={item.icon}/><span>{item.title}</span></button>)}</nav>
      <div className={online?'connection online':'connection'}><span/>{online?'Подключено':'Нет соединения'}</div>
    </aside>
    <main>
      <header className="page-header"><h1>{currentPage.title}</h1><div className="header-actions"><button className="icon-button" onClick={reload} disabled={busy||loading} aria-label="Обновить данные" title="Обновить"><Icon name="refresh"/></button><button className="primary" onClick={()=>{setError('');setAdding(true)}} disabled={busy}><Icon name="plus"/>Новая отправка</button></div></header>
      {error&&!adding&&<div role="alert" className="error">{error}<button onClick={reload} disabled={busy||loading}>Повторить</button></div>}
      <div className="fleet-summary"><span><b>{shipments.length}</b> отправок</span><span><i className="status-dot"/><b>{shipments.filter(item=>item.status==='in_transit').length}</b> в пути</span><span><b>{shipments.filter(item=>item.status==='pending').length}</b> ожидают</span></div>
      <div className="workspace">
        <section className={`panel shipments ${pickerOpen?'picker-open':''}`} aria-label="Список отправок">
          <button className="shipment-toggle" aria-expanded={pickerOpen} aria-controls="shipment-picker" onClick={()=>setPickerOpen(!pickerOpen)}><span><Icon name="box"/>{detail?.name||'Выбрать отправку'}</span><Icon name="chevron"/></button>
          <div id="shipment-picker" className="shipment-picker"><div className="panel-heading"><h2>Отправки</h2><span>{visible.length}</span></div>
            <label className="sr-only" htmlFor="search">Поиск отправки</label><input id="search" placeholder="Найти отправку…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <label className="sr-only" htmlFor="status">Статус отправки</label><select id="status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все статусы</option>{['pending','in_transit','completed'].map(status=><option key={status} value={status}>{labels[status]}</option>)}</select>
            <div className="shipment-list">{loading?<p className="empty">Загружаем отправки…</p>:!visible.length?<p className="empty">Ничего не найдено</p>:visible.map(item=><button disabled={busy||loading} key={item.id} aria-pressed={selected===item.id} className={`shipment ${selected===item.id?'selected':''}`} onClick={()=>chooseShipment(item.id)}><div><span className="mono">{item.id}</span><span className={`badge ${item.status}`}>{labels[item.status]}</span></div><h3>{item.name}</h3><p>{item.origin}<Icon name="arrow"/>{item.destination}</p></button>)}</div>
          </div>
        </section>
        <section className="panel detail" aria-label={`${currentPage.title}: ${selected||'отправка не выбрана'}`} aria-busy={detailLoading||busy}>
          {!detail?<div className="empty">{loading||detailLoading?'Загружаем перевозку…':selected?'Не удалось загрузить отправку':'Добавьте первую отправку'}</div>:<>
            <div className="detail-heading"><div><div className="shipment-meta"><span className="mono">{detail.id}</span><span className={`badge ${detail.status}`}>{labels[detail.status]}</span></div><h2>{detail.name}</h2><p>{detail.origin}<Icon name="arrow"/>{detail.destination}<span className="shipment-weight">{number(detail.weight_tonnes)} т</span></p></div>{page==='monitor'&&<button className="primary calculate" onClick={predict} disabled={busy||!online||!routes.length}>{busy?'Рассчитываем…':forecast?'Пересчитать':'Рассчитать доставку'}<Icon name="arrow"/></button>}</div>
            <div className="tab-content" key={`${selected}-${page}`}>
              {page==='monitor'&&<>
                {notice&&<p className="success-notice" role="status">{notice}</p>}
                {operations&&<OperationsPanel data={operations} busy={busy} onApply={applyRoute}/>}
                {route&&<><div className="delivery-summary"><article><span>Полный срок маршрута</span><strong>{hours(route.eta_hours)}</strong></article><article><span>Прибытие</span><strong>{date(route.eta_at)}</strong></article><article><span>Выбросы CO₂e</span><strong>{number(route.co2_kg)} <small>кг</small></strong></article></div>
                  <div className="section-title"><h3>Сравнение маршрутов</h3><span>{routeId===operations?.twin.route_id?'Активный маршрут':'Предпросмотр'}</span></div><RouteMap routes={routes} selected={routeId} onSelect={setRouteId}/>
                  <div className="route-context"><span><i className="status-dot"/>{route.recommended?'Рекомендуемый маршрут':'Резервный маршрут'}</span><span>{number(route.distance_km)} км</span></div>
                  <RouteDetails route={route} baseline={forecast?.baseline.find(item=>item.route_id===routeId)}/>
                </>}
                {result&&<details className="disclosure"><summary>Прогноз и точность</summary><div className="disclosure-content"><div className="forecast-summary"><strong>{hours(result.delay_hours)}</strong><span>Задержка обработки · риск {labels[result.risk].toLowerCase()}</span></div>{result.reasons.map(reason=><p key={reason} className="muted">{reason}</p>)}{metrics&&<><dl className="data-list"><div><dt>Ошибка прогноза (MAE)</dt><dd>{metrics.model_mae_hours.toLocaleString('ru-RU')} ч</dd></div><div><dt>Ошибка простого среднего</dt><dd>{metrics.baseline_mae_hours.toLocaleString('ru-RU')} ч</dd></div></dl><p className="muted">{metrics.train_count} записей для обучения, {metrics.test_count} для проверки. История синтетическая. Ошибка относится к задержке обработки, а не полному сроку доставки.</p></>}</div></details>}
                <details className="disclosure"><summary>Исходные данные</summary><div className="disclosure-content"><dl className="data-list"><div><dt>Отправление</dt><dd>{date(detail.departure_at)}</dd></div><div><dt>Масса</dt><dd>{number(detail.weight_tonnes)} т</dd></div>{context&&Object.entries(context.conditions).map(([field,value])=><div key={field}><dt>{({weather_severity:'Погода, 0–5',port_load:'Загрузка порта, %',wind_speed:'Ветер, м/с',wave_height:'Волны, м',rail_delay:'Опоздание поезда, ч'})[field]||field}</dt><dd>{number(value)}</dd></div>)}</dl>{contextError&&<p className="error">{contextError}</p>}<p className="muted">{context?.observation_id==='manual'?'Условия введены при добавлении отправки.':'Синтетическая сводка из файлов проекта. Погода и загрузка порта влияют на прогноз, поезд — на стыковку.'} Ветер и волны оцениваются отдельными правилами в центре рисков.</p></div></details>
              </>}
              {page==='documents'&&<>
                <h3>Предварительное оформление</h3><p className="muted">Демонстрационная проверка содержимого JSON: номер отправки, масса в тоннах и номер документа. PDF, сканы и OCR не поддерживаются.</p>
                <div className="document-steps"><span>1. Загрузить</span><span>2. Проверить</span><span>3. Передать</span></div>
                <p className="muted">Последний статус: {labels[detail.preclearance_status]||detail.preclearance_status}</p>
                <form onSubmit={submit}><fieldset disabled={busy}>{['invoice','packing_list'].map(type=><div className="document-upload" key={type}><label className="file-row"><span><Icon name="file"/>{type==='invoice'?'Инвойс':'Упаковочный лист'}</span><input key={`${selected}-${type}`} type="file" accept=".json,application/json" onChange={e=>void readDocument(type,e.target.files?.[0])}/><small>{documents.some(d=>d.type===type)?'Ожидает проверки':'Не загружен'}</small></label><button type="button" onClick={()=>downloadTemplate(type)}>Скачать образец JSON</button></div>)}<details className="form-conditions"><summary>Настройки проверки</summary><label>Ключ доступа<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required/></label></details><button className="primary" disabled={busy||!documents.length}>{busy?'Проверяем…':'Проверить документы'}</button></fieldset></form>
                {check&&<div className={`result ${check.status}`} role="status"><h3>{labels[check.status]}</h3>{check.reasons.length?check.reasons.map(reason=><p key={reason}>{reason}</p>):<p>{check.status==='approved'?'Pre-clearance пройдено в демонстрационной системе.':'Все поля и масса совпадают. Пакет готов к передаче.'}</p>}{check.documents.map((doc,i)=><article className="document-result" key={`${doc.type}-${i}`}><b>{doc.filename} · {labels[doc.status]||doc.status}</b>{doc.reasons.map(reason=><p key={reason}>{reason}</p>)}</article>)}<span className="mono">{check.check_id} · {check.shipment_id}</span>{check.status==='verified'&&check.shipment_id===selected&&<button type="button" className="primary" disabled={busy} onClick={sendPreclearance}>Передать на предварительное оформление</button>}</div>}
                <p className="muted">Это имитация процесса: пакет не передаётся в таможенные органы.</p>
                <details className="disclosure"><summary>Найти предыдущую проверку</summary><form className="lookup disclosure-content" onSubmit={lookup}><label>Номер проверки<input placeholder="CHK-…" value={checkId} onChange={e=>setCheckId(e.target.value)} required/></label><button disabled={busy||!checkId.trim()}>Найти</button></form></details>
              </>}
              {page==='events'&&<><h3>События отправки</h3>{!events.length?<div className="empty">Здесь появятся расчёты и проверки документов.</div>:<ol className="event-list">{[...events].reverse().map((event,index)=><li key={`${event.timestamp}-${index}`}><span className="event-dot"/><div><time dateTime={event.timestamp}>{date(event.timestamp)}</time><strong>{labels[event.event]??event.event}</strong><p>{event.details}</p></div></li>)}</ol>}</>}
            </div>
          </>}
        </section>
      </div><footer>Smart Caspian Transit <span>Учебные данные</span></footer>
    </main>
    {adding&&<ShipmentDialog busy={busy} onClose={()=>setAdding(false)} onSave={addShipment} error={error}/>}
  </div>
}
export default App
