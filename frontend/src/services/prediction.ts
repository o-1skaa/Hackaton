import type { Prediction } from './api'

export function buildPredictionRequest(shipmentId: string, routeId: string) {
  if (!shipmentId.trim()) throw new Error('Выберите груз')
  if (!['main', 'alternative'].includes(routeId)) throw new Error('Выберите маршрут')
  return {shipment_id: shipmentId, route_id: routeId}
}

export function validatePrediction(result: Prediction): Prediction {
  if (!Number.isFinite(result.delay_hours) || result.delay_hours < 0 || !['low', 'medium', 'high'].includes(result.risk) || !Array.isArray(result.reasons) || result.reasons.some(reason => typeof reason !== 'string')) {
    throw new Error('Сервер вернул некорректный прогноз')
  }
  return result
}
