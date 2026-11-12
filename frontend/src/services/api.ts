const API_URL = "http://127.0.0.1:8000";

export async function getShipments() {
  const response = await fetch(`${API_URL}/api/shipments`);

  if (!response.ok) {
    throw new Error("Не удалось загрузить грузы");
  }

  return response.json();
}
