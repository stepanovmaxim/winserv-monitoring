import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth <= 1024); }
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  const link = (path, icon, label) => (
    <Link to={path} className={`sidebar-link ${location.pathname === path ? 'active' : ''}`} onClick={closeMenu}>
      <span className="icon">{icon}</span>
      {label}
    </Link>
  );

  return (
    <div className="layout" style={isMobile ? { display: 'block' } : {}}>
      {isMobile && (
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            position: 'fixed', top: 8, left: 8, zIndex: 200,
            width: 40, height: 40, fontSize: 20, color: '#e2e8f0',
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
        >☰</button>
      )}
      {isMobile && menuOpen && (
        <div
          onClick={closeMenu}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 149 }}
        />
      )}
      <aside
        style={isMobile ? {
          position: 'fixed', top: 0, left: menuOpen ? 0 : -260, bottom: 0, zIndex: 150,
          transition: 'left 0.3s', width: 260, background: '#1e293b',
          borderRight: '1px solid #334155', padding: '20px 0',
          display: 'flex', flexDirection: 'column',
        } : {}}
        className={!isMobile ? 'sidebar' : ''}
      >
        <div className="sidebar-logo">WinServ Monitor</div>
        <nav className="sidebar-nav">
          {link('/', '📊', 'Dashboard')}
          {link('/servers', '🖥', 'Servers')}
          {link('/events', '⚠', 'Events')}
          {user?.role === 'admin' && link('/groups', '📁', 'Groups')}
          {user?.role === 'admin' && link('/deploy', '🚀', 'Deploy')}
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
      <main style={isMobile ? { padding: '56px 12px 12px', width: '100%', maxWidth: '100vw', overflowX: 'hidden' } : {}} className={!isMobile ? 'main' : ''}>
        <Outlet />
      </main>
    </div>
  );
}
