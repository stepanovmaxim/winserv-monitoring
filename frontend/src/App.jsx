import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Groups from './pages/Groups';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Users from './pages/Users';
import Deploy from './pages/Deploy';
import Actions from './pages/Actions';
import Audit from './pages/Audit';
import Customers from './pages/Customers';
import Maintenance from './pages/Maintenance';
import Reports from './pages/Reports';
import Security from './pages/Security';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role === 'pending') return (
    <div className="pending-message">
      <h2>Account pending approval</h2>
      <p>Please wait for an administrator to approve your account.</p>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>{user.email}</p>
      <button onClick={() => { localStorage.removeItem('token'); window.location.href = '/login'; }} style={{ marginTop: 16 }}>Switch account</button>
    </div>
  );
  return children;
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth-callback" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Navigate to="/servers" />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/customers" element={<AdminRoute><Customers /></AdminRoute>} />
        <Route path="/groups" element={<AdminRoute><Groups /></AdminRoute>} />
        <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/users" element={<AdminRoute><Users /></AdminRoute>} />
        <Route path="/deploy" element={<AdminRoute><Deploy /></AdminRoute>} />
        <Route path="/actions" element={<AdminRoute><Actions /></AdminRoute>} />
        <Route path="/audit" element={<AdminRoute><Audit /></AdminRoute>} />
        <Route path="/maintenance" element={<AdminRoute><Maintenance /></AdminRoute>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/security" element={<AdminRoute><Security /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
