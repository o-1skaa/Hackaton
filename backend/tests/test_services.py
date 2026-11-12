import pytest
from app.data import SHIPMENTS
from app.services import prediction
from app.services.routing import calculate_routes


@pytest.mark.parametrize('scenario', prediction.SCENARIOS)
def test_each_random_scenario_has_consistent_delay_and_reason(monkeypatch, scenario):
    monkeypatch.setattr(prediction, 'choice', lambda values: scenario)
    result = prediction.predict(shipment=SHIPMENTS['SCT-001'], source={}, route_id='alternative')
    assert result['delay_hours'] == scenario[1]
    assert result['reasons'] == [scenario[2]]
    assert result['risk'] == ('low' if scenario[1] < 2 else 'medium' if scenario[1] < 4 else 'high')
    assert result['route_id'] == 'alternative'
    assert result['method'] == 'demo_random'


def test_route_delay_applies_only_to_selected_route():
    routes = calculate_routes({}, {'alternative':12})
    assert routes[0]['eta_hours'] == 72
    assert routes[1]['eta_hours'] == 82
    assert routes[0]['recommended']
    routes = calculate_routes({}, {'main':8, 'alternative':20})
    assert routes[0]['recommended']
    assert routes[1]['eta_hours'] == 90


def test_map_routes_have_shared_endpoints_and_distinct_transit():
    main, alternative = calculate_routes({}, {})
    assert main['waypoints'][0] == alternative['waypoints'][0]
    assert main['waypoints'][-1] == alternative['waypoints'][-1]
    assert (42.98, 47.50) in main['waypoints']
    assert (40.41, 49.87) in alternative['waypoints']
    assert main['waypoints'] != alternative['waypoints']
    for route in (main, alternative):
        assert all(-90 <= lat <= 90 and -180 <= lng <= 180 for lat, lng in route['waypoints'])
