import pytest
from app.services.prediction import metrics, predict
from app.services.routing import calculate_routes, connection, distance

def test_prediction_is_repeatable_and_responds_to_conditions():
    low = {'conditions':{'weather_severity':0,'port_load':20}}
    high = {'conditions':{'weather_severity':5,'port_load':100}}
    assert predict(shipment={},source=low) == predict(shipment={},source=low)
    assert predict(shipment={},source=high)['delay_hours'] > predict(shipment={},source=low)['delay_hours']

def test_fixed_holdout_beats_training_mean():
    report = metrics()
    assert report['train_count'] == 160 and report['test_count'] == 40
    assert report['model_mae_hours'] < report['baseline_mae_hours']

@pytest.mark.parametrize('rail,port,missed,departure', [(0,0,False,14),(1,0,False,14),(1.01,0,True,38),(4,3,True,38),(50,0,True,86)])
def test_connection_boundaries(rail,port,missed,departure):
    result = connection(rail,port)
    assert result['missed_ferry'] == missed
    assert result['ferry_departure_hours'] == departure
    assert result['wait_hours'] >= 0

def test_route_totals_share_map_geometry_and_mass_scaling():
    for first, second in zip(calculate_routes({'weight_tonnes':20},{}),calculate_routes({'weight_tonnes':40},{})):
        assert first['distance_km'] == round(sum(leg['distance_km'] for leg in first['legs']),1)
        assert first['co2_kg'] == round(sum(leg['co2_kg'] for leg in first['legs']),2)
        assert second['co2_kg'] == pytest.approx(first['co2_kg']*2,abs=.03)
        for leg in first['legs']:
            assert leg['distance_km'] == distance(leg['waypoints'])
            assert leg['co2_kg'] == round(leg['distance_km']*20*leg['factor_kg_per_tkm'],2)
