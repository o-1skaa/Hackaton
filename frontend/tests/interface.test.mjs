import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

let server, App, root, host, window
const requests=[]
const conditions={weather_severity:3,port_load:70,rail_delay:4,wind_speed:10,wave_height:1}
const shipment={id:'SCT-001',name:'Контейнер с оборудованием',origin:'Астрахань',destination:'Бендер-Аббас',status:'in_transit',synthetic:true}
const metrics={model_mae_hours:.506,baseline_mae_hours:1.278,baseline_delay_hours:2.255,train_count:160,test_count:40}
function route(id) {
  const points=id==='main'?[[46.35,48.04],[42.98,47.5],[37.47,49.46],[27.18,56.27]]:[[46.35,48.04],[40.41,49.87],[27.18,56.27]]
  const stops=id==='main'?['Астрахань','Махачкала','Энзели','Бендер-Аббас']:['Астрахань','Баку','Бендер-Аббас']
  return {route_id:id,name:id,distance_km:2500,eta_hours:id==='main'?98:77.11,eta_at:'2026-11-16T10:00:00Z',co2_kg:2800,recommended:id==='alternative',waypoints:points,legs:[{mode:'rail',stops,waypoints:points,distance_km:2500,co2_kg:2800}],transfer:{applicable:id==='main',missed_ferry:true,actual_train_arrival_hours:16,ferry_departure_hours:38,wait_hours:17.89,delay_hours:24}}
}
const items=[shipment]
let detailId='SCT-001', activeRoute='main', currentCheck=null
before(async()=>{
  window=new Window({url:'http://localhost/'})
  for(const name of ['window','document','navigator','HTMLElement','SVGElement','Element','Node','MutationObserver','ResizeObserver','FormData','Event','MouseEvent','HTMLDialogElement','getComputedStyle']) Object.defineProperty(globalThis,name,{value:window[name],configurable:true,writable:true})
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get:()=>650,configurable:true})
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get:()=>400,configurable:true})
  window.SVGSVGElement.prototype.createSVGRect=()=>({})
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
  globalThis.fetch=async(path,init={})=>{
    requests.push({path,body:init.body&&JSON.parse(init.body)})
    let value
    if(path==='/health')value={status:'ok'}
    else if(path==='/api/shipments'&&!init.body)value=[...items]
    else if(path==='/api/shipments'){
      detailId='SCT-NEW';value={...shipment,id:detailId,name:JSON.parse(init.body).name};items.push(value)
    }
    else if(path==='/api/predict')value={delay_hours:3.11,risk:'medium',reasons:['Похожие наблюдения'],method:'historical_knn',route_id:JSON.parse(init.body).route_id,synthetic:true,metrics}
    else if(path==='/api/preclearance'){
      const payload=JSON.parse(init.body)
      currentCheck={check_id:'CHK-TEST',shipment_id:payload.shipment_id,status:'verified',reasons:[],documents:payload.documents.map(d=>({...d,status:'verified',reasons:[]}))}
      value=currentCheck
    }
    else if(path==='/api/preclearance/CHK-TEST/submit'){
      currentCheck={...currentCheck,status:'approved',documents:currentCheck.documents.map(d=>({...d,status:'approved'}))};value=currentCheck
    }
    else if(path==='/api/preclearance/CHK-TEST')value=currentCheck
    else if(path.endsWith('/route')||path.endsWith('/operations')){
      if(path.endsWith('/route'))activeRoute='alternative'
      const active=route(activeRoute)
      value={twin:{route_id:activeRoute,as_of:'2026-11-13T06:00:00Z',location:'Махачкала',location_source:'calculated',current_stage:'Ожидание парома',next_stop:'Энзели',status:'in_transit',stages:[{name:'Астрахань',status:'completed'},{name:'Махачкала',status:'current'},{name:'Энзели',status:'pending'}],transport:[{mode:'ferry',from:'Махачкала',to:'Энзели',status:'waiting'}],eta_hours:active.eta_hours,remaining_hours:70,planned_eta_at:'2026-11-15T10:00:00Z',eta_at:active.eta_at,co2_kg:active.co2_kg,missed_connection:activeRoute==='main'},risks:activeRoute==='main'?[{code:'missed_ferry',title:'Риск пропуска парома',level:'critical',recommendation:'Рассмотреть альтернативу',route_action:true}]:[],weather:[{code:'wind',title:'Ветер',value:12,unit:'м/с',level:'medium',description:'Повышенный риск'}],alternative:route('alternative'),routes:[route('main'),route('alternative')],can_apply:activeRoute==='main',rule_note:'Демонстрационные правила'}
    }
    else if(path.startsWith('/api/routes/'))value=[route('main'),route('alternative')]
    else if(path.startsWith('/api/prediction-context/'))value={conditions,observation_id:'manual',sources:[],provider:{configured:true}}
    else if(path.endsWith('/events'))value=[]
    else if(path.startsWith('/api/shipments/'))value={...items.find(i=>i.id===detailId),weight_tonnes:20,departure_at:'2026-11-12T08:00:00Z',stages:[],historical_avg_delay_hours:2.255,last_delay_hours:null,preclearance_status:'not_submitted'}
    else throw new Error('Unexpected API request '+path)
    return new Response(JSON.stringify(value),{status:path==='/api/shipments'&&init.body?201:200,headers:{'Content-Type':'application/json'}})
  }
  server=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true,hmr:false}})
  App=(await server.ssrLoadModule('/src/App.tsx')).default
  host=document.createElement('div');document.body.append(host)
  root=createRoot(host)
  await act(async()=>{root.render(React.createElement(App))})
})
after(async()=>{await act(async()=>root?.unmount());await server?.close();window?.happyDOM.abort()})
function button(text){const node=[...host.querySelectorAll('button')].find(n=>n.textContent.includes(text));assert.ok(node,'Button missing: '+text);return node}

test('offline map renders geography and Russian stops without requesting tile images',()=>{
  assert.equal(host.querySelectorAll('.leaflet-tile-pane img').length,0)
  assert.ok(host.querySelectorAll('.leaflet-overlay-pane path').length>10)
  assert.match(host.textContent,/Каспийское/)
  assert.match(host.textContent,/Астрахань/)
  assert.ok(!host.textContent.includes('API KEY REQUIRED'))
  assert.equal(host.querySelectorAll('nav button').length,3)
})
test('one action predicts both routes and keeps the map mounted when switching',async()=>{
  const map=host.querySelector('.route-map')
  await act(async()=>button('Рассчитать доставку').click())
  assert.deepEqual(requests.filter(r=>r.path==='/api/predict').map(r=>r.body.route_id),['main','alternative'])
  assert.match(host.textContent,/Прогноз и точность/)
  await act(async()=>button('Через Баку').click())
  assert.equal(host.querySelector('.route-map'),map)
  assert.match(host.querySelector('.delivery-summary').textContent,/77,1/)
  assert.equal(button('Через Баку').getAttribute('aria-pressed'),'true')
})
test('mobile picker opens and new shipment dialog submits the entered parameters',async()=>{
  await act(async()=>host.querySelector('.shipment-toggle').click())
  assert.equal(host.querySelector('.shipment-toggle').getAttribute('aria-expanded'),'true')
  await act(async()=>button('Новая отправка').click())
  const dialog=host.querySelector('dialog');assert.equal(dialog.open,true)
  dialog.querySelector('[name=name]').value='Новая перевозка'
  await act(async()=>dialog.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
  const creation=requests.find(r=>r.path==='/api/shipments'&&r.body)
  assert.equal(creation.body.name,'Новая перевозка')
  assert.equal(creation.body.weight_tonnes,20)
  assert.equal(creation.body.conditions.rail_delay,4)
  assert.ok(!host.querySelector('dialog'))
  assert.match(host.querySelector('.detail-heading').textContent,/Новая перевозка/)
  assert.equal(host.querySelector('.shipment-toggle').getAttribute('aria-expanded'),'false')
})

test('digital twin labels calculated location and risk action applies server route',async()=>{
  assert.match(host.textContent,/Расчётное местоположение · без GPS/)
  assert.match(host.textContent,/Центр рисков/)
  await act(async()=>button('Применить маршрут').click())
  assert.ok(requests.some(r=>r.path==='/api/shipments/SCT-NEW/route'&&r.body.route_id==='alternative'))
  assert.match(host.textContent,/Маршрут через Баку применён/)
  assert.equal(host.querySelector('.twin-metrics strong').textContent,'77,1 ч')
  assert.equal([...host.querySelectorAll('button')].some(b=>b.textContent.includes('Применить маршрут')),false)
})

test('document upload sends content and requires a separate pre-clearance action',async()=>{
  await act(async()=>button('Документы').click())
  const inputs=[...host.querySelectorAll('input[type=file]')]
  assert.equal(inputs.length,2)
  for(const [i,input] of inputs.entries()){
    const file={name:i?'packing_list.json':'invoice.json',size:100,text:async()=>JSON.stringify({shipment_id:'SCT-NEW',weight_tonnes:20,document_number:'DOC-'+i})}
    Object.defineProperty(input,'files',{value:[file],configurable:true})
    await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})))
  }
  const form=inputs[0].closest('form')
  await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
  const request=requests.find(r=>r.path==='/api/preclearance')
  assert.equal(JSON.parse(request.body.documents[0].content).weight_tonnes,20)
  assert.equal(currentCheck.status,'verified')
  await act(async()=>button('Передать на предварительное оформление').click())
  assert.equal(currentCheck.status,'approved')
  assert.match(host.textContent,/Pre-clearance пройдено/)
  Object.defineProperty(inputs[0],'files',{value:[],configurable:true})
  await act(async()=>inputs[0].dispatchEvent(new window.Event('change',{bubbles:true})))
  assert.equal(host.querySelector('.document-result'),null)
})
