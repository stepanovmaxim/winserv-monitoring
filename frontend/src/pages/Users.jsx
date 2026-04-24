import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    api.getUsers().then(setUsers).finally(() => setLoading(false));
  }

  async function handleApprove(id) {
    await api.approveUser(id);
    loadUsers();
  }

  async function handleReject(id) {
    await api.rejectUser(id);
    loadUsers();
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Users</h1></div>

      <div className="card">
        {users.length === 0 ? (
          <div className="empty"><div className="empty-icon">👥</div><p>No users yet</p></div>
        ) : (
          <table>
            <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Registered</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {u.avatar_url && <img src={u.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />}
                      {u.name}
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    {u.role === 'pending' && (
                      <>
                        <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleApprove(u.id)}>Approve</button>
                        <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => handleReject(u.id)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
