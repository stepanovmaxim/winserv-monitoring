import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Groups from './pages/Groups';
import Events from './pages/Events';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Users from './pages/Users';
import Deploy from './pages/Deploy';

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
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/groups" element={<AdminRoute><Groups /></AdminRoute>} />
        <Route path="/events" element={<Events />} />
        <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
        <Route path="/users" element={<AdminRoute><Users /></AdminRoute>} />
        <Route path="/deploy" element={<AdminRoute><Deploy /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
