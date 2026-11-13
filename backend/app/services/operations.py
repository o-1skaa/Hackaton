"""Calculated shipment state and explicit demo rules; no GPS or weather ML."""
from datetime import datetime, timedelta, timezone


def weather_risks(conditions):
    output = []
    for field, title, unit, medium, critical in [('wind_speed', 'Ветер', 'м/с', 12, 20), ('wave_height', 'Волны', 'м', 2, 4)]:
        value = conditions.get(field, 0)
        level = 'critical' if value >= critical else 'medium' if value >= medium else 'low'
        output.append(dict(code=field, title=title, value=value, unit=unit, level=level,
                           description='Критические условия' if level == 'critical' else 'Повышенный риск' if level == 'medium' else 'Нормальные условия'))
    return output


def risk_center(route, conditions):
    risks = []
    def add(code, title, level, recommendation, action=False):
        risks.append(dict(code=code, title=title, level=level, recommendation=recommendation,
                          route_action=action, source='Демонстрационные правила'))
    ferry = route['transfer']['applicable']
    if conditions.get('port_load', 0) >= 85 and ferry:
        add('port_load', 'Высокая загруженность порта', 'high', 'Рассмотреть сухопутный маршрут через Баку', True)
    for weather in weather_risks(conditions):
        if weather['level'] != 'low' and ferry:
            add(weather['code'], f"{weather['title']}: {weather['value']} {weather['unit']}", weather['level'],
                'Рассмотреть маршрут без парома' if weather['level'] == 'critical' else 'Контролировать паромную переправу', weather['level'] == 'critical')
    if conditions.get('rail_delay', 0) > 0:
        add('rail_delay', f"Опоздание поезда: {conditions['rail_delay']} ч", 'high' if conditions['rail_delay'] > 1 else 'medium',
            'Проверить обновлённый ETA и стыковку' if ferry else 'Учтено в сроке железнодорожного участка')
    if ferry and route['transfer']['missed_ferry']:
        add('missed_ferry', 'Риск пропуска планового парома', 'critical',
            f"Следующий рейс на {route['transfer']['ferry_departure_hours']}-м часу. Сравните сухопутную альтернативу", True)
    order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    return sorted(risks, key=lambda r: order[r['level']])


def twin(shipment, route, now=None):
    now = now or datetime.now(timezone.utc)
    start = datetime.fromisoformat(shipment.get('departure_at', '2026-11-12T00:00:00+00:00').replace('Z', '+00:00'))
    elapsed = (now-start).total_seconds()/3600
    rail_delay = shipment.get('conditions', {}).get('rail_delay', 0)
    ferry = route['transfer']['applicable']
    offset = shipment.get('route_start_offset_hours', 0) if not ferry else 0
    rail_end = route['transfer']['actual_train_arrival_hours'] if ferry else offset+20+rail_delay
    ferry_start = route['transfer']['ferry_departure_hours'] if ferry else 0
    milestones = [('Астрахань', 0), ('Махачкала', rail_end), ('Энзели', ferry_start+18), ('Бендер-Аббас', route['eta_hours'])] if ferry else [('Астрахань', 0), ('Махачкала', 12+rail_delay), ('Баку', rail_end), ('Бендер-Аббас', route['eta_hours'])]
    stages = []
    for i, (name, arrival) in enumerate(milestones):
        status = 'completed' if elapsed >= arrival else 'pending'
        if i < len(milestones)-1 and arrival <= elapsed < milestones[i+1][1]:
            status = 'current'
        stages.append(dict(name=name, status=status, arrival_at=(start+timedelta(hours=arrival)).isoformat()))
    finished = elapsed >= route['eta_hours']
    waiting = ferry and rail_end <= elapsed < ferry_start
    if elapsed < 0:
        location, phase = 'Астрахань', 'Ожидает отправления'
    elif finished:
        location, phase = 'Бендер-Аббас', 'Доставка завершена по расчёту'
    elif waiting:
        location, phase = 'Махачкала', 'Ожидание парома'
    elif elapsed < rail_end:
        location, phase = ('Астрахань → Махачкала' if ferry else 'Астрахань → Баку'), 'Железнодорожная перевозка'
    elif ferry and elapsed < ferry_start+18:
        location, phase = 'Махачкала → Энзели', 'Паромная переправа'
    else:
        location, phase = ('Энзели' if ferry else 'Баку')+' → Бендер-Аббас', 'Автомобильная перевозка'
    legs = []
    bounds = [(0, rail_end), (rail_end, ferry_start+18), (ferry_start+18, route['eta_hours'])] if ferry else [(0, rail_end), (rail_end, route['eta_hours'])]
    for leg, (begin, end) in zip(route['legs'], bounds):
        status = 'completed' if elapsed >= end else 'pending' if elapsed < begin else 'waiting' if waiting and leg['mode']=='ferry' else 'current'
        legs.append({'mode': leg['mode'], 'from': leg['stops'][0], 'to': leg['stops'][-1], 'status': status})
    return dict(route_id=route['route_id'], as_of=now.isoformat(), location=location, location_source='calculated',
                current_stage=phase, next_stop=next((s['name'] for s in stages if s['status']=='pending'), None),
                stages=stages, transport=legs, eta_hours=route['eta_hours'], remaining_hours=round(max(0,route['eta_hours']-max(0,elapsed)),2),
                planned_eta_at=(start+timedelta(hours=shipment.get("planned_eta_hours",74 if ferry else 70))).isoformat(), eta_at=route['eta_at'],
                co2_kg=route['co2_kg'], status='completed' if finished else 'pending' if elapsed<0 else 'in_transit',
                missed_connection=ferry and route['transfer']['missed_ferry'], synthetic=True)
