import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, AlertOctagon, Users, Map, LogOut } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import SOSEvents from './pages/SOSEvents';
import Volunteers from './pages/Volunteers';
import HeatMap from './pages/HeatMap';

function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const expectedPassword = import.meta.env.VITE_ADMIN_PASSWORD || 'SafeCircleAdmin2026!';
    if (password === expectedPassword) {
      localStorage.setItem('sc_admin_auth', 'true');
      navigate('/');
    } else {
      setError('Invalid admin password. Please try again.');
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-darkBg text-slate-100">
      <form onSubmit={handleLogin} className="w-full max-w-sm rounded-xl border border-darkBorder bg-darkCard p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center">
          <span className="text-6xl mb-3">🛡️</span>
          <h1 className="text-2xl font-black tracking-tight text-white">SafeCircle Admin</h1>
          <p className="text-sm text-slate-400 mt-1">Control Console & System Metrics</p>
        </div>

        {error && <div className="mb-4 text-xs font-bold text-red-400 bg-red-950/30 border border-red-800/40 p-3 rounded-lg">{error}</div>}

        <div className="mb-6">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Admin Security Key</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-darkBorder bg-darkBg p-3 text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder="••••••••••••••"
            required
          />
        </div>

        <button type="submit" className="w-full rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-950/20">
          Unlock Console
        </button>
      </form>
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('sc_admin_auth');
    navigate('/login');
  };

  const menuItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/sos', label: 'SOS Events', icon: AlertOctagon },
    { path: '/volunteers', label: 'Volunteers', icon: Users },
    { path: '/heatmap', label: 'Threat Heatmap', icon: Map },
  ];

  return (
    <aside className="w-64 border-r border-darkBorder bg-darkCard flex flex-col">
      {/* Brand header */}
      <div className="p-6 flex items-center gap-3 border-b border-darkBorder">
        <span className="text-3xl">🛡️</span>
        <div>
          <h1 className="text-lg font-black text-white leading-none">SafeCircle</h1>
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Admin Console</span>
        </div>
      </div>

      {/* Nav Menu */}
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-red-600/10 text-red-500 border-l-4 border-red-500'
                  : 'text-slate-400 hover:bg-darkBorder hover:text-slate-100'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout footer */}
      <div className="p-4 border-t border-darkBorder">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold text-slate-400 hover:bg-red-950/20 hover:text-red-400 transition-colors"
        >
          <LogOut size={18} />
          Lock Console
        </button>
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-darkBg text-slate-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-y-auto">
        <header className="h-16 border-b border-darkBorder flex items-center justify-between px-8 bg-darkCard/50 backdrop-blur-sm">
          <h2 className="text-sm font-bold text-slate-300">SYSTEM TELEMETRY ENGINE</h2>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-400">ML Backend Link: Active</span>
          </div>
        </header>
        <div className="p-8 flex-1">
          {children}
        </div>
      </main>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuth = localStorage.getItem('sc_admin_auth') === 'true';
  return isAuth ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sos"
          element={
            <ProtectedRoute>
              <SOSEvents />
            </ProtectedRoute>
          }
        />
        <Route
          path="/volunteers"
          element={
            <ProtectedRoute>
              <Volunteers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/heatmap"
          element={
            <ProtectedRoute>
              <HeatMap />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
