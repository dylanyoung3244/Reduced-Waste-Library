import React, { useState, useEffect } from 'react';
import { InventoryItem, Request, Category, Item } from '../types';
import { Package, ClipboardList, ShoppingCart, Plus, Check, X, Download, Users, Edit, ChevronDown, ChevronUp, Trash2, ExternalLink, Upload, HelpCircle } from 'lucide-react';

const HelpModal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl font-bold">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto text-gray-700 space-y-4 text-left">
          {children}
        </div>
        <div className="p-4 border-t bg-gray-50 flex justify-end rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Understood</button>
        </div>
      </div>
    </div>
  );
};

const exportToCSV = (data: any[], filename: string) => {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(row => Object.values(row).map(val => `"${val}"`).join(',')).join('\n');
  const csv = `${headers}\n${rows}`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
};

export function StaffDashboard() {
  const [activeTab, setActiveTab] = useState<'inventory' | 'requests' | 'procurement' | 'history' | 'catalog' | 'users' | 'settings'>('inventory');
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const fetchWithAuth = async (url: string, options: any = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${currentUser?.token}`,
      'Content-Type': 'application/json'
    };
    return fetch(url, { ...options, headers });
  };

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (res.ok) {
        const userWithToken = { ...data.user, token: data.token };
        setCurrentUser(userWithToken);
        localStorage.setItem('user', JSON.stringify(userWithToken));
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      setLoginError('An error occurred during login');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('user');
  };

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">Staff Login</h2>
        {loginError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100">{loginError}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input 
              type="text" 
              required
              value={loginForm.username}
              onChange={e => setLoginForm({...loginForm, username: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              required
              value={loginForm.password}
              onChange={e => setLoginForm({...loginForm, password: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <button type="submit" className="w-full bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Staff Dashboard</h1>
        <div className="flex items-center gap-4">
          {currentUser.role === 'super_admin' && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showDeleted} 
                onChange={e => setShowDeleted(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Toggle Recycle Bin View
            </label>
          )}
          <span className="text-sm text-slate-600">Logged in as <span className="font-medium text-slate-900">{currentUser.full_name}</span></span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-medium">Logout</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-px overflow-x-auto">
        <TabButton active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} icon={<Package className="w-4 h-4" />}>Inventory</TabButton>
        <TabButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')} icon={<ClipboardList className="w-4 h-4" />}>Requests</TabButton>
        
        {currentUser.role !== 'user' && (
          <>
            <TabButton active={activeTab === 'procurement'} onClick={() => { setActiveTab('procurement'); setEditingOrder(null); }} icon={<ShoppingCart className="w-4 h-4" />}>Procurement</TabButton>
            <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<ClipboardList className="w-4 h-4" />}>Procurement History</TabButton>
            <TabButton active={activeTab === 'catalog'} onClick={() => setActiveTab('catalog')} icon={<Plus className="w-4 h-4" />}>Catalog</TabButton>
          </>
        )}
        
        {currentUser.role === 'super_admin' && (
          <>
            <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<Users className="w-4 h-4" />}>User Management</TabButton>
            <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<ClipboardList className="w-4 h-4" />}>System Logs & Settings</TabButton>
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 min-h-[500px]">
        {activeTab === 'inventory' && <InventoryView currentUser={currentUser} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'requests' && <RequestsView currentUser={currentUser} showDeleted={showDeleted} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'procurement' && <ProcurementView currentUser={currentUser} editOrder={editingOrder} onComplete={() => { setActiveTab('history'); setEditingOrder(null); }} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'history' && <ProcurementHistoryView currentUser={currentUser} showDeleted={showDeleted} onEditOrder={(order) => {
          setEditingOrder(order);
          setActiveTab('procurement');
        }} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'catalog' && <CatalogView currentUser={currentUser} showDeleted={showDeleted} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'users' && <UserManagementView currentUser={currentUser} fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'settings' && <SystemLogsSettingsView currentUser={currentUser} fetchWithAuth={fetchWithAuth} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children, icon }: { active: boolean, onClick: () => void, children: React.ReactNode, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active 
          ? 'border-emerald-600 text-emerald-600' 
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function InventoryView({ currentUser, fetchWithAuth }: { currentUser: any, fetchWithAuth: any }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInventory = () => {
    fetchWithAuth('/api/categories')
      .then((res: any) => res.json())
      .then((data: any) => {
        if (Array.isArray(data)) {
          setInventory(data);
        } else {
          console.error('Expected array but got:', data);
          setInventory([]);
        }
        setLoading(false);
      })
      .catch((err: any) => {
        console.error(err);
        setInventory([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-slate-900">Real-Time Inventory</h2>
        <button 
          onClick={() => exportToCSV(inventory, 'inventory.csv')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" /> Export to CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 rounded-tl-lg">Category Name</th>
              <th className="px-4 py-3">Total Procured</th>
              <th className="px-4 py-3">Checked Out</th>
              <th className="px-4 py-3 rounded-tr-lg">Available Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map(item => {
              const categoryName = (item as any).name || 'Unknown';
              const currentCount = item.current_count ?? 0;
              const totalProcured = item.total_procured ?? 0;
              const isDeleted = (item as any).is_deleted;
              
              return (
                <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors ${isDeleted ? 'bg-red-50/50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {categoryName}
                    {isDeleted && <span className="ml-2 text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">DELETED</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{totalProcured}</td>
                  <td className="px-4 py-3 text-slate-600">{item.total_checked_out || 0}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      currentCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {currentCount}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RequestsView({ currentUser, showDeleted, fetchWithAuth }: { currentUser: any, showDeleted: boolean, fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [requests, setRequests] = useState<Request[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  
  const [cursors, setCursors] = useState<(string | null)>([null]);
  const [page, setPage] = useState(0);
  const limit = 50;
  const [hasMore, setHasMore] = useState(true);

  const [requestFormData, setRequestFormData] = useState({
    requester_name: '',
    requester_email: '',
    requester_phone: '',
    department: '',
    event_name: '',
    check_out_date: '',
    check_in_date: '',
    status: 'Awaiting'
  });
  const [requestLineItems, setRequestLineItems] = useState<any[]>([]);

  const fetchData = (startAfter?: string | null) => {
    setLoading(true);
    const requestsUrl = `/api/requests?limit=${limit}${startAfter ? `&startAfter=${startAfter}` : ''}`;
    
    Promise.all([
      fetchWithAuth(requestsUrl).then((res: any) => res.json()),
      fetchWithAuth('/api/categories').then((res: any) => res.json())
    ]).then(([requestsData, categoriesData]) => {
      if (Array.isArray(requestsData)) {
        setRequests(requestsData);
        setHasMore(requestsData.length === limit);
      } else {
        console.error('Expected array but got:', requestsData);
        setRequests([]);
        setHasMore(false);
      }
      
      if (Array.isArray(categoriesData)) {
        setCategories(categoriesData);
      } else {
        console.error('Expected array but got:', categoriesData);
        setCategories([]);
      }
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchData(null);
  }, []);

  const handleNextPage = () => {
    if (requests.length > 0) {
      const lastId = requests[requests.length - 1].id;
      setPage(prev => prev + 1);
      fetchData(lastId);
    }
  };

  const handlePrevPage = () => {
    // Note: True bidirectional pagination with startAfter is complex without storing all cursors.
    // For simplicity, we'll just reload the first page if they go back, or we could track cursors.
    setPage(0);
    fetchData(null);
  };

  const handleEditRequest = (req: Request) => {
    setEditingRequest(req);
    setRequestFormData({
      requester_name: req.requester_name,
      requester_email: req.requester_email || '',
      requester_phone: req.requester_phone || '',
      department: req.department,
      event_name: req.event_name,
      check_out_date: req.check_out_date,
      check_in_date: req.check_in_date,
      status: req.status
    });
    setRequestLineItems(req.line_items || []);
    setIsFormOpen(true);
  };

  const handleDeleteRequest = async (id: string) => {
    if (confirm('Are you sure you want to delete this request? This action cannot be undone.')) {
      try {
        const response = await fetchWithAuth(`/api/requests/${id}`, { 
          method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete request');
        fetchData();
      } catch (error) {
        console.error(error);
        alert('Error deleting request');
      }
    }
  };

  const addRequestLineItem = () => {
    if (categories.length > 0) {
      setRequestLineItems([...requestLineItems, { 
        category_id: categories[0].id, 
        category_name: categories[0].name, 
        quantity: 1 
      }]);
    }
  };

  const updateRequestLineItem = (index: number, field: string, value: any) => {
    const newItems = [...requestLineItems];
    if (field === 'category_id') {
      const cat = categories.find(c => String(c.id) === String(value));
      newItems[index] = { ...newItems[index], category_id: value, category_name: cat?.name || 'Unknown' };
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
    }
    setRequestLineItems(newItems);
  };

  const removeRequestLineItem = (index: number) => {
    setRequestLineItems(requestLineItems.filter((_, i) => i !== index));
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingRequest ? `/api/requests/${editingRequest.id}` : '/api/requests';
    const method = editingRequest ? 'PUT' : 'POST';

    const payload = {
      ...requestFormData,
      line_items: requestLineItems,
      handled_by: currentUser.full_name
    };

    try {
      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Failed to save request');

      setIsFormOpen(false);
      setEditingRequest(null);
      setRequestFormData({
        requester_name: '',
        requester_email: '',
        requester_phone: '',
        department: '',
        event_name: '',
        check_out_date: '',
        check_in_date: '',
        status: 'Awaiting'
      });
      setRequestLineItems([]);
      fetchData();
    } catch (error) {
      console.error(error);
      alert('Error saving request');
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await fetchWithAuth(`/api/requests/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, handled_by: currentUser.full_name })
    });
    fetchData();
  };

  const handleRestoreRequest = async (id: string) => {
    if (confirm(`Are you sure you want to restore request ${id}?`)) {
      await fetchWithAuth(`/api/restore/requests/${id}`, {
        method: 'PUT'
      });
      fetchData();
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm border border-blue-100">
        <strong className="font-semibold">Workflow Guide:</strong> New requests start as Awaiting. Change to Approved to notify the user they can pick up the items. Change to Checked-out when items leave the building (this decreases inventory). Change to Checked-in when items are returned (this restores inventory for reusable items). Use Denied if the request cannot be fulfilled.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-900">Requests Queue</h2>
          <div className="flex gap-2">
            <button 
              onClick={() => {
                setEditingRequest(null);
                setRequestFormData({
                  requester_name: '',
                  requester_email: '',
                  requester_phone: '',
                  department: '',
                  event_name: '',
                  check_out_date: '',
                  check_in_date: '',
                  status: 'Awaiting'
                });
                setRequestLineItems([]);
                setIsFormOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Historical Request
            </button>
            <button 
              onClick={() => exportToCSV(requests.map(r => ({...r, line_items: JSON.stringify(r.line_items)})), 'requests.csv')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" /> Export to CSV
            </button>
            <button 
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <HelpCircle className="w-4 h-4" /> How to use this page
            </button>
          </div>
        </div>

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} title="Requests Workflow Walkthrough">
          <p><strong>What is this page?</strong> This is where you manage item requests submitted by staff or the public. You must update the status of each request as it moves through the real-world process.</p>
          <h3 className="font-bold text-lg mt-4 text-blue-800">The Step-by-Step Status Workflow:</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li><span className="bg-yellow-100 font-semibold px-1 rounded">Awaiting:</span> A brand new request. No action has been taken yet. Review it to see if we have enough inventory to fulfill it.</li>
            <li><span className="bg-blue-100 font-semibold px-1 rounded">Approved:</span> You have reviewed the request and set aside the items. <em>Action:</em> Changing the status to Approved will automatically email the requester telling them their items are ready for pickup!</li>
            <li><span className="bg-green-100 font-semibold px-1 rounded">Checked-out:</span> The person has physically picked up the items and left the building. <em>Action:</em> Changing to this status automatically subtracts the items from our inventory. If this causes an item to drop below its "Low Stock Threshold," the system will automatically email the team to reorder it.</li>
            <li><span className="bg-purple-100 font-semibold px-1 rounded">Checked-in:</span> The person has returned the items. <em>Action:</em> Changing to this status will automatically add reusable items back into our available inventory. Consumable items (like paper plates) will not be added back.</li>
            <li><span className="bg-red-100 font-semibold px-1 rounded">Denied:</span> We cannot fulfill the request. This restores the items to inventory if they were previously checked out.</li>
          </ul>
        </HelpModal>

        <div className="grid grid-cols-1 gap-2">
          {requests.filter(req => showDeleted ? req.is_deleted : !req.is_deleted).map(req => (
            <div key={req.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white hover:border-slate-300 transition-colors">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer"
                onClick={() => setExpandedRequest(expandedRequest === req.id ? null : req.id)}
              >
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="font-semibold text-slate-900 truncate">{req.requester_name}</div>
                  <div className="text-slate-600 truncate">{req.event_name}</div>
                  <div className="text-sm text-slate-500">{req.check_out_date} - {req.check_in_date}</div>
                </div>
                <div className="flex items-center gap-4 ml-4" onClick={e => e.stopPropagation()}>
                  <select 
                    value={req.status}
                    onChange={(e) => updateStatus(req.id, e.target.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border-0 outline-none cursor-pointer ${
                      req.status === 'Awaiting' ? 'bg-amber-100 text-amber-800' :
                      req.status === 'Approved' ? 'bg-blue-100 text-blue-800' :
                      req.status === 'Checked-out' ? 'bg-purple-100 text-purple-800' :
                      req.status === 'Checked-in' ? 'bg-emerald-100 text-emerald-800' :
                      req.status === 'Test' ? 'bg-slate-200 text-slate-700' :
                      'bg-red-100 text-red-800'
                    }`}
                  >
                    <option value="Awaiting">Awaiting</option>
                    <option value="Approved">Approved</option>
                    <option value="Checked-out">Checked-out</option>
                    <option value="Checked-in">Checked-in</option>
                    <option value="Denied">Denied</option>
                    <option value="Test">Test</option>
                  </select>
                  {expandedRequest === req.id ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
              </div>
              
              {expandedRequest === req.id && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-50 bg-slate-50/30">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <div className="text-xs font-semibold text-slate-400 uppercase">Contact Information</div>
                          <div className="text-sm text-slate-700">
                            {req.requester_email && <div>Email: {req.requester_email}</div>}
                            {req.requester_phone && <div>Phone: {req.requester_phone}</div>}
                            {!req.requester_email && !req.requester_phone && <span className="text-slate-400 italic">No contact info provided</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-400 uppercase">Department</div>
                          <div className="text-sm text-slate-700">{req.department}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-400 uppercase">Handled By</div>
                          <div className="text-sm text-slate-700">{req.handled_by || 'Unassigned'}</div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        {showDeleted ? (
                          <button 
                            onClick={() => handleRestoreRequest(req.id)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                          >
                            <Check className="w-4 h-4" /> Restore
                          </button>
                        ) : (
                          <>
                            <button 
                              onClick={() => handleEditRequest(req)}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              <Edit className="w-4 h-4" /> Edit Request
                            </button>
                            <button 
                              onClick={() => handleDeleteRequest(req.id)}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" /> Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Requested Items</h4>
                      <ul className="space-y-1">
                        {(req.line_items || []).map((item: any, index: number) => (
                          <li key={item.category_id || index} className="text-sm text-slate-700 flex justify-between">
                            <span>{item.category_name}</span>
                            <span className="font-medium">{item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {requests.filter(req => showDeleted ? req.is_deleted : !req.is_deleted).length === 0 && (
            <div className="text-center py-12 text-slate-500">No requests found.</div>
          )}
          
          <div className="flex justify-between items-center pt-4 border-t border-slate-100">
            <div className="text-sm text-slate-500">
              Page {page + 1}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handlePrevPage}
                disabled={page === 0}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                First Page
              </button>
              <button 
                onClick={handleNextPage}
                disabled={!hasMore}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Next Page
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Live Inventory</h2>
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
          <ul className="space-y-3">
            {categories.map(item => {
              const categoryName = (item as any).name || 'Unknown';
              const currentCount = (item as any).current_count ?? 0;
              
              return (
                <li key={item.id} className="flex justify-between items-center text-sm">
                  <span className="text-slate-700">{categoryName}</span>
                  <span className={`font-medium px-2 py-0.5 rounded-full ${
                    currentCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {currentCount}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-semibold text-slate-900">{editingRequest ? 'Edit Request' : 'Add Historical Request'}</h3>
              <button onClick={() => setIsFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSubmitRequest} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Requester Name</label>
                  <input required type="text" value={requestFormData.requester_name} onChange={e => setRequestFormData({...requestFormData, requester_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Department</label>
                  <input required type="text" value={requestFormData.department} onChange={e => setRequestFormData({...requestFormData, department: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Email Address</label>
                  <input type="email" value={requestFormData.requester_email} onChange={e => setRequestFormData({...requestFormData, requester_email: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Phone Number</label>
                  <input type="tel" value={requestFormData.requester_phone} onChange={e => setRequestFormData({...requestFormData, requester_phone: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-medium text-slate-700">Event Name</label>
                  <input required type="text" value={requestFormData.event_name} onChange={e => setRequestFormData({...requestFormData, event_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Check-out Date</label>
                  <input required type="date" value={requestFormData.check_out_date} onChange={e => setRequestFormData({...requestFormData, check_out_date: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Check-in Date</label>
                  <input required type="date" value={requestFormData.check_in_date} onChange={e => setRequestFormData({...requestFormData, check_in_date: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-medium text-slate-700">Status</label>
                  <select value={requestFormData.status} onChange={e => setRequestFormData({...requestFormData, status: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none">
                    <option value="Awaiting">Awaiting</option>
                    <option value="Approved">Approved</option>
                    <option value="Checked-out">Checked-out</option>
                    <option value="Checked-in">Checked-in</option>
                    <option value="Denied">Denied</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-semibold text-slate-900">Requested Items</h4>
                  <button type="button" onClick={addRequestLineItem} className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1">
                    <Plus className="w-4 h-4" /> Add Item
                  </button>
                </div>
                <div className="space-y-3">
                  {requestLineItems.map((item, i) => (
                    <div key={i} className="flex gap-3 items-end bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Category</label>
                        <select 
                          value={item.category_id} 
                          onChange={e => updateRequestLineItem(i, 'category_id', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                        >
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="w-24 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Quantity</label>
                        <input 
                          type="number" min="1" step="1"
                          value={item.quantity} 
                          onChange={e => updateRequestLineItem(i, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>
                      <button type="button" onClick={() => removeRequestLineItem(i)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 px-4 py-3 rounded-xl border border-slate-300 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="flex-1 bg-slate-900 text-white px-4 py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors">Save Request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function ProcurementView({ currentUser, editOrder, onComplete, fetchWithAuth }: { currentUser: any, editOrder?: any, onComplete?: () => void, fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [formData, setFormData] = useState({
    order_number: '',
    order_name: '',
    date_ordered: new Date().toISOString().split('T')[0],
    date_delivered: '',
    subtotal: 0,
    shipping: 0,
    tax: 0,
    total: 0,
    procurement_method: 'Credit Card'
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const [lineItems, setLineItems] = useState<{item_number: string, quantity: number, price: number}[]>([]);

  useEffect(() => {
    fetchWithAuth('/api/items')
      .then((res: any) => res.json())
      .then((data: any) => {
        if (Array.isArray(data)) {
          setItems(data);
        } else {
          console.error('Expected array but got:', data);
          setItems([]);
        }
      })
      .catch((err: any) => {
        console.error(err);
        setItems([]);
      });
  }, []);

  useEffect(() => {
    if (editOrder) {
      setFormData({
        order_number: editOrder.order_number,
        order_name: editOrder.order_name || '',
        date_ordered: editOrder.date_ordered || new Date().toISOString().split('T')[0],
        date_delivered: editOrder.date_delivered || '',
        subtotal: editOrder.subtotal || 0,
        shipping: editOrder.shipping || 0,
        tax: editOrder.tax || 0,
        total: editOrder.total || 0,
        procurement_method: editOrder.procurement_method || 'Credit Card'
      });
      setLineItems(editOrder.line_items || []);
    }
  }, [editOrder]);

  const addLineItem = () => {
    if (items.length > 0) {
      setLineItems([...lineItems, { item_number: items[0].item_number, quantity: 1, price: items[0].price }]);
    }
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Auto-update price if item changes
    if (field === 'item_number') {
      const selectedItem = items.find(i => i.item_number === value);
      if (selectedItem) {
        newItems[index].price = selectedItem.price;
      }
    }
    
    setLineItems(newItems);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Auto-calculate total
  useEffect(() => {
    const calculatedSubtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    setFormData(prev => ({
      ...prev,
      subtotal: calculatedSubtotal,
      total: calculatedSubtotal + prev.shipping + prev.tax
    }));
  }, [lineItems, formData.shipping, formData.tax]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lineItems.length === 0) {
      alert('Please add at least one line item.');
      return;
    }
    
    setIsUploading(true);
    let receipt_url = editOrder?.receipt_url || null;

    try {
      if (receiptFile) {
        const formDataUpload = new FormData();
        formDataUpload.append('receipt', receiptFile);
        
        const uploadRes = await fetchWithAuth('/api/upload-receipt', {
          method: 'POST',
          headers: { 'Content-Type': undefined }, // Let browser set boundary
          body: formDataUpload
        });
        
        if (!uploadRes.ok) {
          throw new Error('Failed to upload receipt');
        }
        
        const uploadData = await uploadRes.json();
        receipt_url = uploadData.url;
      }

      const url = editOrder ? `/api/orders/${editOrder.order_number}` : '/api/orders';
      const method = editOrder ? 'PUT' : 'POST';

      await fetchWithAuth(url, {
        method,
        body: JSON.stringify({
          ...formData,
          line_items: lineItems,
          receipt_url,
          logged_by: currentUser.full_name
        })
      });
      
      setFormData({
        order_number: '',
        order_name: '',
        date_ordered: new Date().toISOString().split('T')[0],
        date_delivered: '',
        subtotal: 0,
        shipping: 0,
        tax: 0,
        total: 0,
        procurement_method: 'Credit Card'
      });
      setLineItems([]);
      setReceiptFile(null);
      alert(editOrder ? 'Order updated successfully!' : 'Order logged successfully!');
      if (onComplete) onComplete();
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Error saving order');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm border border-blue-100">
        <strong className="font-semibold">Procurement Guide:</strong> Logging a new order automatically increases the Total Procured and Current Count for the category. If an item is part of a Kit, the system will automatically calculate the yield multiplier and distribute the inventory to the correct components. You may attach a PDF or image receipt for your records.
      </div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900">{editOrder ? 'Edit Order' : 'Log Incoming Order'}</h2>
        <button 
          onClick={() => setIsHelpOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
        >
          <HelpCircle className="w-4 h-4" /> How to use this page
        </button>
      </div>

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} title="Procurement (Orders) Walkthrough">
        <p><strong>What is this page?</strong> This is where you tell the system that you bought new items to restock the library.</p>
        <h3 className="font-bold text-lg mt-4 text-blue-800">How to Log a Restock:</h3>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Click <strong>Log Procurement</strong>.</li>
          <li>Enter the Order Number (from your receipt or invoice).</li>
          <li>Upload a PDF or photo of the receipt so the finance team has a permanent record.</li>
          <li>Add the items you bought. <em>Note:</em> The quantity you enter is the number of <strong>Packs</strong> you bought, not the individual items. The system will multiply your quantity by the item's Pack Size automatically!</li>
          <li>Click Save. The system instantly adds these items to your Total Inventory count so they are ready to be requested.</li>
        </ol>
      </HelpModal>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-4">
          <h3 className="font-medium text-slate-900 border-b border-slate-200 pb-2">Order Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Order Number</label>
              <input required type="text" disabled={!!editOrder} value={formData.order_number} onChange={e => setFormData({...formData, order_number: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50" placeholder="e.g. INV-2023-001" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Order Name (Optional)</label>
              <input type="text" value={formData.order_name} onChange={e => setFormData({...formData, order_name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="e.g. Fall Restock" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Date Ordered</label>
              <input required type="date" value={formData.date_ordered} onChange={e => setFormData({...formData, date_ordered: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Date Delivered (Optional)</label>
              <input type="date" value={formData.date_delivered} onChange={e => setFormData({...formData, date_delivered: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Procurement Method</label>
              <select value={formData.procurement_method} onChange={e => setFormData({...formData, procurement_method: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="Credit Card">Credit Card</option>
                <option value="Purchase Order">Purchase Order</option>
                <option value="Invoice">Invoice</option>
              </select>
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-slate-700">Receipt / Packing Slip</label>
              <input 
                type="file" 
                accept="image/*,.pdf"
                onChange={e => setReceiptFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" 
              />
              {editOrder?.receipt_url && !receiptFile && (
                <p className="text-sm text-slate-500 mt-1">
                  Current receipt: <a href={editOrder.receipt_url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">View File</a>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium text-slate-900">Line Items</h3>
            <button type="button" onClick={addLineItem} className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
          
          <div className="space-y-3">
            {lineItems.map((item, i) => (
              <div key={i} className="flex gap-3 items-end bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-slate-500">Item</label>
                  <select 
                    value={item.item_number} 
                    onChange={e => updateLineItem(i, 'item_number', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    {items.map(catalogItem => (
                      <option key={catalogItem.item_number} value={catalogItem.item_number}>
                        {catalogItem.name} ({catalogItem.item_number})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 space-y-1">
                  <label className="text-xs font-medium text-slate-500">Qty</label>
                  <input 
                    type="number" min="1" 
                    value={item.quantity} 
                    onChange={e => updateLineItem(i, 'quantity', parseInt(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="w-32 space-y-1">
                  <label className="text-xs font-medium text-slate-500">Price ($)</label>
                  <input 
                    type="number" step="0.01" min="0" 
                    value={item.price} 
                    onChange={e => updateLineItem(i, 'price', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <button type="button" onClick={() => removeLineItem(i)} className="p-2 text-slate-400 hover:text-red-500 transition-colors mb-0.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
            {lineItems.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 text-sm">
                No items added to this order yet.
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-4">
          <h3 className="font-medium text-slate-900 border-b border-slate-200 pb-2">Order Totals</h3>
          <div className="grid grid-cols-2 gap-4 max-w-md ml-auto">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Subtotal</span>
              <span className="font-medium">${formData.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Shipping</span>
              <input 
                type="number" step="0.01" min="0" 
                value={formData.shipping} 
                onChange={e => setFormData({...formData, shipping: parseFloat(e.target.value) || 0})}
                className="w-24 px-2 py-1 text-right rounded border border-slate-300 text-sm"
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Tax</span>
              <input 
                type="number" step="0.01" min="0" 
                value={formData.tax} 
                onChange={e => setFormData({...formData, tax: parseFloat(e.target.value) || 0})}
                className="w-24 px-2 py-1 text-right rounded border border-slate-300 text-sm"
              />
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-200 col-span-2">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold text-lg text-emerald-600">${formData.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <button type="submit" disabled={isUploading} className="w-full bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
          {isUploading ? 'Uploading & Submitting...' : 'Submit Complete Order'}
        </button>
      </form>
    </div>
  );
}

function ProcurementHistoryView({ currentUser, onEditOrder, showDeleted, fetchWithAuth }: { currentUser: any, onEditOrder: (order: any) => void, showDeleted: boolean, fetchWithAuth: any }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  
  const [page, setPage] = useState(0);
  const limit = 50;
  const [hasMore, setHasMore] = useState(true);

  const fetchOrders = async (startAfter?: string | null) => {
    try {
      setLoading(true);
      const url = `/api/orders?limit=${limit}${startAfter ? `&startAfter=${startAfter}` : ''}`;
      const res = await fetchWithAuth(url);
      if (!res.ok) console.error('Failed to fetch orders', await res.text());
      const data = await res.json();
      if (Array.isArray(data)) {
        setOrders(data);
        setHasMore(data.length === limit);
      } else {
        console.error('Expected array but got:', data);
        setOrders([]);
        setHasMore(false);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setOrders([]);
      setHasMore(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(null);
  }, []);

  const handleNextPage = () => {
    if (orders.length > 0) {
      const lastId = orders[orders.length - 1].order_number;
      setPage(prev => prev + 1);
      fetchOrders(lastId);
    }
  };

  const handlePrevPage = () => {
    setPage(0);
    fetchOrders(null);
  };

  const handleDelete = async (orderNumber: string) => {
    if (confirm(`Are you sure you want to delete order ${orderNumber}? This will remove all associated line items and update inventory counts.`)) {
      await fetchWithAuth(`/api/orders/${orderNumber}`, { 
        method: 'DELETE'
      });
      fetchOrders();
    }
  };

  const handleRestoreOrder = async (orderNumber: string) => {
    if (confirm(`Are you sure you want to restore order ${orderNumber}? This will re-apply all associated line items and update inventory counts.`)) {
      await fetchWithAuth(`/api/restore/orders/${orderNumber}`, {
        method: 'PUT'
      });
      fetchOrders();
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-slate-900">Procurement History</h2>
        <button 
          onClick={() => exportToCSV(orders.map(o => ({...o, line_items: JSON.stringify(o.line_items)})), 'procurement_history.csv')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" /> Export to CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 rounded-tl-lg">Order Number</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Date Ordered</th>
              <th className="px-4 py-3">Date Delivered</th>
              <th className="px-4 py-3">Logged By</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3 rounded-tr-lg text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.filter(order => showDeleted ? order.is_deleted : !order.is_deleted).map(order => (
              <React.Fragment key={order.order_number}>
                <tr className="hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => setExpandedOrder(expandedOrder === order.order_number ? null : order.order_number)}>
                  <td className="px-4 py-3 font-medium text-slate-900">{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{order.order_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_ordered}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_delivered || 'Pending'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.logged_by || '-'}</td>
                  <td className="px-4 py-3 font-medium text-emerald-600">${order.total?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {order.receipt_url && (
                      <a 
                        href={order.receipt_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Receipt
                      </a>
                    )}
                    {showDeleted ? (
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRestoreOrder(order.order_number); }}
                        className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={(e) => { e.stopPropagation(); onEditOrder(order); }}
                          className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDelete(order.order_number); }}
                          className="text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {expandedOrder === order.order_number && (
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="pl-4 border-l-2 border-emerald-200">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Line Items</h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-slate-500 border-b border-slate-200">
                              <th className="pb-2 font-medium">Item</th>
                              <th className="pb-2 font-medium">Category</th>
                              <th className="pb-2 font-medium text-right">Qty</th>
                              <th className="pb-2 font-medium text-right">Price</th>
                              <th className="pb-2 font-medium text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/50">
                            {order.line_items?.map((item: any) => (
                              <tr key={item.id}>
                                <td className="py-2 text-slate-900">{item.item_name} <span className="text-slate-400 text-xs">({item.item_number})</span></td>
                                <td className="py-2 text-slate-600">{item.category_name || '-'}</td>
                                <td className="py-2 text-right font-medium">{item.quantity}</td>
                                <td className="py-2 text-right text-slate-600">${item.price?.toFixed(2)}</td>
                                <td className="py-2 text-right text-slate-900">${(item.quantity * item.price).toFixed(2)}</td>
                              </tr>
                            ))}
                            {(!order.line_items || order.line_items.length === 0) && (
                              <tr>
                                <td colSpan={5} className="py-4 text-center text-slate-500 italic">No line items found.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        <div className="mt-4 flex justify-end text-sm text-slate-600 space-x-4">
                          <span>Subtotal: ${order.subtotal?.toFixed(2)}</span>
                          <span>Shipping: ${order.shipping?.toFixed(2)}</span>
                          <span>Tax: ${order.tax?.toFixed(2)}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {orders.filter(order => showDeleted ? order.is_deleted : !order.is_deleted).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No procurement history found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-slate-100">
        <div className="text-sm text-slate-500">
          Page {page + 1}
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handlePrevPage}
            disabled={page === 0}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            First Page
          </button>
          <button 
            onClick={handleNextPage}
            disabled={!hasMore}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Next Page
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogView({ currentUser, showDeleted, fetchWithAuth }: { currentUser: any, showDeleted: boolean, fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  
  const [formData, setFormData] = useState({
    item_number: '',
    vendor: '',
    type: 'Compostable',
    name: '',
    price: 0,
    pack_size: 1,
    reorder_url: ''
  });
  const [kitComponents, setKitComponents] = useState<{category_id: string, yield_multiplier: number}[]>([]);

  const fetchData = () => {
    Promise.all([
      fetchWithAuth('/api/items').then((res: any) => res.json()),
      fetchWithAuth('/api/categories').then((res: any) => res.json())
    ]).then(([itemsData, categoriesData]) => {
      if (Array.isArray(itemsData)) {
        setItems(itemsData);
      } else {
        console.error('Expected array but got:', itemsData);
        setItems([]);
      }
      
      if (Array.isArray(categoriesData)) {
        setCategories(categoriesData);
      } else {
        console.error('Expected array but got:', categoriesData);
        setCategories([]);
      }
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setFormData({
      item_number: item.item_number,
      vendor: item.vendor,
      type: item.type,
      name: item.name,
      price: item.price,
      pack_size: item.pack_size || 1,
      reorder_url: item.reorder_url || ''
    });
    setKitComponents(item.kit_components || []);
  };

  const handleDelete = async (itemNumber: string) => {
    if (confirm(`Are you sure you want to delete item ${itemNumber}?`)) {
      await fetchWithAuth(`/api/items/${itemNumber}`, { 
        method: 'DELETE'
      });
      fetchData();
    }
  };

  const handleRestoreItem = async (itemNumber: string) => {
    if (confirm(`Are you sure you want to restore item ${itemNumber}?`)) {
      await fetchWithAuth(`/api/restore/items/${itemNumber}`, {
        method: 'PUT'
      });
      fetchData();
    }
  };

  const addKitComponent = () => {
    if (categories.length > 0) {
      setKitComponents([...kitComponents, { category_id: String(categories[0].id), yield_multiplier: 1 }]);
    }
  };

  const updateKitComponent = (index: number, field: string, value: any) => {
    const newKits = [...kitComponents];
    newKits[index] = { ...newKits[index], [field]: value };
    setKitComponents(newKits);
  };

  const removeKitComponent = (index: number) => {
    setKitComponents(kitComponents.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingItem ? `/api/items/${editingItem.item_number}` : '/api/items';
    const method = editingItem ? 'PUT' : 'POST';

    try {
      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({
          ...formData,
          kit_components: kitComponents
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save item');
      }
      
      setEditingItem(null);
      setFormData({ item_number: '', vendor: '', type: 'Compostable', name: '', price: 0, pack_size: 1, reorder_url: '' });
      setKitComponents([]);
      fetchData();
      alert(editingItem ? 'Item updated!' : 'Item added to catalog!');
    } catch (error: any) {
      console.error(error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleBulkUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkFile) return;

    setBulkUploading(true);
    try {
      const parseCSV = (str: string) => {
        const arr: string[][] = [];
        let quote = false;
        for (let row = 0, col = 0, c = 0; c < str.length; c++) {
          let cc = str[c], nc = str[c+1];
          arr[row] = arr[row] || [];
          arr[row][col] = arr[row][col] || '';
          if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
          if (cc === '"') { quote = !quote; continue; }
          if (cc === ',' && !quote) { ++col; continue; }
          if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
          if (cc === '\n' && !quote) { ++row; col = 0; continue; }
          if (cc === '\r' && !quote) { ++row; col = 0; continue; }
          arr[row][col] += cc;
        }
        return arr;
      };

      const text = await bulkFile.text();
      const rows = parseCSV(text);
      const headers = rows[0].map(h => h.trim());
      
      const items = rows.slice(1).filter(row => row.length === headers.length && row[0].trim() !== '').map(row => {
        const item: any = {};
        headers.forEach((header, index) => {
          item[header] = row[index].trim();
        });
        return item;
      });

      const response = await fetchWithAuth('/api/bulk-upload/inventory', {
        method: 'POST',
        body: JSON.stringify({ items })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to bulk upload items');
      }

      alert('Bulk upload successful!');
      setIsBulkUploadOpen(false);
      setBulkFile(null);
      fetchData();
    } catch (error: any) {
      console.error(error);
      alert(`Error: ${error.message}`);
    } finally {
      setBulkUploading(false);
    }
  };

  const handleDownloadTemplate = async (type: string) => {
    try {
      const res = await fetchWithAuth(`/api/export/template/${type}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}_upload_template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download template:', err);
      alert('Failed to download template. Please try again.');
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm border border-blue-100">
        <strong className="font-semibold">Catalog & Inventory Guide:</strong> This tab manages the master list of requestable items.<br/>
        <strong className="font-semibold">Automated Reorder Alerts:</strong> Reorder warning emails are triggered automatically when a request is moved to 'Checked-out' and the resulting inventory count drops below the 'Low Stock Threshold' set in the Categories tab.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-900">Catalog Items</h2>
          <div className="flex gap-2">
            <button 
              onClick={() => setIsBulkUploadOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <Upload className="w-4 h-4" /> Bulk Upload
            </button>
            <button 
              onClick={() => exportToCSV(items.map(i => ({...i, kit_components: JSON.stringify(i.kit_components)})), 'catalog.csv')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" /> Export to CSV
            </button>
            <button 
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <HelpCircle className="w-4 h-4" /> How to use this page
            </button>
          </div>
        </div>

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} title="Catalog & Inventory Walkthrough">
          <p><strong>What is this page?</strong> This is the master database of every physical item the library offers. If an item does not exist here, it cannot be requested or ordered.</p>
          <h3 className="font-bold text-lg mt-4 text-blue-800">Key Terms You Need to Know:</h3>
          <ul className="list-disc pl-5 space-y-3">
            <li><strong>Pack Size:</strong> How many individual items come in a single box? For example, if you buy 1 box of compostable forks, and the box contains 50 forks, the Pack Size is 50. The system will automatically multiply your orders by this number.</li>
            <li><strong>Kits / Kit Components:</strong> A "Kit" is a bundled package (e.g., a "Party Pack" that contains forks, plates, and cups). If you add an item as a Kit, you can assign it "Components." When a request is made for 1 Party Pack, the system knows to subtract the individual forks, plates, and cups from the master inventory.</li>
            <li><strong>Low Stock Threshold:</strong> This is your safety net. If you set the threshold to 100, the system will automatically send an email alert to the team the moment our current inventory drops to 99 so you can buy more.</li>
          </ul>
        </HelpModal>

        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.filter(item => showDeleted ? item.is_deleted : !item.is_deleted).map(item => (
                <tr key={item.item_number} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 flex items-center gap-2">
                      {item.name}
                      {item.reorder_url && (
                        <a href={item.reorder_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="Reorder Link">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">{item.item_number}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{item.vendor}</div>
                    <div className="text-xs text-slate-500">${item.price?.toFixed(2)} • {item.pack_size} per case</div>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {showDeleted ? (
                      <button onClick={() => handleRestoreItem(item.item_number)} className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors">Restore</button>
                    ) : (
                      <>
                        <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors">Edit</button>
                        <button onClick={() => handleDelete(item.item_number)} className="text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {items.filter(item => showDeleted ? item.is_deleted : !item.is_deleted).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-500">No items found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-slate-900">{editingItem ? 'Edit Item' : 'Add New Vendor Item'}</h2>
          {editingItem && (
            <button 
              onClick={() => {
                setEditingItem(null);
                setFormData({ item_number: '', vendor: '', type: 'Compostable', name: '', price: 0, pack_size: 1, reorder_url: '' });
                setKitComponents([]);
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel Edit
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Item Number (SKU)</label>
              <input required type="text" disabled={!!editingItem} value={formData.item_number} onChange={e => setFormData({...formData, item_number: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Vendor</label>
              <input required type="text" value={formData.vendor} onChange={e => setFormData({...formData, vendor: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-slate-700">Item Name</label>
              <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Type</label>
              <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="Compostable">Compostable</option>
                <option value="Reusable">Reusable</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Pack Size (Items per Case)</label>
              <input required type="number" min="1" value={formData.pack_size} onChange={e => setFormData({...formData, pack_size: parseInt(e.target.value) || 1})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-slate-700">Price per Pack ($)</label>
              <input required type="number" step="0.01" min="0" value={formData.price} onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-sm font-medium text-slate-700">Reorder URL (Optional)</label>
              <input type="url" value={formData.reorder_url} onChange={e => setFormData({...formData, reorder_url: e.target.value})} className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="https://..." />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Kit Components (BOM)</h3>
              <button type="button" onClick={addKitComponent} className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1">
                <Plus className="w-4 h-4" /> Add Component
              </button>
            </div>
            
            <div className="space-y-3">
              {kitComponents.map((kc, i) => (
                <div key={i} className="flex gap-3 items-end bg-white p-3 rounded-xl border border-slate-200">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-slate-500">Maps to Category</label>
                    <select 
                      value={kc.category_id} 
                      onChange={e => updateKitComponent(i, 'category_id', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    >
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="w-32 space-y-1">
                    <label className="text-xs font-medium text-slate-500">Yield Multiplier</label>
                    <input 
                      type="number" min="1" 
                      value={kc.yield_multiplier} 
                      onChange={e => updateKitComponent(i, 'yield_multiplier', parseInt(e.target.value))}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <button type="button" onClick={() => removeKitComponent(i)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
              {kitComponents.length === 0 && (
                <p className="text-sm text-slate-500 italic">No components added. This item will not add to any category inventory until mapped.</p>
              )}
            </div>
          </div>

          <button type="submit" className="w-full bg-slate-900 text-white px-4 py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors">
            {editingItem ? 'Save Changes' : 'Save Item to Catalog'}
          </button>
        </form>
      </div>

      {isBulkUploadOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-semibold text-slate-900">Bulk Upload Catalog</h3>
              <button onClick={() => setIsBulkUploadOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleBulkUpload} className="p-6 space-y-6">
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Upload a CSV file to add or update multiple catalog items at once.
                </p>
                <button 
                  type="button"
                  onClick={() => handleDownloadTemplate('inventory')}
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
                >
                  <Download className="w-4 h-4" /> Download CSV Template
                </button>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">CSV File</label>
                  <input 
                    type="file" 
                    accept=".csv"
                    required
                    onChange={e => setBulkFile(e.target.files?.[0] || null)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" 
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsBulkUploadOpen(false)} className="flex-1 px-4 py-3 rounded-xl border border-slate-300 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={bulkUploading || !bulkFile} className="flex-1 bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
                  {bulkUploading ? 'Uploading...' : 'Upload CSV'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

function UserManagementView({ currentUser, fetchWithAuth }: { currentUser: any, fetchWithAuth: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    password: '',
    role: 'user'
  });

  const fetchUsers = () => {
    fetchWithAuth('/api/users')
      .then((res: any) => res.json())
      .then((data: any) => {
        if (Array.isArray(data)) {
          setUsers(data);
        } else {
          console.error('Expected array but got:', data);
          setUsers([]);
        }
        setLoading(false);
      })
      .catch((err: any) => {
        console.error(err);
        setUsers([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleEdit = (user: any) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      full_name: user.full_name,
      password: '', // Don't populate password field
      role: user.role || 'user'
    });
  };

  const handleDelete = async (id: number) => {
    if (id === currentUser.id) {
      alert("You cannot delete your own account.");
      return;
    }
    if (confirm(`Are you sure you want to delete this user?`)) {
      await fetchWithAuth(`/api/users/${id}`, { 
        method: 'DELETE'
      });
      fetchUsers();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
    const method = editingUser ? 'PUT' : 'POST';

    // If adding a new user, password is required
    if (!editingUser && !formData.password) {
      alert("Password is required for new users.");
      return;
    }

    await fetchWithAuth(url, {
      method,
      body: JSON.stringify(formData)
    });
    
    setEditingUser(null);
    setFormData({ username: '', full_name: '', password: '', role: 'user' });
    fetchUsers();
    alert(editingUser ? 'User updated!' : 'User added!');
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-slate-900">Staff Accounts</h2>
          <button 
            onClick={() => exportToCSV(users, 'users.csv')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export to CSV
          </button>
        </div>
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">ID</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3 rounded-tr-lg text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{user.id}</td>
                  <td className="px-4 py-3 text-slate-600">{user.username}</td>
                  <td className="px-4 py-3 text-slate-600">{user.full_name}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button 
                      onClick={() => handleEdit(user)}
                      className="text-emerald-600 hover:text-emerald-800 font-medium"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                      disabled={user.id === currentUser.id}
                      title={user.id === currentUser.id ? "Cannot delete current user" : ""}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit sticky top-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">
          {editingUser ? 'Edit User' : 'Add New User'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input 
              type="text" 
              required
              value={formData.username}
              onChange={e => setFormData({...formData, username: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input 
              type="text" 
              required
              value={formData.full_name}
              onChange={e => setFormData({...formData, full_name: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password {editingUser && <span className="text-slate-400 font-normal">(Leave blank to keep current)</span>}
            </label>
            <input 
              type="password" 
              required={!editingUser}
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select 
              value={formData.role}
              onChange={e => setFormData({...formData, role: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="user">User (Requests Only)</option>
              <option value="audit">Audit (Read-Only)</option>
              <option value="admin">Admin (Procurement & Catalog)</option>
              <option value="super_admin">Super Admin (System Settings)</option>
            </select>
          </div>

          <div className="pt-2 flex gap-2">
            <button type="submit" className="flex-1 bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors">
              {editingUser ? 'Save Changes' : 'Add User'}
            </button>
            {editingUser && (
              <button 
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setFormData({ username: '', full_name: '', password: '', role: 'user' });
                }}
                className="px-4 py-2 rounded-lg font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function SystemLogsSettingsView({ currentUser, fetchWithAuth }: { currentUser: any, fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [settings, setSettings] = useState({
    request_notification_email: '',
    low_inventory_email: '',
    allowed_domains: [] as string[]
  });
  const [newDomain, setNewDomain] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    Promise.all([
      fetchWithAuth('/api/audit_logs').then((res: any) => res.json()),
      fetchWithAuth('/api/settings').then((res: any) => res.json())
    ]).then(([logsData, settingsData]) => {
      if (Array.isArray(logsData)) {
        setLogs(logsData);
      } else {
        console.error('Expected array but got:', logsData);
        setLogs([]);
      }
      
      if (settingsData && !settingsData.error) {
        setSettings({
          request_notification_email: settingsData.request_notification_email || '',
          low_inventory_email: settingsData.low_inventory_email || '',
          allowed_domains: settingsData.allowed_domains || []
        });
      }
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert('Settings saved successfully!');
        fetchData();
      } else {
        alert('Failed to save settings');
      }
    } catch (err) {
      alert('Error saving settings');
    }
  };

  const addDomain = () => {
    if (newDomain && !settings.allowed_domains.includes(newDomain)) {
      setSettings({ ...settings, allowed_domains: [...settings.allowed_domains, newDomain] });
      setNewDomain('');
    }
  };

  const removeDomain = (domain: string) => {
    setSettings({ ...settings, allowed_domains: settings.allowed_domains.filter(d => d !== domain) });
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm border border-blue-100">
        <strong className="font-semibold block mb-2">User Roles & Permissions:</strong>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Super Admin:</strong> Full system access. Can view the Recycle Bin, restore deleted records, edit global email settings, and manage user roles.</li>
          <li><strong>Admin:</strong> Can process requests, log procurement orders, add/edit catalog items, and create basic users.</li>
          <li><strong>Staff / Audit:</strong> Standard access. Can view inventory, requests, and historical data, but cannot modify system settings or delete records.</li>
        </ul>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-slate-900">System Audit Logs</h2>
          <div className="flex gap-2">
            <button 
              onClick={() => exportToCSV(logs.map(l => ({...l, metadata: l.metadata ? JSON.stringify(l.metadata) : ''})), 'audit_logs.csv')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Download className="w-4 h-4" /> Export to CSV
            </button>
            <button 
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <HelpCircle className="w-4 h-4" /> How to use this page
            </button>
          </div>
        </div>

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} title="System Roles & Settings Walkthrough">
          <p><strong>What is this page?</strong> This handles system security, automated email triggers, and the master audit log.</p>
          <h3 className="font-bold text-lg mt-4 text-blue-800">Security Roles Explained:</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li><span className="font-bold">Super Admin:</span> Has god-mode access. Can edit backend email settings, create users, change roles, view the Recycle Bin, and permanently restore deleted records.</li>
            <li><span className="font-bold">Admin:</span> Day-to-day managers. Can approve requests, log new inventory, and add new items to the catalog.</li>
            <li><span className="font-bold">Audit / Staff:</span> Read-only access. They can view current inventory levels and read old requests, but they cannot approve requests, buy items, or change settings.</li>
          </ul>
          <h3 className="font-bold text-lg mt-4 text-blue-800">Email Config:</h3>
          <p>This is where you tell the system who to email when a new request is submitted, or when inventory drops below the Low Stock Threshold. You can enter multiple email addresses by separating them with a comma.</p>
        </HelpModal>

        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{log.user}</td>
                  <td className="px-4 py-3 text-emerald-600 font-medium">{log.action}</td>
                  <td className="px-4 py-3 text-slate-600">{log.details}</td>
                  <td className="px-4 py-3">
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <pre className="text-xs bg-gray-100 p-1 rounded whitespace-pre-wrap">{JSON.stringify(log.metadata, null, 2)}</pre>
                    ) : (
                      <span className="text-slate-400 text-xs italic">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No audit logs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit sticky top-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Email Notifications</h3>
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Request Notification Email</label>
            <input 
              type="email" 
              required
              value={settings.request_notification_email}
              onChange={e => setSettings({...settings, request_notification_email: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Low Inventory Warning Email</label>
            <input 
              type="email" 
              required
              value={settings.low_inventory_email}
              onChange={e => setSettings({...settings, low_inventory_email: e.target.value})}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
              placeholder="inventory@example.com"
            />
          </div>

          <div className="pt-4 border-t border-slate-200">
            <label className="block text-sm font-medium text-slate-700 mb-1">Allowed Email Domains</label>
            <div className="flex gap-2 mb-2">
              <input 
                type="text" 
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                placeholder="@example.gov"
              />
              <button 
                type="button"
                onClick={addDomain}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {settings.allowed_domains.map(domain => (
                <span key={domain} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs">
                  {domain}
                  <button type="button" onClick={() => removeDomain(domain)} className="text-slate-500 hover:text-red-500">&times;</button>
                </span>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button type="submit" className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors">
              Save Settings
            </button>
          </div>
        </form>
      </div>

      <div className="lg:col-span-3 bg-slate-50 p-6 rounded-xl border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Power BI Integration (M2M)</h3>
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            To connect Power BI to this system, use the Web connector and point it to the following URL:
          </p>
          <div className="bg-slate-900 text-emerald-400 p-3 rounded-lg font-mono text-xs overflow-x-auto">
            {window.location.origin}/api/export/analytics
          </div>
          <p>
            You must pass your API key via the <code className="bg-slate-200 px-1 py-0.5 rounded">x-api-key</code> header.
          </p>
        </div>
      </div>
    </div>
    </div>
  );
}
