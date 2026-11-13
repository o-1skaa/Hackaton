"""One geometry per leg supplies map points, length and emissions."""
from math import asin, ceil, cos, radians, sin, sqrt
from datetime import datetime, timedelta, timezone

FACTORS = {'rail': 0.022, 'ferry': 0.016, 'road': 0.08}  # kg CO2e / tonne-km, illustrative assumptions
POINTS = {'Астрахань': (46.35,48.04), 'Махачкала': (42.98,47.50), 'Баку': (40.41,49.87), 'Астара': (38.45,48.87), 'Казвин': (36.27,50.00), 'Кум': (34.64,50.88), 'Йезд': (31.90,54.37), 'Сирджан': (29.60,55.00), 'Энзели': (37.47,49.46), 'Тегеран': (35.69,51.39), 'Исфахан': (32.65,51.68), 'Керман': (30.28,57.08), 'Бендер-Аббас': (27.18,56.27)}

def distance(points):
    total = 0
    for (a,b),(c,d) in zip(points, points[1:]):
        x,y = radians(c-a),radians(d-b)
        total += 6371*2*asin(sqrt(sin(x/2)**2+cos(radians(a))*cos(radians(c))*sin(y/2)**2))
    return round(total, 1)

def connection(rail_delay=0, port_delay=0):
    ready = 12 + rail_delay + port_delay + 1  # rail arrival + preparation
    departure = 14 + max(0, ceil((ready-14)/24))*24
    return {'planned_train_arrival_hours': 12, 'actual_train_arrival_hours': round(12+rail_delay,2),
            'ready_hours': round(ready,2), 'planned_ferry_departure_hours': 14,
            'ferry_departure_hours': departure, 'missed_ferry': departure>14,
            'wait_hours': round(departure-ready,2), 'delay_hours': departure-14,
            'interval_hours': 24}

def calculate_routes(shipment, predicted_delays):
    weight = shipment.get('weight_tonnes',20)
    rail_delay = shipment.get('conditions',{}).get('rail_delay',0)
    output = []
    for route_id, transit in [('main','Махачкала'),('alternative','Баку')]:
        definitions = [('rail',['Астрахань',transit],12), ('ferry',[transit,'Энзели'],18), ('road',['Энзели','Тегеран','Исфахан','Керман','Бендер-Аббас'],42)] if route_id == 'main' else [('rail',['Астрахань','Махачкала','Баку'],20), ('road',['Баку','Астара','Казвин','Кум','Йезд','Сирджан','Бендер-Аббас'],50)]
        legs = []
        for mode,names,duration in definitions:
            points = [POINTS[name] for name in names]
            km = distance(points)
            legs.append({'mode':mode,'stops':names,'waypoints':points,'distance_km':km,'duration_hours':duration,
                         'factor_kg_per_tkm':FACTORS[mode], 'co2_kg':round(km*weight*FACTORS[mode],2)})
        transfer = connection(rail_delay, predicted_delays.get(route_id,0))
        transfer['applicable'] = route_id == 'main'
        eta = round(sum(leg['duration_hours'] for leg in legs) + (2+transfer['delay_hours'] if route_id == 'main' else shipment.get('route_start_offset_hours',0)+rail_delay+predicted_delays.get(route_id,0)),2)
        start = datetime.fromisoformat(shipment.get('departure_at','2026-11-12T00:00:00+00:00').replace('Z','+00:00'))
        output.append({'route_id':route_id,'name':f'Астрахань → {transit} → Энзели → Бендер-Аббас' if route_id == 'main' else 'Астрахань → Баку → Бендер-Аббас (сухопутный)',
            'waypoints': [point for i,leg in enumerate(legs) for point in leg['waypoints'][int(i>0):]],
            'distance_km':round(sum(leg['distance_km'] for leg in legs),1), 'eta_hours':eta,
            'eta_at':(start+timedelta(hours=eta)).isoformat(), 'co2_kg':round(sum(leg['co2_kg'] for leg in legs),2),
            'recommended':False,'reason':'','legs':legs,'transfer':transfer})
    best = min(output,key=lambda r:(r['eta_hours'],r['co2_kg']))
    for route in output:
        route['recommended'] = route is best
        route['reason'] = 'Минимальный ETA, при равенстве меньше CO₂e' if route is best else 'Резервный маршрут'
    return output
