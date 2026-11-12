import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPredictionRequest, validatePrediction } from '../src/services/prediction.ts'

test('forecast request sends only shipment and route; conditions come from server', () => {
  assert.deepEqual(buildPredictionRequest('SCT-001', 'alternative'), {shipment_id:'SCT-001',route_id:'alternative'})
  assert.throws(() => buildPredictionRequest('', 'main'))
  assert.throws(() => buildPredictionRequest('SCT-001', 'unknown'))
})
test('prediction rejects corrupt delay/risk/reasons and preserves Gemini metadata', () => {
  const result = {delay_hours:0,risk:'low',reasons:[],model:'gemini-3.8-flash',method:'external_llm',model_version:'test-version'}
  assert.deepEqual(validatePrediction(result), result)
  for (const bad of [{...result,delay_hours:-1},{...result,delay_hours:NaN},{...result,risk:'unknown'},{...result,reasons:[42]}]) assert.throws(() => validatePrediction(bad))
})
