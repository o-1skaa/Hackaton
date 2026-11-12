import pytest
from app.services import prediction
from app.services.routing import calculate_routes


@pytest.mark.parametrize("weather,load", [(-1, 20), (6, 20), (2, -1), (2, 101), (float("nan"), 20), (2, float("inf"))])
def test_prediction_rejects_invalid_values(weather, load):
    with pytest.raises(ValueError):
        prediction.predict_delay(weather, load)


def test_prediction_reads_nearest_records(tmp_path, monkeypatch):
    history = tmp_path / "history.csv"
    history.write_text("weather_severity,port_load,actual_delay_hours\n" +
                       "2,50,3\n" * 5 + "5,100,99\n", encoding="utf-8")
    monkeypatch.setattr(prediction, "HISTORY_PATH", history)
    assert prediction.predict_delay(2, 50) == 3


def test_empty_history(tmp_path, monkeypatch):
    history = tmp_path / "history.csv"
    history.write_text("weather_severity,port_load,actual_delay_hours\n", encoding="utf-8")
    monkeypatch.setattr(prediction, "HISTORY_PATH", history)
    with pytest.raises(ValueError, match="пуста"):
        prediction.predict_delay(2, 50)


@pytest.mark.parametrize("delay,risk", [(0, "low"), (1.9, "low"), (2, "medium"), (3.9, "medium"), (4, "high")])
def test_risk_boundaries(delay, risk):
    assert prediction.get_risk(delay) == risk


@pytest.mark.parametrize("delay,recommended", [(0, "main"), (4.9, "main"), (5, "alternative"), (10, "alternative")])
def test_route_policy(delay, recommended):
    routes = calculate_routes({}, delay)
    selected = [r for r in routes if r["recommended"]]
    assert len(selected) == 1
    assert selected[0]["route_id"] == recommended
    assert routes[0]["eta_hours"] == round(72 + delay, 1)
    assert selected[0]["reason"]
