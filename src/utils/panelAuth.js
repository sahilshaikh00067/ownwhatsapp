export function panelAuthHeaders(headers = {}) {
  let panelToken = "";
  try {
    panelToken = JSON.parse(sessionStorage.getItem("user") || "{}").panelToken || "";
  } catch {
    panelToken = "";
  }
  return {
    ...headers,
    ...(panelToken ? { Authorization: `Bearer ${panelToken}` } : {}),
  };
}
