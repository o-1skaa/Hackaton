export interface Shipment { id: string; name: string; origin: string; destination: string; status: 'pending' | 'in_transit' | 'completed'; synthetic: true }
export interface Detail extends Shipment { historical_avg_delay_hours: number; stages: {name: string; status: string}[]; preclearance_status: string; last_delay_hours: number | null }
export interface Route { route_id: string; name: string; distance_km: number; eta_hours: number; co2_kg: number; recommended: boolean; reason: string }
export interface Event { timestamp: string; event: string; details: string }
export interface Prediction { delay_hours: number; risk: 'low' | 'medium' | 'high'; reasons: string[]; model?: string; model_version?: string; method?: string }
export interface Check { check_id: string; shipment_id: string; status: string; reasons: string[]; documents: {type: string; filename: string}[] }
const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
export async function api<T>(path: string, body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try { response = await fetch(base + path, { signal, method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(key ? {'X-API-Key': key} : {}) }, ...(body === undefined ? {} : {body: JSON.stringify(body)}) }) } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Нет связи с API. Проверьте, что backend запущен, и повторите запрос.', {cause: error})
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? `Ошибка сервера: ${response.status}`)
  if (data === null) throw new Error('API вернул пустой ответ или HTML вместо JSON. Проверьте адрес сервера.')
  return data as T
}
export const getShipments = () => api<Shipment[]>('/api/shipments')
