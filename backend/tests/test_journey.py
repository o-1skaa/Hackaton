import json
from fastapi.testclient import TestClient
import app.main as main

def payload():
    return {'name':'Репетиция перевозки','weight_tonnes':20,'departure_at':'2026-11-12T08:00:00Z',
            'conditions':{'weather_severity':3,'port_load':70,'wind_speed':10,'wave_height':1,'rail_delay':4}}

def test_create_predict_transfer_documents_restart():
    with TestClient(main.app) as client:
        response = client.post('/api/shipments',json=payload())
        assert response.status_code == 201
        key = response.json()['id']
        for route in ['main','alternative']:
            prediction = client.post('/api/predict',json={'shipment_id':key,'route_id':route})
            assert prediction.status_code == 200
            assert prediction.json()['method'] == 'historical_knn'
        routes = client.get('/api/routes/'+key).json()
        for route in routes[:1]:
            assert route['transfer']['missed_ferry']
            assert route['transfer']['ferry_departure_hours'] == 38
            assert route['eta_hours'] == 98
            assert route['eta_at'] == '2026-11-16T10:00:00+00:00'
        assert routes[1]['eta_hours'] < routes[0]['eta_hours']
        assert client.get('/api/shipments/'+key+'/events').json()
        check = client.post('/api/preclearance',headers={'X-API-Key': main.DEMO_API_KEY},json={'shipment_id':key,'documents':[{'type':t,'filename':t+'.json','content':json.dumps(dict(shipment_id=key,weight_tonnes=20,document_number=t))} for t in ['invoice','packing_list']]})
        assert check.json()['status'] == 'verified'
        assert client.post('/api/preclearance/'+check.json()['check_id']+'/submit',headers={'X-API-Key':main.DEMO_API_KEY}).json()['status'] == 'approved'
    main.SHIPMENTS.pop(key)
    with TestClient(main.app) as restarted:
        assert restarted.get('/api/shipments/'+key).status_code == 200
        assert restarted.get('/api/prediction-context/'+key).json()['conditions'] == payload()['conditions']

def test_bad_create_inputs():
    with TestClient(main.app) as client:
        for bad in [dict(weight_tonnes=0),dict(name=' '),dict(departure_at='not a date'),dict(conditions={'port_load':-1})]:
            assert client.post('/api/shipments',json={**payload(),**bad}).status_code == 422
