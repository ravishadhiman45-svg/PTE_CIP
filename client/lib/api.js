// Fetch wrapper that attaches the JWT and a SWR-compatible fetcher.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const TOKEN_KEY = 'ptecip_token';
const USER_KEY = 'ptecip_user';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  // For file uploads the browser must set its own multipart boundary,
  // so never force a JSON Content-Type on FormData bodies.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth')) {
    clearSession();
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    // Some failures carry structured detail beyond the message — the bulk
    // employee import answers a 400 with a per-row breakdown. Callers that know
    // to look for it read `err.body`; everyone else keeps using `err.message`.
    err.body = data;
    throw err;
  }
  return data;
}

// SWR fetcher: fetcher(path)
export const fetcher = (path) => request(path);

// Pulls a binary response (currently the CV PDF) and hands it to the browser as
// a download. It cannot be a plain <a href> because the API is on another origin
// and needs the Authorization header, which a navigation cannot carry.
//
// `fallbackName` is used only if the server sends no Content-Disposition.
async function download(path, fallbackName) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession();
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }

  if (!res.ok) {
    // Errors still come back as JSON, so read this one as text.
    let message = `Request failed (${res.status})`;
    try {
      const body = JSON.parse(await res.text());
      if (body && body.error) message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const name = filenameFromDisposition(res.headers.get('content-disposition')) || fallbackName;
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Firefox needs the url to outlive the click, so release it on the next tick.
  setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

function filenameFromDisposition(value) {
  if (!value) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(value);
  return match ? decodeURIComponent(match[1]) : null;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
  // Multipart upload (profile pictures). Pass a FormData instance.
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
  // Save a binary response to disk (CV PDF).
  download,
  // Google Sign-In: exchange the Google ID token for an app JWT.
  google: (credential) =>
    request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  // Email + shared-password sign-in.
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
};

export { API_URL };
