import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { api } from '../api';

export default function Layout() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [unacked, setUnacked] = useState(0);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth <= 1024); }
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Poll unacknowledged alert count for the nav badge.
  useEffect(() => {
    let alive = true;
    const poll = () => api.getUnackedCount().then(r => { if (alive) setUnacked(r.count || 0); }).catch(() => {});
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname]);

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
            width: 40, height: 40, fontSize: 20, color: 'var(--text)',
            background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 10,
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
          position: 'fixed', top: 0, left: menuOpen ? 0 : -270, bottom: 0, zIndex: 150,
          transition: 'left 0.3s', width: 260, background: 'var(--bg-card)',
          borderRight: '1px solid var(--border)', padding: '20px 0',
          display: 'flex', flexDirection: 'column',
        } : {}}
        className={!isMobile ? 'sidebar' : ''}
      >
        <div className="sidebar-logo">WinServ Monitor</div>
        <nav className="sidebar-nav">
          {link('/servers', '🖥', t('nav.servers'))}
          <Link to="/alerts" className={`sidebar-link ${location.pathname === '/alerts' ? 'active' : ''}`} onClick={closeMenu}>
            <span className="icon">🔔</span>
            {t('nav.alerts')}
            {unacked > 0 && (
              <span style={{ marginLeft: 'auto', background: 'var(--danger)', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>
                {unacked > 99 ? '99+' : unacked}
              </span>
            )}
          </Link>
          {link('/checks', '📡', t('nav.checks'))}
          {link('/workstations', '💻', t('nav.workstations'))}
          {link('/reports', '📈', t('nav.reports'))}
          {user?.role === 'admin' && link('/customers', '🏢', t('nav.customers'))}
          {user?.role === 'admin' && link('/groups', '📁', t('nav.groups'))}
          {user?.role === 'admin' && link('/deploy', '🚀', t('nav.deploy'))}
          {user?.role === 'admin' && link('/actions', '🔧', t('nav.actions'))}
          {user?.role === 'admin' && link('/maintenance', '⏸', t('nav.maintenance'))}
          {user?.role === 'admin' && link('/security', '🛡', t('nav.security'))}
          {user?.role === 'admin' && link('/audit', '📜', t('nav.audit'))}
          {user?.role === 'admin' && link('/settings', '⚙', t('nav.settings'))}
          {user?.role === 'admin' && link('/users', '👥', t('nav.users'))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {['ru', 'en'].map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={lang === l ? '' : 'secondary'}
                style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                {l}
              </button>
            ))}
          </div>
          <div className="sidebar-user">
            {user?.avatar_url && <img src={user.avatar_url} alt="" />}
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name || user?.email}</div>
              <div className="sidebar-user-role">{user?.role}</div>
            </div>
          </div>
          <button className="secondary" style={{ width: '100%' }} onClick={handleLogout}>{t('common.logout')}</button>
        </div>
      </aside>
      <main style={isMobile ? { padding: '56px 12px 12px', width: '100%', maxWidth: '100vw', overflowX: 'hidden' } : {}} className={!isMobile ? 'main' : ''}>
        <Outlet />
      </main>
    </div>
  );
}
