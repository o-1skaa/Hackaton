"""Deterministic nearest-neighbour forecast with a fixed held-out evaluation."""
import csv
from functools import lru_cache
from pathlib import Path
from statistics import mean

@lru_cache
def history():
    with (Path(__file__).resolve().parents[2] / 'data/history.csv').open() as stream:
        rows = [{k: float(v) for k, v in row.items()} for row in csv.DictReader(stream)]
    return rows[:160], rows[160:]

def estimate(conditions, train):
    nearest = sorted(train, key=lambda row: ((row['weather_severity']-conditions['weather_severity'])/5)**2 + ((row['port_load']-conditions['port_load'])/100)**2)[:8]
    return mean(row['actual_delay_hours'] for row in nearest)

@lru_cache
def metrics():
    train, test = history()
    baseline = mean(row['actual_delay_hours'] for row in train)
    return {'train_count': len(train), 'test_count': len(test), 'split': 'Первые 160 строк для обучения, последние 40 для проверки',
            'model_mae_hours': round(mean(abs(estimate(row, train)-row['actual_delay_hours']) for row in test), 3),
            'baseline_mae_hours': round(mean(abs(baseline-row['actual_delay_hours']) for row in test), 3),
            'baseline_delay_hours': round(baseline, 3), 'synthetic': True,
            'scope': 'Ошибка портовой задержки на синтетической истории. Поезд и ожидание парома считаются отдельно по расписанию.'}

def provider_status():
    return {'provider': 'local', 'configured': True, 'method': 'historical_knn'}

def predict(*, shipment, source, route_id='main'):
    conditions = source['conditions']
    delay = round(estimate(conditions, history()[0]), 2)
    return {'delay_hours': delay, 'risk': 'low' if delay < 2 else 'medium' if delay < 4 else 'high',
            'reasons': [f"По 8 похожим наблюдениям: погода {conditions['weather_severity']}/5, загрузка порта {conditions['port_load']}%."],
            'method': 'historical_knn', 'route_id': route_id, 'synthetic': True, 'metrics': metrics()}
