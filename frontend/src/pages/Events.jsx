import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Events() {
  const [servers, setServers] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [level, setLevel] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getServers().then(setServers); }, []);

  useEffect(() => {
    if (!selectedServer) { setEvents([]); return; }
    setLoading(true);
    api.getEvents(selectedServer, level, 200).then(setEvents).finally(() => setLoading(false));
  }, [selectedServer, level]);

  return (
    <div>
      <div className="page-header">
        <h1>System Events</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={selectedServer} onChange={e => setSelectedServer(e.target.value)}>
            <option value="">Select server...</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.hostname}</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value)}>
            <option value="">All Levels</option>
            <option value="Critical">Critical</option>
            <option value="Error">Error</option>
            <option value="Warning">Warning</option>
          </select>
        </div>
      </div>

      <div className="card">
        {!selectedServer ? (
          <div className="empty"><div className="empty-icon">⚠</div><p>Select a server to view its system events</p></div>
        ) : loading ? (
          <div className="loading">Loading events...</div>
        ) : events.length === 0 ? (
          <div className="empty"><p>No events found</p></div>
        ) : (
          <table>
            <thead><tr><th>Level</th><th>Source</th><th>Event ID</th><th>Message</th><th>Time</th></tr></thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td><span className={`badge badge-${(e.level || 'error').toLowerCase()}`}>{e.level}</span></td>
                  <td>{e.event_source}</td>
                  <td>{e.event_id}</td>
                  <td className="event-message" title={e.message}>{e.message}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(e.recorded_at || e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
