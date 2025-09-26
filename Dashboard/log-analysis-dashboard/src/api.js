const API_BASE = "http://3.27.201.109:3000";

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function getToken() {
  const token = localStorage.getItem("token");
  
  return token && token !== "undefined" ? token : null;
}

export function clearToken() {
  localStorage.removeItem("token");
}

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": options.headers?.["Content-Type"] || "application/json",
    },
  });
  if (!res.ok) throw new Error("API error");
  return res.json();
}