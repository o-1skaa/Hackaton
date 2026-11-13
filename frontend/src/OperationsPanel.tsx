import type { Operations } from './services/api'
const date = (s:string) => new Date(s).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
const num = (n:number) => n.toLocaleString('ru-RU',{maximumFractionDigits:1})
const status:Record<string,string> = {pending:'Ожидается',current:'В пути',completed:'Пройдено',waiting:'Ожидание парома',critical:'Критический',high:'Высокий',medium:'Средний',low:'Низкий'}
const modes:Record<string,string> = {rail:'Железная дорога',ferry:'Паром',road:'Автотранспорт'}
export function OperationsPanel({data,busy,onApply}:{data:Operations;busy:boolean;onApply:()=>void}) {
  const t=data.twin
  const level=data.risks[0]?.level||'low'
  return <>
    <section className="twin-card" aria-label="Цифровой двойник груза">
      <div className="twin-top"><span>Цифровой двойник</span><span className={`risk-pill ${level}`}>{data.risks.length?'Риск задержки':'Без активных рисков'}</span></div>
      <div className="twin-metrics"><div><strong>{num(t.eta_hours)} <small>ч</small></strong><span>Прогнозируемое время доставки</span></div><div><b>{t.current_stage}</b><span>{t.location}</span><small>Расчётное местоположение · без GPS</small></div></div>
      <ol className="twin-stages">{t.stages.map((s,i)=><li key={s.name} className={s.status}><i>{s.status==='completed'?'✓':i+1}</i><div><b>{s.name}</b><span>{s.status==='current'?t.current_stage:status[s.status]}</span></div></li>)}</ol>
      {t.missed_connection&&t.status!=='completed'&&<p className="twin-warning">Плановая стыковка недоступна по расчёту. ETA учитывает следующий рейс.</p>}
      <div className="twin-dates"><div><span>Плановое прибытие</span><b>{date(t.planned_eta_at)}</b></div><div><span>Прогнозируемое прибытие</span><b>{date(t.eta_at)}</b></div></div>
      <div className="twin-foot"><span>Следующая точка: <b>{t.next_stop||'Маршрут завершён'}</b></span><span>Осталось {num(t.remaining_hours)} ч</span></div>
    </section>
    <div className="transport-status" aria-label="Статусы транспорта">{t.transport.map(leg=><article key={leg.mode}><span>{modes[leg.mode]}</span><b>{status[leg.status]}</b><small>{leg.from} → {leg.to}</small></article>)}</div>
    <section className="risk-center" aria-label="Центр рисков">
      <div className="section-title"><h3>Центр рисков</h3><span>{data.risks.length} предупреждений</span></div>
      {data.risks.length>0?<div className="risk-notice" role="status">{data.risks.some(r=>r.route_action)?'Обнаружен риск на маршруте. Доступно сравнение с сухопутной альтернативой.':'Задержка учтена в прогнозируемом сроке.'}</div>:<p className="muted">Активных рисков на выбранном маршруте не обнаружено.</p>}
      <div className="risk-list">{data.risks.map(r=><article key={r.code} className={`risk-row ${r.level}`}><div><b>{r.title}</b><p>{r.recommendation}</p></div><span className={`risk-pill ${r.level}`}>{status[r.level]}</span></article>)}</div>
      {data.can_apply&&<div className="alternative-offer"><div><strong>Без парома · через Баку</strong><p>ETA: {date(data.alternative.eta_at)} · {num(data.alternative.eta_hours)} ч</p><p>CO₂e: {num(data.alternative.co2_kg)} кг <span>({data.alternative.co2_kg-t.co2_kg>=0?'+':''}{num(data.alternative.co2_kg-t.co2_kg)} кг)</span></p><small>{data.alternative.eta_hours<t.eta_hours?`Быстрее на ${num(t.eta_hours-data.alternative.eta_hours)} ч`:`Дольше на ${num(data.alternative.eta_hours-t.eta_hours)} ч`} · без риска паромной стыковки</small></div><button className="primary" disabled={busy} onClick={onApply}>Применить маршрут</button></div>}
      {!data.can_apply&&t.route_id==='main'&&<p className="muted">Смена маршрута закрыта: расчётное отправление парома уже состоялось.</p>}
      <div className="weather-cards">{data.weather.map(w=><article key={w.code} className={w.level}><span>{w.title}</span><strong>{num(w.value)} <small>{w.unit}</small></strong><b>{w.description}</b></article>)}</div>
      <details className="disclosure"><summary>Как оценивается риск</summary><p className="muted">{data.rule_note} Условия синтетические. Погода и загрузка порта участвуют в историческом прогнозе; ветер и волны влияют на рекомендации отдельными правилами. После перехода на сухопутный маршрут паромные риски сняты.</p></details>
      <p className="muted">Состояние рассчитано на {date(t.as_of)} по расписанию и прогнозу. Фактическое положение груза не подтверждено.</p>
    </section>
  </>
}
