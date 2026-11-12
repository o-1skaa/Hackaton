import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './services/api'
import type { Shipment, Detail, Route, Event, Prediction, Check, PredictionContext } from './services/api'
import { buildPredictionRequest, legacyCapabilities, physicalFields, readCapabilities, validatePrediction } from './services/prediction'
import type { Capabilities, Scenario } from './services/prediction'
import './App.css'

const labels: Record<string, string> = {pending:'Ожидает', in_transit:'В пути', completed:'Завершён', not_submitted:'Не отправлены', submitted:'Отправлены', approved:'Приняты', rejected:'Отклонены', low:'Низкий', medium:'Средний', high:'Высокий', prediction_updated:'Обновлён прогноз'}
const pages = [
  { id: 'monitor', title: 'Мониторинг', hint: 'Этапы, ETA и маршруты', icon: '▦' },
  { id: 'scenario', title: 'AI-прогноз', hint: 'DeepSeek · анализ условий', icon: '↗' },
  { id: 'sources', title: 'Источники', hint: 'Сводки и происхождение данных', icon: '◈' },
  { id: 'documents', title: 'Документы', hint: 'Проверка комплектности', icon: '▤' },
  { id: 'events', title: 'Журнал', hint: 'События выбранного груза', icon: '◷' },
] as const
const initialScenario: Scenario = {weather_severity: 2, wind_speed: 8, wave_height: 1, port_load: 50, rail_delay: 0, route_id: 'main'}
const fieldLabels: Record<string, string> = {wind_speed: 'ветер', wave_height: 'высота волн', rail_delay: 'задержка поезда', route_id: 'маршрут'}
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос'
const hours = (value: number) => `${value.toLocaleString('ru-RU', {maximumFractionDigits: 1})} ч`
type Forecast = {result: Prediction; request: Record<string, string | number>; baseline: Route[]}

function RouteComparison({routes, baseline}: {routes: Route[]; baseline?: Route[]}) {
  return <div className="route-grid">{routes.map(route => {
    const before = baseline?.find(item => item.route_id === route.route_id)
    const delta = before ? Math.round((route.eta_hours - before.eta_hours) * 10) / 10 : null
    return <article className={route.recommended ? 'route recommended' : 'route'} key={route.route_id}>
      <span className="badge">{route.recommended ? 'Рекомендуемый' : 'Альтернативный'}</span>
      <h3>{route.name}</h3><dl>
        <div><dt>Расстояние</dt><dd>{route.distance_km.toLocaleString('ru-RU')} км</dd></div>
        <div><dt>ETA / длительность</dt><dd>{hours(route.eta_hours)}</dd></div>
        {before && <div><dt>До расчёта</dt><dd>{hours(before.eta_hours)}</dd></div>}
        {delta !== null && <div><dt>Изменение ETA</dt><dd>{delta > 0 ? '+' : ''}{hours(delta)}</dd></div>}
        <div><dt>Выбросы CO₂e</dt><dd>{route.co2_kg.toLocaleString('ru-RU')} кг</dd></div>
      </dl><p>{route.reason}</p>
    </article>
  })}</div>
}

function App() {
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
  const [scenario, setScenario] = useState<Scenario>(initialScenario)
  const [capabilities, setCapabilities] = useState<Capabilities>(legacyCapabilities)
  const [context, setContext] = useState<PredictionContext | null>(null)
  const [contextError, setContextError] = useState('')
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [key, setKey] = useState('demo-local-key')
  const [documents, setDocuments] = useState<{type: string; filename: string}[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [checkId, setCheckId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      api<Shipment[]>('/api/shipments', undefined, undefined, controller.signal),
      api<{status:string}>('/health', undefined, undefined, controller.signal),
      api<unknown>('/openapi.json', undefined, undefined, controller.signal).then(readCapabilities).catch(() => legacyCapabilities),
    ]).then(([items, , contract]) => {
      if (controller.signal.aborted) return
      setShipments(items); setDetailLoading(items.length > 0); setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id || '')
      setCapabilities(contract); setOnline(true)
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
      api<Route[]>(`/api/routes/${encodeURIComponent(selected)}`, undefined, undefined, controller.signal),
      api<Event[]>(`/api/shipments/${encodeURIComponent(selected)}/events`, undefined, undefined, controller.signal),
    ]).then(([d, r, e]) => {
      if (controller.signal.aborted) return
      setDetail(d); setRoutes(r); setEvents(e)
      setScenario(current => ({...current, route_id: r.some(item => item.route_id === current.route_id) ? current.route_id : r[0]?.route_id || ''}))
    }).catch(error => {if (!controller.signal.aborted) setError(message(error))})
      .finally(() => {if (!controller.signal.aborted) setDetailLoading(false)})
    return () => controller.abort()
  }, [selected, revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    api<PredictionContext>(`/api/prediction-context/${encodeURIComponent(selected)}`, undefined, undefined, controller.signal)
      .then(value => {setContext(value); setContextError(''); setScenario({...initialScenario, ...value.conditions})})
      .catch(error => {if (!controller.signal.aborted) setContextError(message(error))})
    return () => controller.abort()
  }, [selected])

  function chooseShipment(id: string) {
    if (id === selected || busy) return
    setContext(null); setContextError(''); setDetail(null); setRoutes([]); setEvents([]); setForecast(null); setCheck(null); setCheckId(''); setDocuments([]); setError(''); setDetailLoading(true); setSelected(id)
  }
  function reload() {
    setLoading(true); setDetailLoading(Boolean(selected)); setDetail(null); setRoutes([]); setEvents([]); setForecast(null); setCheck(null); setError(''); setRevision(value => value + 1)
  }
  async function refreshDetail() {
    const [d, r, e] = await Promise.all([
      api<Detail>(`/api/shipments/${encodeURIComponent(selected)}`),
      api<Route[]>(`/api/routes/${encodeURIComponent(selected)}`),
      api<Event[]>(`/api/shipments/${encodeURIComponent(selected)}/events`),
    ])
    setDetail(d); setRoutes(r); setEvents(e)
  }
  async function predict(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const request = buildPredictionRequest(selected, scenario, capabilities)
      const result = validatePrediction(await api<Prediction>('/api/predict', request))
      setForecast({result, request, baseline: [...routes]}); setRoutes([])
      setDetail(current => current && {...current, last_delay_hours: result.delay_hours})
      try {await refreshDetail()} catch (error) {setError(`Прогноз сохранён, но ETA и журнал не обновлены. ${message(error)}`)}
    } catch (error) {setError(message(error))} finally {setBusy(false)}
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
  function updateScenario(field: keyof Scenario, value: string | number) {setScenario(current => ({...current, [field]: value}))}
  const supports = (field: string) => capabilities.fields.includes(field)
  const missing = physicalFields.filter(field => !supports(field))
  const unsupportedRequired = capabilities.required.filter(field => !['shipment_id', ...Object.keys(initialScenario)].includes(field))
  const visible = shipments.filter(item => (filter === 'all' || item.status === filter) && `${item.id} ${item.name} ${item.origin} ${item.destination}`.toLowerCase().includes(search.toLowerCase()))
  const currentPage = pages.find(item => item.id === page)!
  const changed = forecast && Object.entries(forecast.request).some(([field, value]) => field !== 'shipment_id' && scenario[field as keyof Scenario] !== value)
  const result = forecast?.result

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Smart Caspian Transit"><span className="brand-mark">C</span><span>SMART CASPIAN<small>TRANSIT / OPERATIONS</small></span></a>
      <div className="nav-caption">УПРАВЛЕНИЕ КОРИДОРОМ</div>
      <nav aria-label="Основная навигация">{pages.map((item, index) => <button key={item.id} className={page === item.id ? 'nav active' : 'nav'} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><span aria-hidden="true">{item.icon}</span><span className="nav-label">{item.title}<small>{item.hint}</small></span><span className="nav-number">0{index + 1}</span></button>)}</nav>
      <div className="sidebar-context"><span className="nav-caption">В РАБОТЕ</span><strong>{selected || 'Груз не выбран'}</strong><p>{detail ? `${detail.origin} → ${detail.destination}` : 'Выберите перевозку в списке'}</p><small>Разделы открываются для этого груза</small></div>
      <div className="sidebar-provider"><small>AI-ПРОВАЙДЕР</small><strong>{context?.provider.model || 'DeepSeek'}</strong><span>{context?.provider.configured ? 'Ключ настроен · внешний API' : 'Для прогноза нужен ключ API'}</span></div>
      <div className="sidebar-bottom"><span className="demo-dot"/> Демонстрационная среда<small>Каспийский транспортный коридор</small></div>
    </aside>
    <main>
      <header><div><span className="eyebrow">ЦЕНТР УПРАВЛЕНИЯ ПЕРЕВОЗКАМИ</span><h1>{currentPage.title}</h1><p className="page-subtitle">{currentPage.hint}</p></div><div className="header-actions"><span className={online ? 'connection online' : 'connection'}>{online ? '● API подключён' : '○ Нет соединения'}</span><button onClick={reload} disabled={busy || loading}>Обновить ↻</button></div></header>
      <div className="demo-banner">ДЕМО <span>Синтетические грузы, история и сводки · прогноз через DeepSeek · состояние сбрасывается при перезапуске.</span></div>
      {error && <div role="alert" className="error"><span>{error}</span><button onClick={reload} disabled={busy || loading}>Повторить</button></div>}
      <section className="metrics" aria-label="Сводка перевозок"><article><span>Всего перевозок</span><strong>{shipments.length}</strong><small>В текущей демонстрации</small></article><article><span>Грузы в пути</span><strong>{shipments.filter(item => item.status === 'in_transit').length}</strong><small>Активные перевозки</small></article><article><span>Ожидают отправки</span><strong>{shipments.filter(item => item.status === 'pending').length}</strong><small>Подготовка к перевозке</small></article><article><span>Завершены</span><strong>{shipments.filter(item => item.status === 'completed').length}</strong><small>Доставка выполнена</small></article></section>
      <div className="workspace">
        <section className="panel shipments"><div className="panel-heading"><h2>Перевозки</h2><span>{visible.length} из {shipments.length}</span></div><label className="sr-only" htmlFor="search">Поиск груза</label><input id="search" placeholder="Номер, груз или направление…" value={search} onChange={event => setSearch(event.target.value)}/><label className="sr-only" htmlFor="status">Статус перевозки</label><select id="status" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все статусы</option>{['pending', 'in_transit', 'completed'].map(status => <option key={status} value={status}>{labels[status]}</option>)}</select><div className="shipment-list">{loading && <p className="empty">Загрузка перевозок…</p>}{!loading && !visible.length && <p className="empty">Грузы не найдены.</p>}{visible.map(item => <button disabled={busy || loading} key={item.id} aria-pressed={selected === item.id} className={`shipment ${selected === item.id ? 'selected' : ''}`} onClick={() => chooseShipment(item.id)}><div><span className="mono">{item.id}</span><span className={`badge ${item.status}`}>{labels[item.status]}</span></div><h3>{item.name}</h3><p>{item.origin} <span>→</span> {item.destination}</p></button>)}</div></section>
        <section className="panel detail" aria-label={`${currentPage.title}: ${selected || 'груз не выбран'}`}>
          {!detail ? <div className="empty">{loading || detailLoading ? 'Загрузка карточки…' : selected ? 'Не удалось загрузить карточку. Нажмите «Обновить», чтобы повторить.' : 'Выберите перевозку'}</div> : <>
            <div className="detail-heading"><div><span className="eyebrow">{detail.id} / {currentPage.title.toUpperCase()}</span><h2>{detail.name}</h2><p>{detail.origin} <span className="arrow">→</span> {detail.destination}</p></div><span className={`badge ${detail.status}`}>{labels[detail.status]}</span></div>
            <div className="tab-content" key={`${selected}-${page}`}>
              {page === 'monitor' && <>
                <div className="section-title"><h3>Этапы перевозки</h3><span>По данным груза</span></div><ol className="stages">{detail.stages.map((stage, index) => <li key={index} className={stage.status}><span>{stage.status === 'completed' ? '✓' : index + 1}</span><div><strong>{stage.name}</strong><small>{stage.status === 'current' ? 'Текущий этап' : stage.status === 'completed' ? 'Выполнено' : 'Ожидается'}</small></div></li>)}</ol>
                <div className="summary-grid"><article><span>Средняя историческая задержка</span><strong>{hours(detail.historical_avg_delay_hours)}</strong></article><article><span>Последний прогноз задержки</span><strong>{detail.last_delay_hours == null ? 'Не рассчитан' : hours(detail.last_delay_hours)}</strong></article><article><span>Комплектность документов</span><strong>{labels[detail.preclearance_status]}</strong></article></div>
                <div className="section-title"><h3>Маршруты и ETA</h3><span>{detail.last_delay_hours == null ? 'До расчёта задержки' : 'С учётом последнего прогноза'}</span></div>
                {routes.length ? <RouteComparison routes={routes}/> : <p className="empty">{busy ? 'Обновляем ETA…' : 'Маршруты недоступны. Обновите данные.'}</p>}
                <p className="footnote">ETA показан как длительность в часах. Маршруты и CO₂e — модельные оценки; Без отдельного AI-прогноза маршрут показывает базовый ETA. GPS и календарное время прибытия сервер не передаёт.</p>
              </>}
              {page === 'sources' && <>
                <div className="section-title"><h3>Демонстрационные сводки</h3><span className="badge">Синтетические данные</span></div>
                <p className="muted">Имитация заранее собранных данных. Реальные сайты, порты и метеосервисы не опрашиваются.</p>
                {contextError && <p role="alert" className="notice">{contextError}</p>}
                {context ? <><p className="mono">{context.snapshot_id} · {new Date(context.observed_at).toLocaleString('ru-RU')}</p>
                  <div className="source-grid">{context.sources.map(source => <article key={source.kind}><h3>{source.name}</h3><p>{source.note}</p></article>)}</div>
                  <dl className="source-values">{Object.entries(context.conditions).map(([field, value]) => <div key={field}><dt>{({weather_severity:'Погода (0–5)', port_load:'Загрузка порта (%)', wind_speed:'Ветер (м/с)', wave_height:'Волны (м)', rail_delay:'Поезд (ч)'})[field] || field}</dt><dd>{value}</dd></div>)}</dl>
                  <p className="footnote">История: 200 синтетических наблюдений по погодной оценке, загрузке порта и фактической задержке. История не содержит измерений ветра, волн или разбивки по маршрутам. Точность внешней модели на реальных данных не оценивалась.</p>
                </> : !contextError && <p>Загрузка сводок…</p>}
              </>}
              {page === 'scenario' && <>
                <div className="section-title"><h3>Условия перевозки</h3><span className="badge">{missing.length ? 'Базовый API' : 'Расширенный API'}</span></div>
                <p className="muted">Условия загружены из демонстрационной сводки. Можно изменить их вручную. DeepSeek анализирует условия и историю; задержка обновляет ETA только выбранного маршрута.</p>
                {(!capabilities.verified || missing.length > 0) && <div className="notice" role="status">{!capabilities.verified ? 'Контракт API недоступен. Используется прежний запрос: погодная оценка и загрузка порта. ' : ''}{missing.length > 0 && <>Сервер пока не принимает: {missing.map(field => fieldLabels[field]).join(', ')}. Эти поля отключены и не участвуют в расчёте. Обновите backend для внешнего AI-прогноза.</>}</div>}
                {unsupportedRequired.length > 0 && <div className="notice">Контракт требует новые поля: {unsupportedRequired.join(', ')}. Для расчёта нужно обновить интерфейс.</div>}
                {contextError && <p role="alert" className="notice">{contextError}</p>}
                {context && <div className="notice">{context.provider.configured ? `Внешний API: ${context.provider.model}.` : 'Прогноз недоступен: задайте DEEPSEEK_API_KEY в backend/.env и перезапустите сервер.'} Сводка: {context.snapshot_id}. <button type="button" disabled={busy} onClick={() => {setScenario({...initialScenario, ...context.conditions, route_id: scenario.route_id})}}>Восстановить сводку</button></div>}
                <form onSubmit={predict}>
                  <fieldset disabled={busy}><legend className="sr-only">Параметры сценария</legend>
                    <div className="scenario-grid">
                      <label>Скорость ветра, м/с<input type="number" min="0" max="100" step="0.1" required disabled={!supports('wind_speed')} value={Number.isFinite(scenario.wind_speed) ? scenario.wind_speed : ''} onChange={event => updateScenario('wind_speed', event.target.valueAsNumber)}/></label>
                      <label>Высота волн, м<input type="number" min="0" max="30" step="0.1" required disabled={!supports('wave_height')} value={Number.isFinite(scenario.wave_height) ? scenario.wave_height : ''} onChange={event => updateScenario('wave_height', event.target.valueAsNumber)}/></label>
                      <label>Задержка поезда, ч<input type="number" min="0" max="720" step="0.1" required disabled={!supports('rail_delay')} value={Number.isFinite(scenario.rail_delay) ? scenario.rail_delay : ''} onChange={event => updateScenario('rail_delay', event.target.valueAsNumber)}/></label>
                      <label>Маршрут для прогноза<select required disabled={!supports('route_id') || !routes.length} value={scenario.route_id} onChange={event => updateScenario('route_id', event.target.value)}>{routes.map(route => <option key={route.route_id} value={route.route_id}>{route.name}</option>)}</select></label>
                    </div>
                    {supports('weather_severity') && <><label>Погодная оценка <b>{scenario.weather_severity} / 5</b><input type="range" min="0" max="5" step="0.1" value={scenario.weather_severity} onChange={event => updateScenario('weather_severity', Number(event.target.value))}/></label><div className="range-labels"><span>Благоприятная</span><span>Экстремальная</span></div></>}
                    <label>Загрузка порта <b>{scenario.port_load}%</b><input type="range" min="0" max="100" value={scenario.port_load} onChange={event => updateScenario('port_load', Number(event.target.value))}/></label>
                    <button className="primary" disabled={busy || !online || !context?.provider.configured || unsupportedRequired.length > 0 || (capabilities.required.includes('route_id') && !routes.length)}>{busy ? 'Расчёт…' : 'Получить AI-прогноз'}</button>
                  </fieldset>
                </form>
                {forecast && result && <>
                  <div className={`result ${result.risk}`} role="status"><span>Прогноз дополнительной задержки</span><strong>{hours(result.delay_hours)}</strong><p>Риск: {labels[result.risk]}</p><ul>{result.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><div className="model-info"><span>Модель: {result.model || 'не указана сервером'}</span><span>Метод: {result.method || 'не указан сервером'}</span><span>Версия: {result.model_version || 'не указана'}</span><span>Контекст: {result.source_snapshot_id}</span><span>Промпт: {result.prompt_version}</span><span>Маршрут: {result.route_id}</span></div></div>
                  <p className="footnote">Рассчитано для: {Object.entries(forecast.request).filter(([field]) => field !== 'shipment_id').map(([field, value]) => `${({weather_severity:'погодная оценка', port_load:'загрузка порта', ...fieldLabels})[field] || field}: ${value}`).join(' · ')}</p>
                  {changed && <p className="notice">Условия изменены. Ниже остаётся результат предыдущего расчёта — запустите сценарий заново.</p>}
                  <div className="section-title forecast-routes"><h3>ETA после расчёта</h3><span>Сравнение с состоянием до запроса</span></div>
                  {routes.length ? <RouteComparison routes={routes} baseline={forecast.baseline}/> : <p className="empty">{busy ? 'Обновляем ETA…' : 'Не удалось обновить ETA. Повторите загрузку данных.'}</p>}
                </>}
              </>}
              {page === 'documents' && <>
                <h3>Проверка комплектности</h3><p className="muted">Добавьте invoice и packing_list. Проверяются типы документов; файлы и их содержимое не отправляются.</p>
                <form onSubmit={submit}><fieldset disabled={busy}><legend className="sr-only">Документы для проверки</legend><label>Демонстрационный API-ключ<input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required/></label>{['invoice', 'packing_list'].map(type => <label className="file-row" key={type}>{type === 'invoice' ? 'Инвойс (invoice)' : 'Упаковочный лист (packing_list)'}<input key={`${selected}-${type}`} type="file" onChange={event => {const file = event.target.files?.[0]; setDocuments(current => [...current.filter(item => item.type !== type), ...(file ? [{type, filename:file.name}] : [])])}}/>{documents.find(item => item.type === type) && <small>Добавлен: {documents.find(item => item.type === type)?.filename}</small>}</label>)}<button className="primary" disabled={busy || !documents.length}>{busy ? 'Проверка…' : 'Проверить документы'}</button></fieldset></form>
                <form className="lookup" onSubmit={lookup}><label>Открыть проверку по ID<input placeholder="CHK-…" value={checkId} onChange={event => setCheckId(event.target.value)} required/></label><button disabled={busy || !checkId.trim()}>Найти проверку</button></form>
                {check && <div className={`result ${check.status}`} role="status"><span className="mono">{check.check_id} · {check.shipment_id}</span><h3>{labels[check.status]}</h3>{check.reasons.length ? check.reasons.map(reason => <p key={reason}>{reason}</p>) : <p>Обязательные типы документов присутствуют.</p>}<ul>{check.documents.map((document, index) => <li key={index}>{document.type} — {document.filename}</li>)}</ul></div>}
              </>}
              {page === 'events' && <><div className="section-title"><h3>История событий</h3><span>{events.length} событий</span></div>{!events.length ? <div className="empty">Событий пока нет. Рассчитайте прогноз или проверьте документы.</div> : <ol className="event-list">{[...events].reverse().map((event, index) => <li key={`${event.timestamp}-${index}`}><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString('ru-RU')}</time><strong>{labels[event.event] ?? event.event}</strong><p>{event.details}</p></li>)}</ol>}</>}
            </div>
          </>}
        </section>
      </div><footer>SMART CASPIAN TRANSIT <span>Демонстрационный MVP / Каспийский цифровой форум 2026</span></footer>
    </main>
  </div>
}
export default App
