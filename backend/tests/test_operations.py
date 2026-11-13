import json
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
import app.main as main
from app.services.operations import twin, weather_risks
from app.services.routing import calculate_routes


def create(client, hours_ago=0):
    return client.post('/api/shipments',json=dict(name='Риск стыковки',weight_tonnes=20,
        departure_at=(datetime.now(timezone.utc)-timedelta(hours=hours_ago)).isoformat(),
        conditions=dict(weather_severity=3,port_load=95,rail_delay=4,wind_speed=20,wave_height=4))).json()['id']


def package(key, weight=20):
    return dict(shipment_id=key, documents=[dict(type=kind, filename=kind+'.json',content=json.dumps(dict(
        shipment_id=key,weight_tonnes=weight,document_number=kind))) for kind in ['invoice','packing_list']])


def test_risk_apply_and_restart():
    with TestClient(main.app) as client:
        key=create(client,22)
        initial=client.get(f'/api/shipments/{key}/operations').json()
        assert initial['twin']['location']=='Махачкала'
        assert initial['twin']['current_stage']=='Ожидание парома'
        assert initial['twin']['location_source']=='calculated'
        assert initial['twin']['eta_hours']==98
        assert {r['code'] for r in initial['risks']}=={'port_load','wind_speed','wave_height','rail_delay','missed_ferry'}
        assert initial['can_apply']
        result=client.post(f'/api/shipments/{key}/route',json={'route_id':'alternative'})
        assert result.status_code==200
        after=result.json()
        assert after['twin']['route_id']=='alternative'
        assert after['twin']['co2_kg']!=initial['twin']['co2_kg']
        assert after['twin']['eta_hours']>80  # Waiting already spent at port is retained.
        assert {r['code'] for r in after['risks']}=={'rail_delay'}
        assert after['twin']['eta_at']!=initial['twin']['eta_at']
        assert client.post(f'/api/shipments/{key}/route',json={'route_id':'alternative'}).json()['twin']['eta_at']==after['twin']['eta_at']
        assert client.get(f'/api/shipments/{key}/events').json()[-1]['event']=='route_applied'
    main.SHIPMENTS.pop(key)
    with TestClient(main.app) as client:
        restored=client.get(f'/api/shipments/{key}/operations').json()
        assert restored['twin']['route_id']=='alternative'
        assert restored['twin']['eta_at']==after['twin']['eta_at']


def test_route_rejects_after_departure_and_invalid_route():
    with TestClient(main.app) as client:
        key=create(client,60)
        assert not client.get(f'/api/shipments/{key}/operations').json()['can_apply']
        assert client.post(f'/api/shipments/{key}/route',json={'route_id':'alternative'}).status_code==409
        assert client.post(f'/api/shipments/{key}/route',json={'route_id':'foo'}).status_code==422
        assert client.get('/api/shipments/missing/operations').status_code==404


@pytest.mark.parametrize('elapsed,phase,location', [(-1,'Ожидает отправления','Астрахань'),(5,'Железнодорожная перевозка','Астрахань → Махачкала'),(20,'Ожидание парома','Махачкала'),(40,'Паромная переправа','Махачкала → Энзели'),(65,'Автомобильная перевозка','Энзели → Бендер-Аббас'),(100,'Доставка завершена по расчёту','Бендер-Аббас')])
def test_calculated_timeline(elapsed,phase,location):
    start=datetime(2026,11,13,tzinfo=timezone.utc)
    shipment=dict(departure_at=start.isoformat(),conditions={'rail_delay':4})
    route=calculate_routes(shipment,{'main':3})[0]
    state=twin(shipment,route,start+timedelta(hours=elapsed))
    assert state['location']==location
    assert state['current_stage']==phase
    assert state['remaining_hours']>=0
    assert state['eta_hours']==98


@pytest.mark.parametrize('wind,wave,levels', [(5,1,['low','low']),(12,2,['medium','medium']),(20,4,['critical','critical'])])
def test_weather_thresholds(wind,wave,levels):
    assert [w['level'] for w in weather_risks(dict(wind_speed=wind,wave_height=wave))]==levels


def test_documents_verify_submit_persist_and_invalidate():
    headers={'X-API-Key':main.DEMO_API_KEY}
    with TestClient(main.app) as client:
        key=create(client)
        verified=client.post('/api/preclearance',headers=headers,json=package(key)).json()
        assert verified['status']=='verified'
        cid=verified['check_id']
        assert client.get('/api/preclearance/'+cid).json()['documents'][0]['status']=='verified'
        assert client.post(f'/api/preclearance/{cid}/submit').status_code==401
        assert client.post(f'/api/preclearance/{cid}/submit',headers=headers).json()['status']=='approved'
        events=client.get(f'/api/shipments/{key}/events').json()
        client.post(f'/api/preclearance/{cid}/submit',headers=headers)
        assert client.get(f'/api/shipments/{key}/events').json()==events
    main.PRECLEARANCE_CHECKS.clear()
    with TestClient(main.app) as client:
        assert client.get('/api/preclearance/'+cid).json()['status']=='approved'
        assert client.get('/api/shipments/'+key).json()['preclearance_status']=='approved'
        bad=package(key);bad['documents'][1]['content']=json.dumps(dict(shipment_id=key,weight_tonnes=21,document_number='PL'))
        rejected=client.post('/api/preclearance',headers=headers,json=bad).json()
        assert rejected['status']=='rejected'
        assert any('не совпадает' in r for r in rejected['reasons'])
        assert client.post(f'/api/preclearance/{cid}/submit',headers=headers).status_code==409
        assert client.post(f"/api/preclearance/{rejected['check_id']}/submit",headers=headers).status_code==409


@pytest.mark.parametrize('content',[None,'not JSON','[]','{}','{"shipment_id":"wrong","weight_tonnes":20,"document_number":"x"}','{"shipment_id":"SCT-001","weight_tonnes":"NaN","document_number":"x"}'])
def test_bad_document_content_is_rejected(content):
    with TestClient(main.app) as client:
        docs=package('SCT-001');docs['documents'][0]['content']=content
        response=client.post('/api/preclearance',json=docs,headers={'X-API-Key':main.DEMO_API_KEY})
        assert response.status_code==200
        assert response.json()['status']=='rejected'
        assert client.get('/api/preclearance/'+response.json()['check_id']).json()['documents'][0]['status']=='error'
