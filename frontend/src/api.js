const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  devLogin(email) {
    return request('/api/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) });
  },
  getMe() {
    return request('/api/auth/me');
  },
  getUsers() {
    return request('/api/auth/users');
  },
  approveUser(id) {
    return request(`/api/auth/users/${id}/approve`, { method: 'PUT' });
  },
  rejectUser(id) {
    return request(`/api/auth/users/${id}/reject`, { method: 'PUT' });
  },

  // Groups
  getGroups() {
    return request('/api/groups');
  },
  createGroup(data) {
    return request('/api/groups', { method: 'POST', body: JSON.stringify(data) });
  },
  updateGroup(id, data) {
    return request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteGroup(id) {
    return request(`/api/groups/${id}`, { method: 'DELETE' });
  },

  // Servers
  getServers(groupId) {
    const q = groupId ? `?group_id=${groupId}` : '';
    return request(`/api/servers${q}`);
  },
  getServer(id) {
    return request(`/api/servers/${id}`);
  },
  createServer(data) {
    return request('/api/servers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateServer(id, data) {
    return request(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteServer(id) {
    return request(`/api/servers/${id}`, { method: 'DELETE' });
  },
  getServerToken(id) {
    return request(`/api/servers/${id}/token`);
  },
  regenerateToken(id) {
    return request(`/api/servers/${id}/regenerate-token`, { method: 'POST' });
  },

  // Metrics
  getMetrics(serverId, hours = 24) {
    return request(`/api/metrics/${serverId}?hours=${hours}`);
  },

  // Events
  getEvents(serverId, level = '', limit = 100) {
    const params = new URLSearchParams({ limit });
    if (level) params.set('level', level);
    return request(`/api/events/${serverId}?${params}`);
  },

  // Telegram
  getTelegramConfig() {
    return request('/api/telegram/config');
  },
  updateTelegramConfig(data) {
    return request('/api/telegram/config', { method: 'PUT', body: JSON.stringify(data) });
  },
  testTelegram() {
    return request('/api/telegram/test', { method: 'POST' });
  },

  // Agent
  getAgentScripts() {
    return request('/api/agent/script');
  },
  getAgentScript(serverId) {
    return request(`/api/agent/script/${serverId}`);
  },
};
