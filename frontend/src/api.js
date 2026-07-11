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
  setUserRole(id, role) {
    return request(`/api/auth/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
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

  // Customers (tenants)
  getCustomers() {
    return request('/api/customers');
  },
  createCustomer(data) {
    return request('/api/customers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateCustomer(id, data) {
    return request(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteCustomer(id) {
    return request(`/api/customers/${id}`, { method: 'DELETE' });
  },
  getDomainMappings() {
    return request('/api/customers/domains');
  },
  setDomainMapping(domain, customer_id) {
    return request('/api/customers/domains', { method: 'PUT', body: JSON.stringify({ domain, customer_id }) });
  },
  deleteDomainMapping(domain) {
    return request(`/api/customers/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
  },

  // Actions: bulk + commands
  bulkAction(scope, scope_id, action) {
    return request('/api/actions/bulk', { method: 'POST', body: JSON.stringify({ scope, scope_id, action }) });
  },
  getCommands(serverId) {
    return request(`/api/commands/${serverId}`);
  },
  queueCommand(server_id, ctype, param) {
    return request('/api/commands', { method: 'POST', body: JSON.stringify({ server_id, ctype, param }) });
  },

  // Deep health
  getServerHealth(serverId) {
    return request(`/api/health-report/${serverId}`);
  },

  // External checks (agentless ping/tcp/http/tls)
  getChecks() {
    return request('/api/checks');
  },
  createCheck(data) {
    return request('/api/checks', { method: 'POST', body: JSON.stringify(data) });
  },
  updateCheck(id, data) {
    return request(`/api/checks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteCheck(id) {
    return request(`/api/checks/${id}`, { method: 'DELETE' });
  },
  runCheck(id) {
    return request(`/api/checks/${id}/run`, { method: 'POST' });
  },
  getCheckHistory(id) {
    return request(`/api/checks/${id}/history`);
  },

  // Alert journal
  getAlerts(params = '') {
    return request(`/api/alerts${params}`);
  },
  getUnackedCount() {
    return request('/api/alerts/unacked-count');
  },
  ackAlert(id) {
    return request(`/api/alerts/${id}/ack`, { method: 'POST' });
  },
  ackAllAlerts() {
    return request('/api/alerts/ack-all', { method: 'POST' });
  },
  snoozeAlert(id, minutes) {
    return request(`/api/alerts/${id}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }) });
  },

  // Public status page (management)
  setStatusPage(id, opts) {
    return request(`/api/customers/${id}/status-page`, { method: 'POST', body: JSON.stringify(opts) });
  },
  // Public status page (unauthenticated read — no token, no 401 redirect)
  async getPublicStatus(token) {
    const res = await fetch(`${API_BASE}/api/public/status/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'not found' : 'error');
    return res.json();
  },

  // Security
  getSecurityTop(hours = 24) {
    return request(`/api/security/top?hours=${hours}`);
  },
  getServerSecurity(serverId) {
    return request(`/api/security/${serverId}`);
  },

  // Agent version + reports
  getAgentVersion() {
    return request('/api/agent/version');
  },
  getUptimeReport(days = 30) {
    return request(`/api/reports/uptime?days=${days}`);
  },

  // Maintenance windows
  getMaintenance() {
    return request('/api/maintenance');
  },
  createMaintenance(data) {
    return request('/api/maintenance', { method: 'POST', body: JSON.stringify(data) });
  },
  deleteMaintenance(id) {
    return request(`/api/maintenance/${id}`, { method: 'DELETE' });
  },

  // Servers
  getServers(groupId, customerId) {
    const p = new URLSearchParams();
    if (groupId) p.set('group_id', groupId);
    if (customerId) p.set('customer_id', customerId);
    const q = p.toString();
    return request(`/api/servers${q ? '?' + q : ''}`);
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
  getMetricsLatest(serverId) {
    return request(`/api/metrics/${serverId}/latest`);
  },
  getMetricsRollup(serverId, hours = 720) {
    return request(`/api/metrics/${serverId}/rollup?hours=${hours}`);
  },

  // Action audit trail
  getActionAudit(limit = 100) {
    return request(`/api/actions/audit?limit=${limit}`);
  },

  // Live event stream URL (EventSource can't set headers, so token goes in query)
  streamUrl() {
    const token = localStorage.getItem('token');
    return `${API_BASE}/api/stream?token=${encodeURIComponent(token || '')}`;
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
