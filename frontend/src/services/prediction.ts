import type { Prediction } from './api'

export const physicalFields = ['wind_speed', 'wave_height', 'rail_delay', 'route_id'] as const
export type Scenario = { weather_severity: number; wind_speed: number; wave_height: number; port_load: number; rail_delay: number; route_id: string }
type Schema = { $ref?: string; properties?: Record<string, unknown>; required?: string[] }
export type Capabilities = { fields: string[]; required: string[]; verified: boolean }
export const legacyCapabilities: Capabilities = { fields: ['shipment_id', 'weather_severity', 'port_load'], required: ['shipment_id', 'weather_severity', 'port_load'], verified: false }

// FastAPI describes the request schema in OpenAPI. Only send advertised fields:
// Pydantic otherwise silently ignores unknown wave/wind inputs in the old API.
export function readCapabilities(document: unknown): Capabilities {
  const spec = document as { paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: Schema }> } } }>; components?: { schemas?: Record<string, Schema> } }
  let schema = spec?.paths?.['/api/predict']?.post?.requestBody?.content?.['application/json']?.schema
  if (schema?.$ref?.startsWith('#/components/schemas/')) schema = spec.components?.schemas?.[schema.$ref.split('/').pop()!]
  if (!schema?.properties?.shipment_id || !schema.properties.port_load) throw new Error('Не удалось определить контракт прогноза')
  return { fields: Object.keys(schema.properties), required: schema.required ?? [], verified: true }
}

export function buildPredictionRequest(shipmentId: string, scenario: Scenario, capabilities: Capabilities) {
  const values: Record<string, string | number> = { shipment_id: shipmentId, ...scenario }
  for (const field of capabilities.required) {
    if (!(field in values)) throw new Error(`Сервер требует неподдерживаемое поле: ${field}. Обновите интерфейс.`)
  }
  const body: Record<string, string | number> = {}
  for (const field of capabilities.fields) {
    if (!(field in values)) continue
    const value = values[field]
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw new Error('Параметры должны быть конечными неотрицательными числами')
    if ((field === 'port_load' && Number(value) > 100) || (field === 'weather_severity' && Number(value) > 5)) throw new Error('Параметр вне допустимого диапазона')
    if (typeof value === 'string' && !value.trim()) throw new Error('Выберите груз и маршрут')
    body[field] = value
  }
  return body
}

export function validatePrediction(result: Prediction): Prediction {
  if (!Number.isFinite(result.delay_hours) || result.delay_hours < 0 || !['low', 'medium', 'high'].includes(result.risk) || !Array.isArray(result.reasons) || result.reasons.some(reason => typeof reason !== 'string')) {
    throw new Error('Сервер вернул некорректный прогноз')
  }
  return result
}
