import json

import httpx
import pytest
from app.data import SHIPMENTS
from app.services import prediction
from app.services.routing import calculate_routes


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-secret')
    monkeypatch.setenv('DEEPSEEK_MODEL', 'test-model')


def call():
    return prediction.predict(4, 90, shipment=SHIPMENTS['SCT-001'], wind_speed=17, wave_height=2.8, rail_delay=3)


def reply(data, finish='stop'):
    return httpx.Response(200, request=httpx.Request('POST', 'https://api.deepseek.com/chat/completions'),
                          json={'model':'test-model-version', 'choices':[{'finish_reason':finish, 'message':{'content':json.dumps(data)}}]})


def test_missing_key_has_no_fallback(monkeypatch):
    monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
    with pytest.raises(prediction.PredictionUnavailable, match='DEEPSEEK_API_KEY'):
        call()


def test_provider_receives_history_and_conditions(provider, monkeypatch):
    def post(self, url, **kwargs):
        assert url == 'https://api.deepseek.com/chat/completions'
        assert kwargs['headers']['Authorization'] == 'Bearer test-secret'
        body = kwargs['json']
        assert body['response_format'] == {'type':'json_object'}
        context = json.loads(body['messages'][1]['content'])
        assert len(context['historical_observations']) == 200
        assert context['conditions']['wind_speed'] == 17
        assert context['conditions']['rail_delay'] == 3
        assert context['synthetic'] is True
        return reply({'delay_hours':8.7, 'risk':'high', 'reasons':['Сильный ветер и загрузка порта']})
    monkeypatch.setattr(httpx.Client, 'post', post)
    result = call()
    assert result['delay_hours'] == 8.7
    assert result['method'] == 'external_llm'
    assert result['model_version'] == 'test-model-version'
    assert 'test-secret' not in json.dumps(result)


@pytest.mark.parametrize('data', [
    {'delay_hours':-1, 'risk':'low', 'reasons':['x']},
    {'delay_hours':float('nan'), 'risk':'high', 'reasons':['x']},
    {'delay_hours':900, 'risk':'high', 'reasons':['x']},
    {'delay_hours':5, 'risk':'high', 'reasons':[]},
    {'delay_hours':5, 'risk':'low', 'reasons':['x']},
    {'delay_hours':'5', 'risk':'high', 'reasons':['x']},
])
def test_invalid_model_output_rejected(provider, monkeypatch, data):
    monkeypatch.setattr(httpx.Client, 'post', lambda *args, **kwargs: reply(data))
    with pytest.raises(prediction.PredictionUnavailable) as error:
        call()
    assert error.value.status_code == 502


@pytest.mark.parametrize('content,finish', [(' ', 'stop'), ('{', 'stop'), ('{}', 'length')])
def test_blank_malformed_truncated(provider, monkeypatch, content, finish):
    response = reply({})
    response = httpx.Response(200, request=response.request, json={'choices':[{'finish_reason':finish,'message':{'content':content}}]})
    monkeypatch.setattr(httpx.Client, 'post', lambda *args, **kwargs: response)
    with pytest.raises(prediction.PredictionUnavailable):
        call()


@pytest.mark.parametrize('status', [401, 402, 429, 500])
def test_provider_error_does_not_expose_secret(provider, monkeypatch, status):
    monkeypatch.setattr(httpx.Client, 'post', lambda *args, **kwargs: httpx.Response(status, request=httpx.Request('POST','https://api.deepseek.com/chat/completions'), text='test-secret'))
    with pytest.raises(prediction.PredictionUnavailable) as error:
        call()
    assert 'test-secret' not in str(error.value)


def test_timeout(provider, monkeypatch):
    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout('timeout')
    monkeypatch.setattr(httpx.Client, 'post', timeout)
    with pytest.raises(prediction.PredictionUnavailable) as error:
        call()
    assert error.value.status_code == 504


def test_route_delay_applies_only_to_selected_route():
    routes = calculate_routes({}, {'alternative':12})
    assert routes[0]['eta_hours'] == 72
    assert routes[1]['eta_hours'] == 82
    assert routes[0]['recommended']
    routes = calculate_routes({}, {'main':8, 'alternative':20})
    assert routes[0]['recommended']
    assert routes[1]['eta_hours'] == 90
