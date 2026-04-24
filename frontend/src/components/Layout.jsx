import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const link = (path, icon, label) => (
    <Link to={path} className={`sidebar-link ${location.pathname === path ? 'active' : ''}`}>
      <span className="icon">{icon}</span>
      {label}
    </Link>
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">WinServ Monitor</div>
        <nav className="sidebar-nav">
          {link('/', '📊', 'Dashboard')}
          {link('/servers', '🖥', 'Servers')}
          {link('/events', '⚠', 'Events')}
          {user?.role === 'admin' && link('/groups', '📁', 'Groups')}
          {user?.role === 'admin' && link('/settings', '⚙', 'Settings')}
          {user?.role === 'admin' && link('/users', '👥', 'Users')}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            {user?.avatar_url && <img src={user.avatar_url} alt="" />}
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || user?.email}</div>
              <div className="sidebar-user-role">{user?.role}</div>
            </div>
          </div>
          <button className="secondary" style={{ width: '100%' }} onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
