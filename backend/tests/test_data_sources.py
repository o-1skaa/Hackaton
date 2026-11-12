import json
import pytest
from app.data import SHIPMENTS
from app.services.data_sources import refresh_snapshots, OBSERVATIONS_PATH


def test_each_run_uses_new_file_observations_without_mutating_pool(tmp_path):
    original = OBSERVATIONS_PATH.read_bytes()
    pool = json.loads(original)
    runtime = tmp_path / 'runtime.json'
    first = refresh_snapshots(SHIPMENTS, runtime_path=runtime)
    second = refresh_snapshots(SHIPMENTS, runtime_path=runtime)
    for shipment_id in SHIPMENTS:
        assert first[shipment_id]['conditions'] != second[shipment_id]['conditions']
        assert first[shipment_id]['snapshot_id'] != second[shipment_id]['snapshot_id']
        assert second[shipment_id]['conditions'] in [row['conditions'] for row in pool[shipment_id]]
    assert json.loads(runtime.read_text()) == second
    assert OBSERVATIONS_PATH.read_bytes() == original


def test_invalid_source_data_prevents_startup(tmp_path):
    source = tmp_path / 'invalid.json'
    source.write_text(json.dumps({'SCT-001':[{'observation_id':'x','conditions':{'weather_severity':999},'sources':[{'name':'x'}]}]}))
    with pytest.raises(ValueError):
        refresh_snapshots(['SCT-001'], observations_path=source, runtime_path=tmp_path/'runtime.json')
    assert not (tmp_path/'runtime.json').exists()
