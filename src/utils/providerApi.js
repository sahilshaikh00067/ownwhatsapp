const API_BASE = (import.meta.env.VITE_DJANGO_API_URL || "https://ownwhatsapp-backend-django.onrender.com").replace(/\/$/, "");

function token() {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "{}").panelToken || "";
  } catch {
    return "";
  }
}

export async function providerRequest(path, { method = "GET", body, file } = {}) {
  const headers = { Authorization: `Bearer ${token()}` };
  let payload;
  if (file) {
    payload = new FormData();
    payload.append("file", file);
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}/api/provider/${path.replace(/^\//, "")}`, {
      method,
      headers,
      body: payload,
    });
  } catch {
    throw new Error("Could not reach the Django API service.");
  }

  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : { error: (await response.text()).slice(0, 1000) };
  if (!response.ok) {
    throw new Error(result.error || result.detail || `Request failed (HTTP ${response.status}).`);
  }
  return result;
}

export { API_BASE };

