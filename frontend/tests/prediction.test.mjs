import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readCapabilities, buildPredictionRequest, legacyCapabilities, validatePrediction } from '../src/services/prediction.ts'

const scenario = { weather_severity: 2, wind_speed: 8, wave_height: 1.5, port_load: 90, rail_delay: 3, route_id: 'main' }
const fields = ['shipment_id', 'wind_speed', 'wave_height', 'port_load', 'rail_delay', 'route_id']
const contract = (names, required = names) => ({ paths: { '/api/predict': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PredictRequest' } } } } } } }, components: { schemas: { PredictRequest: { properties: Object.fromEntries(names.map(name => [name, {type: 'string'}])), required } } } })

test('old API receives only inputs it actually uses; waves are never silently ignored', () => {
  const capabilities = readCapabilities(contract(legacyCapabilities.fields))
  assert.equal(capabilities.verified, true)
  assert.deepEqual(buildPredictionRequest('SCT-001', scenario, capabilities), { shipment_id: 'SCT-001', weather_severity: 2, port_load: 90 })
})
test('extended API receives physical conditions and route without inventing weather conversion', () => {
  assert.deepEqual(buildPredictionRequest('SCT-001', scenario, readCapabilities(contract(fields))), { shipment_id: 'SCT-001', wind_speed: 8, wave_height: 1.5, port_load: 90, rail_delay: 3, route_id: 'main' })
})
test('missing or incompatible schemas fail visibly', () => {
  assert.throws(() => readCapabilities({}))
  const capabilities = readCapabilities(contract([...fields, 'new_required_input']))
  assert.throws(() => buildPredictionRequest('SCT-001', scenario, capabilities), /new_required_input/)
})
test('invalid numbers, missing route and excessive port load cannot reach prediction API', () => {
  const capabilities = readCapabilities(contract(fields))
  for (const value of [NaN, Infinity, -1]) assert.throws(() => buildPredictionRequest('SCT-001', {...scenario, wave_height: value}, capabilities))
  assert.throws(() => buildPredictionRequest('SCT-001', {...scenario, port_load: 101}, capabilities))
  assert.throws(() => buildPredictionRequest('SCT-001', {...scenario, route_id: ''}, capabilities))
})
test('prediction rejects corrupt delay/risk/reasons, preserves model metadata and accepts zero', () => {
  const result = { delay_hours: 0, risk: 'low', reasons: [], model: 'delay-model', method: 'random_forest', model_version: 'v1' }
  assert.deepEqual(validatePrediction(result), result)
  for (const bad of [{...result, delay_hours: -1}, {...result, delay_hours: NaN}, {...result, risk: 'unknown'}, {...result, reasons: [42]}]) assert.throws(() => validatePrediction(bad))
})
