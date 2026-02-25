import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { PublicForm } from './pages/PublicForm';
import { StaffDashboard } from './pages/StaffDashboard';
import { Leaf, LayoutDashboard } from 'lucide-react';

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <Leaf className="h-6 w-6 text-emerald-600" />
              <span className="font-semibold text-xl tracking-tight text-slate-900">Reduced Waste Library</span>
            </div>
            <nav className="flex gap-4">
              <Link to="/" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">
                Public Form
              </Link>
              <Link to="/staff" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors flex items-center gap-1">
                <LayoutDashboard className="h-4 w-4" />
                Staff Dashboard
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<PublicForm />} />
          <Route path="/staff" element={<StaffDashboard />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
