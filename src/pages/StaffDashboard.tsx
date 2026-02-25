import React, { useState, useEffect } from 'react';
import { InventoryItem, Request, Category, Item } from '../types';
import { Package, ClipboardList, ShoppingCart, Plus, Check, X, Download, Users } from 'lucide-react';

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
  const [activeTab, setActiveTab] = useState<'inventory' | 'requests' | 'procurement' | 'history' | 'catalog' | 'users'>('inventory');
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = sessionStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

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
        setCurrentUser(data.user);
        sessionStorage.setItem('user', JSON.stringify(data.user));
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      setLoginError('An error occurred during login');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem('user');
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
          <span className="text-sm text-slate-600">Logged in as <span className="font-medium text-slate-900">{currentUser.full_name}</span></span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-medium">Logout</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-px overflow-x-auto">
        <TabButton active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} icon={<Package className="w-4 h-4" />}>Inventory</TabButton>
        <TabButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')} icon={<ClipboardList className="w-4 h-4" />}>Requests</TabButton>
        <TabButton active={activeTab === 'procurement'} onClick={() => { setActiveTab('procurement'); setEditingOrder(null); }} icon={<ShoppingCart className="w-4 h-4" />}>Procurement</TabButton>
        <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<ClipboardList className="w-4 h-4" />}>Procurement History</TabButton>
        <TabButton active={activeTab === 'catalog'} onClick={() => setActiveTab('catalog')} icon={<Plus className="w-4 h-4" />}>Catalog</TabButton>
        <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<Users className="w-4 h-4" />}>User Management</TabButton>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 min-h-[500px]">
        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'requests' && <RequestsView currentUser={currentUser} />}
        {activeTab === 'procurement' && <ProcurementView currentUser={currentUser} editOrder={editingOrder} onComplete={() => { setActiveTab('history'); setEditingOrder(null); }} />}
        {activeTab === 'history' && <ProcurementHistoryView onEditOrder={(order) => {
          setEditingOrder(order);
          setActiveTab('procurement');
        }} />}
        {activeTab === 'catalog' && <CatalogView />}
        {activeTab === 'users' && <UserManagementView currentUser={currentUser} />}
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

function InventoryView() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInventory = () => {
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        setInventory(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
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
              
              return (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{categoryName}</td>
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

function RequestsView({ currentUser }: { currentUser: any }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    Promise.all([
      fetch('/api/requests').then(res => res.json()),
      fetch('/api/categories').then(res => res.json())
    ]).then(([requestsData, inventoryData]) => {
      setRequests(Array.isArray(requestsData) ? requestsData : []);
      setInventory(Array.isArray(inventoryData) ? inventoryData : []);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/requests/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, handled_by: currentUser.full_name })
    });
    fetchData(); // Re-fetch both requests and inventory instantly
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-slate-900">Requests Queue</h2>
          <button 
            onClick={() => exportToCSV(requests.map(r => ({...r, line_items: JSON.stringify(r.line_items)})), 'requests.csv')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export to CSV
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {requests.map(req => (
            <div key={req.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{req.requester_name} - {req.event_name}</h3>
                  <p className="text-sm text-slate-500">{req.department} • {req.check_out_date} to {req.check_in_date}</p>
                  {req.handled_by && <p className="text-xs text-slate-400 mt-1">Handled by: {req.handled_by}</p>}
                </div>
                <select 
                  value={req.status}
                  onChange={(e) => updateStatus(req.id as any, e.target.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-0 outline-none cursor-pointer ${
                    req.status === 'Awaiting' ? 'bg-amber-100 text-amber-800' :
                    req.status === 'Approved' ? 'bg-blue-100 text-blue-800' :
                    req.status === 'Checked-out' ? 'bg-purple-100 text-purple-800' :
                    req.status === 'Checked-in' ? 'bg-emerald-100 text-emerald-800' :
                    'bg-red-100 text-red-800'
                  }`}
                >
                  <option value="Awaiting">Awaiting</option>
                  <option value="Approved">Approved</option>
                  <option value="Checked-out">Checked-out</option>
                  <option value="Checked-in">Checked-in</option>
                  <option value="Denied">Denied</option>
                </select>
              </div>
              
              <div className="bg-slate-50 rounded-lg p-3">
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
          ))}
          {requests.length === 0 && (
            <div className="text-center py-12 text-slate-500">No requests found.</div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Live Inventory</h2>
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
          <ul className="space-y-3">
            {inventory.map(item => {
              const categoryName = (item as any).name || 'Unknown';
              const currentCount = item.current_count ?? 0;
              
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
    </div>
  );
}

function ProcurementView({ currentUser, editOrder, onComplete }: { currentUser: any, editOrder?: any, onComplete?: () => void }) {
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
  
  const [lineItems, setLineItems] = useState<{item_number: string, quantity: number, price: number}[]>([]);

  useEffect(() => {
    fetch('/api/items')
      .then(res => res.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(err => {
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
    
    const url = editOrder ? `/api/orders/${editOrder.order_number}` : '/api/orders';
    const method = editOrder ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        line_items: lineItems,
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
    alert(editOrder ? 'Order updated successfully!' : 'Order logged successfully!');
    if (onComplete) onComplete();
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-semibold text-slate-900 mb-6">{editOrder ? 'Edit Order' : 'Log Incoming Order'}</h2>
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

        <button type="submit" className="w-full bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors">
          Submit Complete Order
        </button>
      </form>
    </div>
  );
}

function ProcurementHistoryView({ onEditOrder }: { onEditOrder: (order: any) => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const fetchOrders = () => {
    fetch('/api/orders')
      .then(res => res.json())
      .then(data => {
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setOrders([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleDelete = async (orderNumber: string) => {
    if (confirm(`Are you sure you want to delete order ${orderNumber}? This will remove all associated line items and update inventory counts.`)) {
      await fetch(`/api/orders/${orderNumber}`, { method: 'DELETE' });
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
            {orders.map(order => (
              <React.Fragment key={order.order_number}>
                <tr className="hover:bg-slate-50/50 transition-colors group cursor-pointer" onClick={() => setExpandedOrder(expandedOrder === order.order_number ? null : order.order_number)}>
                  <td className="px-4 py-3 font-medium text-slate-900">{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{order.order_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_ordered}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_delivered || 'Pending'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.logged_by || '-'}</td>
                  <td className="px-4 py-3 font-medium text-emerald-600">${order.total?.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right space-x-2">
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
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No procurement history found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatalogView() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    item_number: '',
    vendor: '',
    type: 'Compostable',
    name: '',
    price: 0,
    pack_size: 1
  });
  const [kitComponents, setKitComponents] = useState<{category_id: string, yield_multiplier: number}[]>([]);

  const fetchData = () => {
    Promise.all([
      fetch('/api/items').then(res => res.json()),
      fetch('/api/categories').then(res => res.json())
    ]).then(([itemsData, categoriesData]) => {
      setItems(Array.isArray(itemsData) ? itemsData : []);
      setCategories(Array.isArray(categoriesData) ? categoriesData : []);
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
      pack_size: item.pack_size || 1
    });
    setKitComponents(item.kit_components || []);
  };

  const handleDelete = async (itemNumber: string) => {
    if (confirm(`Are you sure you want to delete item ${itemNumber}?`)) {
      await fetch(`/api/items/${itemNumber}`, { method: 'DELETE' });
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
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
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
      setFormData({ item_number: '', vendor: '', type: 'Compostable', name: '', price: 0, pack_size: 1 });
      setKitComponents([]);
      fetchData();
      alert(editingItem ? 'Item updated!' : 'Item added to catalog!');
    } catch (error: any) {
      console.error(error);
      alert(`Error: ${error.message}`);
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-10 bg-slate-100 rounded-lg w-full"></div></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-slate-900">Catalog Items</h2>
          <button 
            onClick={() => exportToCSV(items.map(i => ({...i, kit_components: JSON.stringify(i.kit_components)})), 'catalog.csv')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export to CSV
          </button>
        </div>
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
              {items.map(item => (
                <tr key={item.item_number} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.item_number}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{item.vendor}</div>
                    <div className="text-xs text-slate-500">${item.price?.toFixed(2)} • {item.pack_size} per case</div>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => handleEdit(item)} className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors">Edit</button>
                    <button onClick={() => handleDelete(item.item_number)} className="text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
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
                setFormData({ item_number: '', vendor: '', type: 'Compostable', name: '', price: 0, pack_size: 1 });
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
    </div>
  );
}

function UserManagementView({ currentUser }: { currentUser: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    password: ''
  });

  const fetchUsers = () => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
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
      password: '' // Don't populate password field
    });
  };

  const handleDelete = async (id: number) => {
    if (id === currentUser.id) {
      alert("You cannot delete your own account.");
      return;
    }
    if (confirm(`Are you sure you want to delete this user?`)) {
      await fetch(`/api/users/${id}`, { method: 'DELETE' });
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

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    
    setEditingUser(null);
    setFormData({ username: '', full_name: '', password: '' });
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

          <div className="pt-2 flex gap-2">
            <button type="submit" className="flex-1 bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors">
              {editingUser ? 'Save Changes' : 'Add User'}
            </button>
            {editingUser && (
              <button 
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setFormData({ username: '', full_name: '', password: '' });
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
