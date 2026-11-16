import React, { useState, useEffect } from 'react';
import {
  InventoryItem,
  Request,
  Category,
  Item,
  CategoryItemType,
  UserRole,
} from '../types';
import {
  Package,
  ClipboardList,
  ShoppingCart,
  Plus,
  Check,
  X,
  Download,
  Users,
  Edit,
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
  Upload,
  HelpCircle,
  Layers,
  Settings as SettingsIcon,
  Image,
  Calendar,
  Search,
  History,
  BookOpen,
} from 'lucide-react';

const hawaiiCountyDepartments = [
  'Animal Control and Protection Agency',
  'Civil Defense Agency',
  'Corporation Counsel',
  'County Council',
  'Department of Environmental Management',
  'Department of Finance',
  'Department of Human Resources',
  'Department of Information Technology',
  'Department of Liquor Control',
  'Department of Parks and Recreation',
  'Department of Planning',
  'Department of Public Works',
  'Department of Research and Development',
  'Department of Water Supply',
  'Elections Division',
  'Fire Department',
  'Mass Transit Agency',
  "Mayor's Office",
  'Office of Aging',
  'Office of Housing and Community Development',
  'Office of Sustainability, Climate, Equity, and Resilience (OSCER)',
  'Office of the County Auditor',
  'Office of the County Clerk',
  'Office of the Prosecuting Attorney',
  'Police Department',
];

const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
  const savedUser = localStorage.getItem('user');
  const token =
    localStorage.getItem('token') || (savedUser ? JSON.parse(savedUser).token : null);

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
    return response;
  }

  // Only clear session on 403 if the JWT itself is invalid/expired, NOT on role-based 403s
  if (response.status === 403) {
    try {
      const cloned = await response.clone().json();
      if (cloned?.error === 'Invalid or expired token') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
      }
    } catch {
      // Non-JSON 403; keep session alive so caller can handle error
    }
  }

  return response;
};

async function openProtectedReceipt(
  receiptUrl: string,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
) {
  if (!receiptUrl) return;
  if (!receiptUrl.startsWith('/api/receipts/')) {
    window.open(receiptUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const res = await fetchWithAuth(receiptUrl);
    if (!res.ok) {
      alert('Unable to load receipt file.');
      return;
    }
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    console.error('Failed to stream protected receipt:', err);
    alert('Error opening receipt.');
  }
}

const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
  if (!data || data.length === 0) return;

  // Compute ordered union of keys across all records so optional Firestore fields never misalign columns
  const keySet = new Set<string>();
  for (const row of data) {
    Object.keys(row).forEach((k) => keySet.add(k));
  }
  const headers = Array.from(keySet);

  const escapeCsvCell = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    // Defuse spreadsheet formula injection when opened in Excel
    if (/^[=+\-@]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvRows = data.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(','));
  const csv = `${headers.map((h) => escapeCsvCell(h)).join(',')}\n${csvRows.join('\n')}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
};

const FileUploadField = ({
  onUploadSuccess,
  currentUrl,
  label,
  fetchWithAuth,
}: {
  onUploadSuccess: (url: string) => void;
  currentUrl?: string;
  label: string;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
}) => {
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetchWithAuth('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.url) {
        onUploadSuccess(data.url);
      } else {
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Upload error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="flex gap-4 items-center">
        <div className="relative group w-20 h-20 bg-slate-100 rounded-xl border border-dashed border-slate-300 flex items-center justify-center overflow-hidden shrink-0">
          {currentUrl ? (
            <img
              src={currentUrl}
              alt="Preview"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Image className="w-8 h-8 text-slate-300" />
          )}
          {uploading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600"></div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {currentUrl && (
            <p className="mt-1 text-[10px] text-slate-400 truncate max-w-[220px]">{currentUrl}</p>
          )}
        </div>
      </div>
    </div>
  );
};

const HelpModal = ({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl font-bold leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-6 overflow-y-auto text-slate-700 space-y-4 text-left">{children}</div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};

export function StaffDashboard() {
  const [activeTab, setActiveTab] = useState<
    | 'requests'
    | 'recurring'
    | 'inventory'
    | 'categories'
    | 'catalog'
    | 'procurement'
    | 'history'
    | 'users'
    | 'settings'
  >('requests');
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const fetchWithAuth = async (url: string, options: any = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    return authenticatedFetch(url, { ...options, headers });
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
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (res.ok) {
        const userWithToken = { ...data.user, token: data.token };
        setCurrentUser(userWithToken);
        localStorage.setItem('user', JSON.stringify(userWithToken));
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
      setLoginError('An error occurred during login');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setActiveTab('requests');
  };

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">Staff Login</h2>
        {loginError && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100">
            {loginError}
          </div>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input
              type="text"
              required
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  const role: UserRole = currentUser.role || 'user';
  const isAdminOrAbove = role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';
  const isAudit = role === 'audit';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Staff Dashboard</h1>
        <div className="flex items-center gap-4">
          {isSuperAdmin && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              Toggle Recycle Bin View
            </label>
          )}
          <span className="text-sm text-slate-600">
            Logged in as <span className="font-medium text-slate-900">{currentUser.full_name}</span>{' '}
            <span className="text-xs uppercase px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full ml-1">
              {role}
            </span>
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-px overflow-x-auto">
        <TabButton
          active={activeTab === 'requests'}
          onClick={() => setActiveTab('requests')}
          icon={<ClipboardList className="w-4 h-4" />}
        >
          Requests
        </TabButton>

        {isAdminOrAbove && (
          <TabButton
            active={activeTab === 'recurring'}
            onClick={() => setActiveTab('recurring')}
            icon={<Calendar className="w-4 h-4" />}
          >
            Recurring Requests
          </TabButton>
        )}

        <TabButton
          active={activeTab === 'inventory'}
          onClick={() => setActiveTab('inventory')}
          icon={<Package className="w-4 h-4" />}
        >
          Inventory Overview
        </TabButton>

        {isAdminOrAbove && (
          <>
            <TabButton
              active={activeTab === 'categories'}
              onClick={() => setActiveTab('categories')}
              icon={<Layers className="w-4 h-4" />}
            >
              Categories & Kits
            </TabButton>
            <TabButton
              active={activeTab === 'catalog'}
              onClick={() => setActiveTab('catalog')}
              icon={<BookOpen className="w-4 h-4" />}
            >
              Catalog Editor
            </TabButton>
            <TabButton
              active={activeTab === 'procurement'}
              onClick={() => {
                setActiveTab('procurement');
                setEditingOrder(null);
              }}
              icon={<ShoppingCart className="w-4 h-4" />}
            >
              Procurement
            </TabButton>
          </>
        )}

        {(isAdminOrAbove || isAudit) && (
          <TabButton
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            icon={<History className="w-4 h-4" />}
          >
            Procurement History
          </TabButton>
        )}

        {isSuperAdmin && (
          <TabButton
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            icon={<Users className="w-4 h-4" />}
          >
            User Management
          </TabButton>
        )}

        {(isSuperAdmin || isAudit) && (
          <TabButton
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            icon={<SettingsIcon className="w-4 h-4" />}
          >
            {isSuperAdmin ? 'Settings & Logs' : 'Audit Logs'}
          </TabButton>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 min-h-[500px]">
        {activeTab === 'inventory' && <InventoryView fetchWithAuth={fetchWithAuth} />}
        {activeTab === 'requests' && (
          <RequestsView
            currentUser={currentUser}
            showDeleted={showDeleted}
            fetchWithAuth={fetchWithAuth}
          />
        )}
        {activeTab === 'procurement' && isAdminOrAbove && (
          <ProcurementView
            currentUser={currentUser}
            editOrder={editingOrder}
            onComplete={() => {
              setActiveTab('history');
              setEditingOrder(null);
            }}
            fetchWithAuth={fetchWithAuth}
          />
        )}
        {activeTab === 'history' && (isAdminOrAbove || isAudit) && (
          <ProcurementHistoryView
            currentUser={currentUser}
            showDeleted={showDeleted}
            onEditOrder={(order) => {
              setEditingOrder(order);
              setActiveTab('procurement');
            }}
            fetchWithAuth={fetchWithAuth}
          />
        )}
        {activeTab === 'catalog' && isAdminOrAbove && (
          <CatalogView showDeleted={showDeleted} fetchWithAuth={fetchWithAuth} />
        )}
        {activeTab === 'categories' && isAdminOrAbove && (
          <CategoryManagementView fetchWithAuth={fetchWithAuth} />
        )}
        {activeTab === 'recurring' && isAdminOrAbove && (
          <RecurringOrdersView fetchWithAuth={fetchWithAuth} />
        )}
        {activeTab === 'users' && isSuperAdmin && (
          <UserManagementView currentUser={currentUser} fetchWithAuth={fetchWithAuth} />
        )}
        {activeTab === 'settings' && (isSuperAdmin || isAudit) && (
          <SystemLogsSettingsView currentUser={currentUser} fetchWithAuth={fetchWithAuth} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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

function InventoryView({ fetchWithAuth }: { fetchWithAuth: any }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth('/api/admin/categories')
      .then((res: Response) => res.json())
      .then((data: any) => {
        setInventory(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err: any) => {
        console.error(err);
        setInventory([]);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Real-Time Inventory</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Available-to-Promise subtracts Awaiting, Approved, and Awaiting Pick Up reservations
            from physical On-Shelf stock.
          </p>
        </div>
        <button
          onClick={() => exportToCSV(inventory as any[], 'inventory.csv')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" /> Export to CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 rounded-tl-lg">Category</th>
              <th className="px-4 py-3">Behavior</th>
              <th className="px-4 py-3">Total Procured</th>
              <th className="px-4 py-3">On-Shelf</th>
              <th className="px-4 py-3">Reserved</th>
              <th className="px-4 py-3">Available (ATP)</th>
              <th className="px-4 py-3">Currently Out</th>
              <th className="px-4 py-3 rounded-tr-lg">Lifetime Issued</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map((item) => {
              const categoryName = item.name || 'Unknown';
              const currentCount = item.current_count ?? 0;
              const reserved = item.reserved_count ?? 0;
              const atp = item.available_to_promise ?? Math.max(0, currentCount - reserved);
              const deployed = item.currently_deployed ?? 0;
              const totalProcured = item.total_procured ?? 0;
              const isDeleted = item.is_deleted;
              const isInternal = item.is_requestable === 0;

              return (
                <tr
                  key={item.id}
                  className={`hover:bg-slate-50/50 transition-colors ${
                    isDeleted ? 'bg-red-50/50' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {categoryName}
                    {isInternal && (
                      <span className="ml-2 text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        INTERNAL
                      </span>
                    )}
                    {isDeleted && (
                      <span className="ml-2 text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                        DELETED
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        item.item_type === 'reusable'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {item.item_type === 'reusable' ? 'Reusable' : 'Consumable'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{totalProcured}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{currentCount}</td>
                  <td className="px-4 py-3 text-amber-700">{reserved}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        atp > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {atp}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-purple-700">{deployed}</td>
                  <td className="px-4 py-3 text-slate-600">{item.total_checked_out || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RequestsView({
  currentUser,
  showDeleted,
  fetchWithAuth,
}: {
  currentUser: any;
  showDeleted: boolean;
  fetchWithAuth: any;
}) {
  const isReadOnly = currentUser?.role === 'audit';
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [requests, setRequests] = useState<Request[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    'Awaiting',
    'Approved',
    'Awaiting Pick Up',
    'Checked-out',
    'Stationed Usage',
  ]);

  const [requestFormData, setRequestFormData] = useState({
    requester_name: '',
    requester_email: '',
    requester_phone: '',
    department: '',
    event_name: '',
    check_out_date: '',
    check_in_date: '',
    status: 'Awaiting',
  });
  const [requestLineItems, setRequestLineItems] = useState<any[]>([]);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      fetchWithAuth('/api/requests').then((res: Response) => res.json()),
      fetchWithAuth('/api/admin/categories').then((res: Response) => res.json()),
    ])
      .then(([requestsData, categoriesData]) => {
        setRequests(Array.isArray(requestsData) ? requestsData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [searchQuery, selectedStatuses, showDeleted]);

  const filteredRequests = requests
    .filter((req) => (showDeleted ? req.is_deleted : !req.is_deleted))
    .filter((req) => selectedStatuses.includes(req.status))
    .filter((req) => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        (req.requester_name || '').toLowerCase().includes(term) ||
        (req.department || '').toLowerCase().includes(term) ||
        (req.event_name || '').toLowerCase().includes(term)
      );
    });

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const pagedRequests = filteredRequests.slice(page * pageSize, (page + 1) * pageSize);

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
      status: req.status,
    });
    setRequestLineItems(req.line_items || []);
    setIsFormOpen(true);
  };

  const handleDeleteRequest = async (id: string) => {
    if (
      confirm(
        'Are you sure you want to archive/delete this request? Any active inventory deductions will be reconciled.'
      )
    ) {
      try {
        const response = await fetchWithAuth(`/api/requests/${id}`, { method: 'DELETE' });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to delete request');
        }
        fetchData();
      } catch (error: any) {
        console.error(error);
        alert(error.message || 'Error deleting request');
      }
    }
  };

  const addRequestLineItem = () => {
    if (categories.length > 0) {
      setRequestLineItems([
        ...requestLineItems,
        {
          category_id: categories[0].id,
          category_name: categories[0].name,
          quantity: 1,
        },
      ]);
    }
  };

  const updateRequestLineItem = (index: number, field: string, value: any) => {
    const newItems = [...requestLineItems];
    if (field === 'category_id') {
      const cat = categories.find((c) => String(c.id) === String(value));
      newItems[index] = {
        ...newItems[index],
        category_id: value,
        category_name: cat?.name || 'Unknown',
      };
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
      handled_by: currentUser.full_name,
    };

    try {
      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save request');

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
        status: 'Awaiting',
      });
      setRequestLineItems([]);
      fetchData();
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Error saving request');
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const res = await fetchWithAuth(`/api/requests/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, handled_by: currentUser.full_name }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Failed to update status');
    }
    fetchData();
  };

  const handleRestoreRequest = async (id: string) => {
    if (confirm(`Restore request ${id} and re-apply its inventory state?`)) {
      const res = await fetchWithAuth(`/api/restore/requests/${id}`, { method: 'PUT' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to restore request');
      }
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <h2 className="text-xl font-semibold text-slate-900">Requests Queue</h2>
            <div className="flex flex-wrap gap-2">
              {!isReadOnly && (
                <button
                  onClick={() => {
                    setEditingRequest(null);
                    setRequestFormData({
                      requester_name: '',
                      requester_email: '',
                      requester_phone: '',
                      department: hawaiiCountyDepartments[0],
                      event_name: '',
                      check_out_date: '',
                      check_in_date: '',
                      status: 'Awaiting',
                    });
                    setRequestLineItems([]);
                    setIsFormOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Request
                </button>
              )}
              <button
                onClick={() => exportToCSV(filteredRequests as any[], 'requests.csv')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download className="w-4 h-4" /> Export to CSV
              </button>
              <button
                onClick={() => setIsHelpOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                <HelpCircle className="w-4 h-4" /> Workflow Guide
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Filter Statuses:
            </span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {[
                'Awaiting',
                'Approved',
                'Awaiting Pick Up',
                'Checked-out',
                'Checked-in',
                'Denied',
                'Stationed Usage',
                'Test',
              ].map((status) => (
                <label
                  key={status}
                  className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStatuses([...selectedStatuses, status]);
                      } else {
                        setSelectedStatuses(selectedStatuses.filter((s) => s !== status));
                      }
                    }}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{status}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="relative w-full">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by requester, department, or event name..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <HelpModal
            isOpen={isHelpOpen}
            onClose={() => setIsHelpOpen(false)}
            title="Requests Workflow Walkthrough"
          >
            <p>
              <strong>What is this page?</strong> Manage public and recurring item requests through
              their lifecycle. All status transitions run inside atomic inventory transactions.
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <span className="bg-amber-100 font-semibold px-1.5 py-0.5 rounded">Awaiting:</span>{' '}
                New request; items are reserved from public Available-to-Promise (ATP).
              </li>
              <li>
                <span className="bg-blue-100 font-semibold px-1.5 py-0.5 rounded">Approved:</span>{' '}
                Emails the requester confirming approval and keeps items reserved in ATP.
              </li>
              <li>
                <span className="bg-sky-100 font-semibold px-1.5 py-0.5 rounded">
                  Awaiting Pick Up:
                </span>{' '}
                Box is packed and staged for pickup.
              </li>
              <li>
                <span className="bg-purple-100 font-semibold px-1.5 py-0.5 rounded">
                  Checked-out:
                </span>{' '}
                Deducts physical On-Shelf inventory, increments Lifetime Issued, and triggers
                Low-Stock alerts if needed.
              </li>
              <li>
                <span className="bg-emerald-100 font-semibold px-1.5 py-0.5 rounded">
                  Checked-in:
                </span>{' '}
                Returns <strong>Reusable</strong> items to On-Shelf stock while keeping{' '}
                <strong>Consumable</strong> items permanently consumed.
              </li>
              <li>
                <span className="bg-red-100 font-semibold px-1.5 py-0.5 rounded">Denied:</span>{' '}
                Releases reservations (or reverses deductions if previously checked out).
              </li>
            </ul>
          </HelpModal>

          <div className="grid grid-cols-1 gap-2">
            {pagedRequests.map((req) => (
              <div
                key={req.id}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white hover:border-slate-300 transition-colors"
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer"
                  onClick={() => setExpandedRequest(expandedRequest === req.id ? null : req.id)}
                >
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {req.requester_name}
                    </div>
                    <div className="text-slate-600 truncate">{req.event_name}</div>
                    <div className="text-sm text-slate-500">
                      {req.check_out_date} &rarr; {req.check_in_date}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-4 ml-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <select
                      disabled={isReadOnly}
                      value={req.status}
                      onChange={(e) => updateStatus(req.id, e.target.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-0 outline-none ${
                        isReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                      } ${
                        req.status === 'Awaiting'
                          ? 'bg-amber-100 text-amber-800'
                          : req.status === 'Approved'
                          ? 'bg-blue-100 text-blue-800'
                          : req.status === 'Awaiting Pick Up'
                          ? 'bg-sky-100 text-sky-800'
                          : req.status === 'Checked-out'
                          ? 'bg-purple-100 text-purple-800'
                          : req.status === 'Checked-in'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'Test'
                          ? 'bg-slate-200 text-slate-700'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      <option value="Awaiting">Awaiting</option>
                      <option value="Approved">Approved</option>
                      <option value="Awaiting Pick Up">Awaiting Pick Up</option>
                      <option value="Checked-out">Checked-out</option>
                      <option value="Checked-in">Checked-in</option>
                      <option value="Denied">Denied</option>
                      <option value="Stationed Usage">Stationed Usage</option>
                      <option value="Test">Test</option>
                    </select>
                    {expandedRequest === req.id ? (
                      <ChevronUp className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </div>

                {expandedRequest === req.id && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-50 bg-slate-50/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                            <div className="text-xs font-semibold text-slate-400 uppercase">
                              Contact Information
                            </div>
                            <div className="text-sm text-slate-700">
                              {req.requester_email && <div>Email: {req.requester_email}</div>}
                              {req.requester_phone && <div>Phone: {req.requester_phone}</div>}
                              {!req.requester_email && !req.requester_phone && (
                                <span className="text-slate-400 italic">
                                  No contact info provided
                                </span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-400 uppercase">
                              Department
                            </div>
                            <div className="text-sm text-slate-700">{req.department}</div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-400 uppercase">
                              Handled By
                            </div>
                            <div className="text-sm text-slate-700">
                              {req.handled_by || 'Unassigned'}
                            </div>
                          </div>
                        </div>

                        {!isReadOnly && (
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
                        )}
                      </div>

                      <div className="bg-white rounded-xl border border-slate-200 p-3">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          Requested Items
                        </h4>
                        <ul className="space-y-1.5">
                          {(req.line_items || []).map((item, index) => (
                            <li
                              key={`${item.category_id}-${index}`}
                              className="text-sm text-slate-700 flex justify-between items-start gap-2"
                            >
                              <div>
                                <span>{item.category_name}</span>
                                {item.pack_hint && (
                                  <span className="block text-[11px] text-slate-400">
                                    {item.pack_hint}
                                  </span>
                                )}
                              </div>
                              <span className="font-semibold shrink-0">{item.quantity}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {pagedRequests.length === 0 && (
              <div className="text-center py-12 text-slate-500 font-medium">
                No matching requests found.
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <div className="text-sm text-slate-500">
                Page {page + 1} of {totalPages} ({filteredRequests.length} matching)
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page + 1 >= totalPages}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Live Stock Snapshot</h2>
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <ul className="space-y-3">
              {categories.map((item) => {
                const currentCount = item.current_count ?? 0;
                const atp = item.available_to_promise ?? currentCount;
                return (
                  <li key={item.id} className="flex justify-between items-center text-sm">
                    <div>
                      <span className="text-slate-800 font-medium">{item.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        On-Shelf: {currentCount} &bull; Reserved: {item.reserved_count || 0}
                      </span>
                    </div>
                    <span
                      title="Available to Promise"
                      className={`font-medium px-2.5 py-0.5 rounded-full text-xs ${
                        atp > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {atp} ATP
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {isFormOpen && !isReadOnly && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-semibold text-slate-900">
                  {editingRequest ? 'Edit Request' : 'Add Staff / Historical Request'}
                </h3>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleSubmitRequest} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Requester Name</label>
                    <input
                      required
                      type="text"
                      value={requestFormData.requester_name}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requester_name: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Department</label>
                    <input
                      required
                      type="text"
                      list="county-dept-list"
                      value={requestFormData.department}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, department: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    <datalist id="county-dept-list">
                      {hawaiiCountyDepartments.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Email Address</label>
                    <input
                      type="email"
                      value={requestFormData.requester_email}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requester_email: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Phone Number</label>
                    <input
                      type="tel"
                      value={requestFormData.requester_phone}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, requester_phone: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Event Name</label>
                    <input
                      required
                      type="text"
                      value={requestFormData.event_name}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, event_name: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Check-out Date</label>
                    <input
                      required
                      type="date"
                      value={requestFormData.check_out_date}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, check_out_date: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Check-in Date</label>
                    <input
                      required
                      type="date"
                      value={requestFormData.check_in_date}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, check_in_date: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <select
                      value={requestFormData.status}
                      onChange={(e) =>
                        setRequestFormData({ ...requestFormData, status: e.target.value })
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    >
                      <option value="Awaiting">Awaiting</option>
                      <option value="Approved">Approved</option>
                      <option value="Awaiting Pick Up">Awaiting Pick Up</option>
                      <option value="Checked-out">Checked-out</option>
                      <option value="Checked-in">Checked-in</option>
                      <option value="Denied">Denied</option>
                      <option value="Stationed Usage">Stationed Usage</option>
                      <option value="Test">Test</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-semibold text-slate-900">Requested Items</h4>
                    <button
                      type="button"
                      onClick={addRequestLineItem}
                      className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> Add Item
                    </button>
                  </div>
                  <div className="space-y-3">
                    {requestLineItems.map((item, i) => (
                      <div
                        key={i}
                        className="flex gap-3 items-end bg-slate-50 p-3 rounded-xl border border-slate-200"
                      >
                        <div className="flex-1 space-y-1">
                          <label className="text-xs font-medium text-slate-500">Category</label>
                          <select
                            value={item.category_id}
                            onChange={(e) => updateRequestLineItem(i, 'category_id', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-24 space-y-1">
                          <label className="text-xs font-medium text-slate-500">Quantity</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(e) =>
                              updateRequestLineItem(i, 'quantity', parseInt(e.target.value, 10) || 1)
                            }
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRequestLineItem(i)}
                          className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-300 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-slate-900 text-white px-4 py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors"
                  >
                    Save Request
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

function ProcurementView({
  currentUser,
  editOrder,
  onComplete,
  fetchWithAuth,
}: {
  currentUser: any;
  editOrder?: any;
  onComplete?: () => void;
  fetchWithAuth: any;
}) {
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
    procurement_method: 'Credit Card',
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lineItems, setLineItems] = useState<
    { item_number: string; quantity: number; price: number }[]
  >([]);

  useEffect(() => {
    fetchWithAuth('/api/items')
      .then((res: Response) => res.json())
      .then((data: any) => setItems(Array.isArray(data) ? data : []))
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
        procurement_method: editOrder.procurement_method || 'Credit Card',
      });
      setLineItems(
        (editOrder.line_items || []).map((li: any) => ({
          item_number: li.item_number,
          quantity: Number(li.quantity) || 1,
          price: Number(li.price) || 0,
        }))
      );
    }
  }, [editOrder]);

  const addLineItem = () => {
    if (items.length > 0) {
      setLineItems([
        ...lineItems,
        { item_number: items[0].item_number, quantity: 1, price: items[0].price },
      ]);
    }
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'item_number') {
      const selectedItem = items.find((i) => i.item_number === value);
      if (selectedItem) {
        newItems[index].price = selectedItem.price;
      }
    }
    setLineItems(newItems);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const calculatedSubtotal = lineItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.price) || 0),
      0
    );
    setFormData((prev) => ({
      ...prev,
      subtotal: calculatedSubtotal,
      total: calculatedSubtotal + (Number(prev.shipping) || 0) + (Number(prev.tax) || 0),
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
          body: formDataUpload,
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || 'Failed to upload receipt');
        }
        receipt_url = uploadData.url;
      }

      const url = editOrder
        ? `/api/orders/${encodeURIComponent(editOrder.order_number)}`
        : '/api/orders';
      const method = editOrder ? 'PUT' : 'POST';

      const orderRes = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({
          ...formData,
          line_items: lineItems,
          receipt_url,
          logged_by: currentUser.full_name,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(orderData.error || 'Failed to save procurement order');
      }

      setFormData({
        order_number: '',
        order_name: '',
        date_ordered: new Date().toISOString().split('T')[0],
        date_delivered: '',
        subtotal: 0,
        shipping: 0,
        tax: 0,
        total: 0,
        procurement_method: 'Credit Card',
      });
      setLineItems([]);
      setReceiptFile(null);
      alert(editOrder ? 'Order updated and inventory reconciled!' : 'Order logged successfully!');
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
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {editOrder ? `Edit Order (${editOrder.order_number})` : 'Log Incoming Order'}
        </h2>
        <button
          onClick={() => setIsHelpOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
        >
          <HelpCircle className="w-4 h-4" /> How to use this page
        </button>
      </div>

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Procurement (Orders) Walkthrough"
      >
        <p>
          <strong>What is this page?</strong> Log new vendor restocks. Every order automatically
          multiplies Pack Size &times; BOM Yield Multiplier and adds the resulting units into
          category stock.
        </p>
        <ol className="list-decimal pl-5 space-y-2 mt-3">
          <li>Enter the Invoice or PO/Order Number.</li>
          <li>Attach a PDF or photo of the receipt (stored privately; viewable only by staff).</li>
          <li>
            Enter the number of <strong>Cases/Packs</strong> purchased—the system multiplies by Pack
            Size automatically.
          </li>
        </ol>
      </HelpModal>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-4">
          <h3 className="font-medium text-slate-900 border-b border-slate-200 pb-2">
            Order Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Order / PO Number</label>
              <input
                required
                type="text"
                disabled={!!editOrder}
                value={formData.order_number}
                onChange={(e) => setFormData({ ...formData, order_number: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
                placeholder="e.g. PO-2026-014"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Order Name (Optional)</label>
              <input
                type="text"
                value={formData.order_name}
                onChange={(e) => setFormData({ ...formData, order_name: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="e.g. Winter Restock"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Date Ordered</label>
              <input
                required
                type="date"
                value={formData.date_ordered}
                onChange={(e) => setFormData({ ...formData, date_ordered: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Date Delivered (Optional)
              </label>
              <input
                type="date"
                value={formData.date_delivered}
                onChange={(e) => setFormData({ ...formData, date_delivered: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Procurement Method</label>
              <select
                value={formData.procurement_method}
                onChange={(e) => setFormData({ ...formData, procurement_method: e.target.value })}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="Credit Card">Credit Card (P-Card)</option>
                <option value="Purchase Order">Purchase Order</option>
                <option value="Invoice">Invoice</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Receipt / Packing Slip</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              {editOrder?.receipt_url && !receiptFile && (
                <p className="text-sm text-slate-500 mt-1">
                  Current receipt:{' '}
                  <button
                    type="button"
                    onClick={() => openProtectedReceipt(editOrder.receipt_url, fetchWithAuth)}
                    className="text-emerald-600 hover:underline font-medium"
                  >
                    View Attached File
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium text-slate-900">Line Items (Cases / Packs)</h3>
            <button
              type="button"
              onClick={addLineItem}
              className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          <div className="space-y-3">
            {lineItems.map((item, i) => (
              <div
                key={i}
                className="flex flex-wrap sm:flex-nowrap gap-3 items-end bg-white p-4 rounded-xl border border-slate-200 shadow-sm"
              >
                <div className="flex-1 min-w-[200px] space-y-1">
                  <label className="text-xs font-medium text-slate-500">Catalog Item</label>
                  <select
                    value={item.item_number}
                    onChange={(e) => updateLineItem(i, 'item_number', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                  >
                    {items.map((catalogItem) => (
                      <option key={catalogItem.item_number} value={catalogItem.item_number}>
                        {catalogItem.name} ({catalogItem.pack_size}/pk &bull;{' '}
                        {catalogItem.item_number})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 space-y-1">
                  <label className="text-xs font-medium text-slate-500">Packs</label>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      updateLineItem(i, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div className="w-32 space-y-1">
                  <label className="text-xs font-medium text-slate-500">Pack Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={(e) =>
                      updateLineItem(i, 'price', Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLineItem(i)}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors mb-0.5"
                >
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
          <h3 className="font-medium text-slate-900 border-b border-slate-200 pb-2">
            Order Totals
          </h3>
          <div className="grid grid-cols-2 gap-4 max-w-md ml-auto">
            <div className="flex justify-between items-center col-span-2">
              <span className="text-sm text-slate-600">Subtotal</span>
              <span className="font-medium">${formData.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center col-span-2">
              <span className="text-sm text-slate-600">Shipping</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.shipping}
                onChange={(e) =>
                  setFormData({ ...formData, shipping: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="w-28 px-2 py-1 text-right rounded border border-slate-300 bg-white text-sm"
              />
            </div>
            <div className="flex justify-between items-center col-span-2">
              <span className="text-sm text-slate-600">Tax</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.tax}
                onChange={(e) =>
                  setFormData({ ...formData, tax: Math.max(0, parseFloat(e.target.value) || 0) })
                }
                className="w-28 px-2 py-1 text-right rounded border border-slate-300 bg-white text-sm"
              />
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-200 col-span-2">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="font-bold text-lg text-emerald-600">
                ${formData.total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isUploading}
          className="w-full bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {isUploading
            ? 'Uploading & Reconciling...'
            : editOrder
            ? 'Save Order Changes'
            : 'Submit Complete Order'}
        </button>
      </form>
    </div>
  );
}

function ProcurementHistoryView({
  currentUser,
  onEditOrder,
  showDeleted,
  fetchWithAuth,
}: {
  currentUser: any;
  onEditOrder: (order: any) => void;
  showDeleted: boolean;
  fetchWithAuth: any;
}) {
  const isReadOnly = currentUser?.role === 'audit';
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth('/api/orders');
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setOrders([]);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [searchQuery, showDeleted]);

  const filteredOrders = orders
    .filter((order) => (showDeleted ? order.is_deleted : !order.is_deleted))
    .filter((order) => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      const matchOrderNumber =
        (order.order_number || '').toLowerCase().includes(term) ||
        (order.po_number || '').toLowerCase().includes(term);
      const matchVendor =
        (order.vendor || '').toLowerCase().includes(term) ||
        (order.line_items || []).some((li: any) => (li.vendor || '').toLowerCase().includes(term));
      const matchItemName = (order.line_items || []).some((li: any) =>
        (li.item_name || li.item_number || '').toLowerCase().includes(term)
      );
      const matchOrderName = (order.order_name || '').toLowerCase().includes(term);
      return matchOrderNumber || matchVendor || matchItemName || matchOrderName;
    });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const pagedOrders = filteredOrders.slice(page * pageSize, (page + 1) * pageSize);

  const handleDelete = async (orderNumber: string) => {
    if (
      confirm(
        `Are you sure you want to delete order ${orderNumber}? This will reverse all associated BOM inventory additions.`
      )
    ) {
      const res = await fetchWithAuth(`/api/orders/${encodeURIComponent(orderNumber)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || 'Failed to delete order');
      }
      fetchOrders();
    }
  };

  const handleRestoreOrder = async (orderNumber: string) => {
    if (
      confirm(
        `Restore order ${orderNumber} and re-apply all associated line items to category stock?`
      )
    ) {
      const res = await fetchWithAuth(`/api/restore/orders/${encodeURIComponent(orderNumber)}`, {
        method: 'PUT',
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || 'Failed to restore order');
      }
      fetchOrders();
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <h2 className="text-xl font-semibold text-slate-900">Procurement History</h2>
        <button
          onClick={() => exportToCSV(filteredOrders, 'procurement_history.csv')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" /> Export to CSV
        </button>
      </div>

      <div className="relative w-full">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by order/PO#, vendor, or item name..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm bg-white"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
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
            {pagedOrders.map((order) => (
              <React.Fragment key={order.order_number}>
                <tr
                  className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                  onClick={() =>
                    setExpandedOrder(
                      expandedOrder === order.order_number ? null : order.order_number
                    )
                  }
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{order.order_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_ordered}</td>
                  <td className="px-4 py-3 text-slate-600">{order.date_delivered || 'Pending'}</td>
                  <td className="px-4 py-3 text-slate-600">{order.logged_by || '-'}</td>
                  <td className="px-4 py-3 font-medium text-emerald-600">
                    ${Number(order.total || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {order.receipt_url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openProtectedReceipt(order.receipt_url, fetchWithAuth);
                        }}
                        className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Receipt
                      </button>
                    )}
                    {!isReadOnly && (
                      <>
                        {showDeleted ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestoreOrder(order.order_number);
                            }}
                            className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                          >
                            Restore
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditOrder(order);
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(order.order_number);
                              }}
                              className="text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                {expandedOrder === order.order_number && (
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="pl-4 border-l-2 border-emerald-200">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          Line Items
                        </h4>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-slate-500 border-b border-slate-200">
                              <th className="pb-2 font-medium">Item</th>
                              <th className="pb-2 font-medium">Category</th>
                              <th className="pb-2 font-medium text-right">Packs</th>
                              <th className="pb-2 font-medium text-right">Price</th>
                              <th className="pb-2 font-medium text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/50">
                            {order.line_items?.map((item: any, idx: number) => (
                              <tr key={item.id || `${order.order_number}-${idx}`}>
                                <td className="py-2 text-slate-900">
                                  {item.item_name || item.item_number}{' '}
                                  <span className="text-slate-400 text-xs">
                                    ({item.item_number})
                                  </span>
                                </td>
                                <td className="py-2 text-slate-600">{item.category_name || '-'}</td>
                                <td className="py-2 text-right font-medium">{item.quantity}</td>
                                <td className="py-2 text-right text-slate-600">
                                  ${Number(item.price || 0).toFixed(2)}
                                </td>
                                <td className="py-2 text-right text-slate-900">
                                  $
                                  {(Number(item.quantity || 0) * Number(item.price || 0)).toFixed(
                                    2
                                  )}
                                </td>
                              </tr>
                            ))}
                            {(!order.line_items || order.line_items.length === 0) && (
                              <tr>
                                <td colSpan={5} className="py-4 text-center text-slate-500 italic">
                                  No line items found.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        <div className="mt-4 flex justify-end text-sm text-slate-600 space-x-4">
                          <span>Subtotal: ${Number(order.subtotal || 0).toFixed(2)}</span>
                          <span>Shipping: ${Number(order.shipping || 0).toFixed(2)}</span>
                          <span>Tax: ${Number(order.tax || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {pagedOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-medium">
                  No matching procurement history found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-slate-100">
        <div className="text-sm text-slate-500">
          Page {page + 1} of {totalPages}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page + 1 >= totalPages}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogView({
  showDeleted,
  fetchWithAuth,
}: {
  showDeleted: boolean;
  fetchWithAuth: any;
}) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);

  const emptyItemForm = {
    item_number: '',
    vendor: '',
    type: 'Compostable',
    name: '',
    price: 0,
    pack_size: 1,
    reorder_url: '',
    image_url: '',
  };

  const [formData, setFormData] = useState(emptyItemForm);
  const [kitComponents, setKitComponents] = useState<
    { category_id: string | number; yield_multiplier: number }[]
  >([]);

  const fetchData = () => {
    Promise.all([
      fetchWithAuth('/api/items').then((res: Response) => res.json()),
      fetchWithAuth('/api/admin/categories').then((res: Response) => res.json()),
    ])
      .then(([itemsData, categoriesData]) => {
        setItems(Array.isArray(itemsData) ? itemsData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      item_number: item.item_number,
      vendor: item.vendor,
      type: item.type,
      name: item.name,
      price: item.price,
      pack_size: item.pack_size || 1,
      reorder_url: item.reorder_url || '',
      image_url: item.image_url || '',
    });
    setKitComponents(item.kit_components || []);
  };

  const handleDelete = async (itemNumber: string) => {
    if (confirm(`Are you sure you want to archive catalog item ${itemNumber}?`)) {
      await fetchWithAuth(`/api/items/${encodeURIComponent(itemNumber)}`, { method: 'DELETE' });
      fetchData();
    }
  };

  const handleRestoreItem = async (itemNumber: string) => {
    if (confirm(`Restore catalog item ${itemNumber}?`)) {
      await fetchWithAuth(`/api/restore/items/${encodeURIComponent(itemNumber)}`, {
        method: 'PUT',
      });
      fetchData();
    }
  };

  const addKitComponent = () => {
    if (categories.length > 0) {
      setKitComponents([
        ...kitComponents,
        { category_id: String(categories[0].id), yield_multiplier: 1 },
      ]);
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
    const url = editingItem
      ? `/api/items/${encodeURIComponent(editingItem.item_number)}`
      : '/api/items';
    const method = editingItem ? 'PUT' : 'POST';

    try {
      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({
          ...formData,
          kit_components: kitComponents,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save item');
      }

      setEditingItem(null);
      setFormData(emptyItemForm);
      setKitComponents([]);
      fetchData();
      alert(editingItem ? 'Catalog item updated!' : 'Item added to catalog!');
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
          const cc = str[c];
          const nc = str[c + 1];
          arr[row] = arr[row] || [];
          arr[row][col] = arr[row][col] || '';
          if (cc === '"' && quote && nc === '"') {
            arr[row][col] += cc;
            ++c;
            continue;
          }
          if (cc === '"') {
            quote = !quote;
            continue;
          }
          if (cc === ',' && !quote) {
            ++col;
            continue;
          }
          if (cc === '\r' && nc === '\n' && !quote) {
            ++row;
            col = 0;
            ++c;
            continue;
          }
          if ((cc === '\n' || cc === '\r') && !quote) {
            ++row;
            col = 0;
            continue;
          }
          arr[row][col] += cc;
        }
        return arr;
      };

      const text = await bulkFile.text();
      const rows = parseCSV(text);
      const headers = rows[0].map((h) => h.trim());

      const parsedItems = rows
        .slice(1)
        .filter((row) => row.length === headers.length && row[0].trim() !== '')
        .map((row) => {
          const item: Record<string, string> = {};
          headers.forEach((header, index) => {
            item[header] = row[index].trim();
          });
          return item;
        });

      const response = await fetchWithAuth('/api/bulk-upload/inventory', {
        method: 'POST',
        body: JSON.stringify({ items: parsedItems }),
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
      alert('Failed to download template.');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  const visibleItems = items.filter((item) => (showDeleted ? item.is_deleted : !item.is_deleted));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">Vendor Catalog SKUs</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setIsBulkUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors"
              >
                <Upload className="w-4 h-4" /> Bulk Upload
              </button>
              <button
                onClick={() => exportToCSV(visibleItems as any[], 'catalog.csv')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button
                onClick={() => setIsHelpOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                <HelpCircle className="w-4 h-4" /> Guide
              </button>
            </div>
          </div>

          <HelpModal
            isOpen={isHelpOpen}
            onClose={() => setIsHelpOpen(false)}
            title="Catalog & BOM Mapping Guide"
          >
            <p>
              <strong>Vendor Independence:</strong> Catalog SKUs represent real boxes you buy from
              Amazon, Walmart, or local suppliers. Mapping a SKU's{' '}
              <strong>Kit Components (BOM)</strong> feeds purchased stock into your abstract
              requestable Categories.
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Single-Category Box:</strong> A case of 125 GUSTO plates has Pack Size ={' '}
                <code>125</code> and maps to <em>Compostable Plates</em> with Yield Multiplier ={' '}
                <code>1</code>.
              </li>
              <li>
                <strong>Combo Box:</strong> A combo box with 140 forks, 120 knives, and 120 spoons
                has Pack Size = <code>1</code> and three BOM mappings (140, 120, 120).
              </li>
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
                {visibleItems.map((item) => (
                  <tr key={item.item_number} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Package className="w-5 h-5 text-slate-300" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900 flex items-center gap-2">
                            {item.name}
                            {item.reorder_url && (
                              <a
                                href={item.reorder_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700"
                                title="Reorder Link"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">{item.item_number}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-600">{item.vendor}</div>
                      <div className="text-xs text-slate-500">
                        ${Number(item.price || 0).toFixed(2)} &bull; {item.pack_size} per case
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {showDeleted ? (
                        <button
                          onClick={() => handleRestoreItem(item.item_number)}
                          className="text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleEdit(item)}
                            className="text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(item.item_number)}
                            className="text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      No catalog items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-slate-900">
              {editingItem ? 'Edit Vendor SKU' : 'Add New Vendor SKU'}
            </h2>
            {editingItem && (
              <button
                onClick={() => {
                  setEditingItem(null);
                  setFormData(emptyItemForm);
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
                <input
                  required
                  type="text"
                  disabled={!!editingItem}
                  value={formData.item_number}
                  onChange={(e) => setFormData({ ...formData, item_number: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Vendor</label>
                <input
                  required
                  type="text"
                  value={formData.vendor}
                  onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-medium text-slate-700">Item Name</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="Compostable">Compostable</option>
                  <option value="Reusable">Reusable</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Pack Size (Units per Case)
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  value={formData.pack_size}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      pack_size: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-medium text-slate-700">Price per Case ($)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      price: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-medium text-slate-700">Reorder URL (Optional)</label>
                <input
                  type="url"
                  value={formData.reorder_url}
                  onChange={(e) => setFormData({ ...formData, reorder_url: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="https://..."
                />
              </div>
              <div className="col-span-2">
                <FileUploadField
                  label="Item Image (Optional)"
                  currentUrl={formData.image_url}
                  onUploadSuccess={(url) => setFormData({ ...formData, image_url: url })}
                  fetchWithAuth={fetchWithAuth}
                />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Kit Components (BOM)</h3>
                <button
                  type="button"
                  onClick={addKitComponent}
                  className="text-sm text-emerald-600 font-medium hover:text-emerald-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Add Component
                </button>
              </div>

              <div className="space-y-3">
                {kitComponents.map((kc, i) => (
                  <div
                    key={i}
                    className="flex gap-3 items-end bg-white p-3 rounded-xl border border-slate-200"
                  >
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-slate-500">Maps to Category</label>
                      <select
                        value={kc.category_id}
                        onChange={(e) => updateKitComponent(i, 'category_id', e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-32 space-y-1">
                      <label className="text-xs font-medium text-slate-500">Yield Multiplier</label>
                      <input
                        type="number"
                        min="1"
                        value={kc.yield_multiplier}
                        onChange={(e) =>
                          updateKitComponent(
                            i,
                            'yield_multiplier',
                            Math.max(1, parseInt(e.target.value, 10) || 1)
                          )
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeKitComponent(i)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ))}
                {kitComponents.length === 0 && (
                  <p className="text-sm text-slate-500 italic">
                    No components mapped yet. Map at least one category so restocks update
                    inventory.
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-slate-900 text-white px-4 py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors"
            >
              {editingItem ? 'Save Changes' : 'Save Item to Catalog'}
            </button>
          </form>
        </div>

        {isBulkUploadOpen && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-semibold text-slate-900">Bulk Upload Catalog</h3>
                <button
                  onClick={() => setIsBulkUploadOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
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
                      onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsBulkUploadOpen(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-300 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bulkUploading || !bulkFile}
                    className="flex-1 bg-emerald-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
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

function CategoryManagementView({ fetchWithAuth }: { fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | number | null>(null);

  const defaultForm = {
    name: '',
    item_type: 'consumable' as CategoryItemType,
    kit_yield: 0,
    low_stock_threshold: 100,
    image_url: '',
    is_requestable: 1,
    bulk_unit_label: '',
    bulk_unit_size: 0,
  };

  const [formData, setFormData] = useState(defaultForm);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/categories');
      const data = await res.json();
      if (Array.isArray(data)) {
        setCategories(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId ? `/api/categories/${editingId}` : '/api/categories';
    const method = editingId ? 'PUT' : 'POST';

    const payload = {
      name: formData.name,
      item_type: formData.item_type,
      kit_yield: Number(formData.kit_yield) || 0,
      low_stock_threshold: Number(formData.low_stock_threshold) || 0,
      is_requestable: Number(formData.is_requestable),
      image_url: formData.image_url,
      bulk_unit_label: formData.bulk_unit_label,
      bulk_unit_size: Number(formData.bulk_unit_size) || 0,
    };

    try {
      const res = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditingId(null);
        setFormData(defaultForm);
        fetchCategories();
        alert(editingId ? 'Category updated!' : 'Category created!');
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to save category');
      }
    } catch {
      alert('Error saving category');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-900">
              Categories & Pre-Made Kit Recipe
            </h2>
            <button
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <HelpCircle className="w-4 h-4" /> How to use this page
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 group hover:border-emerald-200 transition-colors"
              >
                <div className="w-16 h-16 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                  {cat.image_url ? (
                    <img
                      src={cat.image_url}
                      alt={cat.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Package className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-semibold text-slate-900 truncate">{cat.name}</h4>
                    {cat.is_requestable === 0 && (
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        INTERNAL
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                      {cat.item_type === 'reusable' ? 'Reusable' : 'Consumable'} &bull; Kit Qty:{' '}
                      {cat.kit_yield || 0}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                      Alert &le; {cat.low_stock_threshold ?? 100}
                      {cat.bulk_unit_size && cat.bulk_unit_size > 0
                        ? ` • ${cat.bulk_unit_label || 'Box'}: ${cat.bulk_unit_size}ct`
                        : ''}
                    </p>
                  </div>
                </div>
                <div>
                  <button
                    onClick={() => {
                      setEditingId(cat.id);
                      setFormData({
                        name: cat.name,
                        item_type: cat.item_type || 'consumable',
                        kit_yield: cat.kit_yield || 0,
                        low_stock_threshold: cat.low_stock_threshold ?? 100,
                        image_url: cat.image_url || '',
                        is_requestable: cat.is_requestable ?? 1,
                        bulk_unit_label: cat.bulk_unit_label || '',
                        bulk_unit_size: cat.bulk_unit_size || 0,
                      });
                    }}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit Category"
                  >
                    <SettingsIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 h-fit sticky top-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            {editingId ? 'Edit Category' : 'Create New Category'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="e.g. Compostable Forks"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Return Behavior
              </label>
              <select
                value={formData.item_type}
                onChange={(e) =>
                  setFormData({ ...formData, item_type: e.target.value as CategoryItemType })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="consumable">Consumable (Single-Use / Compostable)</option>
                <option value="reusable">Reusable (Returned on Check-in)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Qty per Pre-Made Kit
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.kit_yield}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      kit_yield: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Low-Stock Alert
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.low_stock_threshold}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      low_stock_threshold: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Optional: Request by Box / Sleeve
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Leave Size at 0 to disable. Set e.g. Label &ldquo;Sleeve&rdquo; and Size 125 to let
                users request sealed packs on the public form.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <input
                  type="text"
                  value={formData.bulk_unit_label}
                  onChange={(e) => setFormData({ ...formData, bulk_unit_label: e.target.value })}
                  placeholder="Box / Sleeve"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs outline-none"
                />
                <input
                  type="number"
                  min="0"
                  value={formData.bulk_unit_size}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      bulk_unit_size: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  placeholder="0 (Disabled)"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Visibility</label>
              <select
                value={formData.is_requestable}
                onChange={(e) =>
                  setFormData({ ...formData, is_requestable: parseInt(e.target.value, 10) })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value={1}>Publicly Requestable</option>
                <option value={0}>Internal Only (Hidden from Public Form)</option>
              </select>
            </div>

            <FileUploadField
              label="Category Image"
              currentUrl={formData.image_url}
              onUploadSuccess={(url) => setFormData({ ...formData, image_url: url })}
              fetchWithAuth={fetchWithAuth}
            />

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors"
              >
                {editingId ? 'Save Changes' : 'Create Category'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setFormData(defaultForm);
                  }}
                  className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Categories & Kits Walkthrough"
      >
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Return Behavior:</strong> Controls whether checking in a request restores items
            to On-Shelf stock (<em>Reusable</em>) or leaves them consumed (<em>Consumable</em>).
          </li>
          <li>
            <strong>Qty per Pre-Made Kit:</strong> Setting e.g. 25 on Plates/Cutlery/Cups and 50 on
            Napkins automatically powers the 25-Person Pre-Made Set on the public form.
          </li>
          <li>
            <strong>Optional Box/Sleeve Size:</strong> Enables whole-sleeve or whole-box ordering on
            a category without coupling public requests to vendor case sizes.
          </li>
        </ul>
      </HelpModal>
    </div>
  );
}

function UserManagementView({
  currentUser,
  fetchWithAuth,
}: {
  currentUser: any;
  fetchWithAuth: any;
}) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    password: '',
    role: 'user',
  });

  const fetchUsers = () => {
    fetchWithAuth('/api/users')
      .then((res: Response) => res.json())
      .then((data: any) => {
        setUsers(Array.isArray(data) ? data : []);
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
      password: '',
      role: user.role || 'user',
    });
  };

  const handleDelete = async (id: string) => {
    if (id === currentUser.id) {
      alert('You cannot delete your own account.');
      return;
    }
    if (confirm('Are you sure you want to delete this user account?')) {
      const res = await fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || 'Failed to delete user');
      }
      fetchUsers();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
    const method = editingUser ? 'PUT' : 'POST';

    if (!editingUser && formData.password.length < 8) {
      alert('Password must be at least 8 characters for new users.');
      return;
    }

    const res = await fetchWithAuth(url, {
      method,
      body: JSON.stringify(formData),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save user');
      return;
    }

    setEditingUser(null);
    setFormData({ username: '', full_name: '', password: '', role: 'user' });
    fetchUsers();
    alert(editingUser ? 'User updated!' : 'User added!');
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-900">Staff Accounts</h2>
            <div className="flex gap-2">
              <button
                onClick={() => exportToCSV(users, 'users.csv')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button
                onClick={() => setIsHelpOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                <HelpCircle className="w-4 h-4" /> Roles Guide
              </button>
            </div>
          </div>

          <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Username</th>
                  <th className="px-4 py-3">Full Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3 rounded-tr-lg text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{user.username}</td>
                    <td className="px-4 py-3 text-slate-600">{user.full_name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs uppercase font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {user.role || 'user'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => handleEdit(user)}
                        className="text-emerald-600 hover:text-emerald-800 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="text-red-600 hover:text-red-800 font-medium disabled:opacity-40"
                        disabled={user.id === currentUser.id}
                        title={user.id === currentUser.id ? 'Cannot delete current user' : ''}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password{' '}
                {editingUser && (
                  <span className="text-slate-400 font-normal">(Leave blank to keep current)</span>
                )}
              </label>
              <input
                type="password"
                minLength={8}
                required={!editingUser}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="user">User (Requests & Live Inventory)</option>
                <option value="audit">Audit (Strictly Read-Only + Logs)</option>
                <option value="admin">Admin (Procurement, Catalog & Recurring)</option>
                <option value="super_admin">Super Admin (Users, Recycle Bin & Settings)</option>
              </select>
            </div>
            <div className="pt-2 flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors"
              >
                {editingUser ? 'Save Changes' : 'Add User'}
              </button>
              {editingUser && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingUser(null);
                    setFormData({ username: '', full_name: '', password: '', role: 'user' });
                  }}
                  className="px-4 py-2 rounded-lg font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} title="Staff Role Matrix">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>User:</strong> Day-to-day checkout/check-in operations on the Requests queue.
          </li>
          <li>
            <strong>Audit:</strong> Read-only access to Requests, Inventory, Procurement History
            (including receipts), and System Audit Logs. Cannot modify any data.
          </li>
          <li>
            <strong>Admin:</strong> Full operational control over Requests, Recurring Spawner,
            Categories, Vendor Catalog, and Procurement.
          </li>
          <li>
            <strong>Super Admin:</strong> Adds User Management, Recycle Bin restore capabilities,
            and Email/Domain Whitelist settings.
          </li>
        </ul>
      </HelpModal>
    </div>
  );
}

function SystemLogsSettingsView({
  currentUser,
  fetchWithAuth,
}: {
  currentUser: any;
  fetchWithAuth: any;
}) {
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [settings, setSettings] = useState({
    request_notification_email: '',
    low_inventory_email: '',
    allowed_domains: [] as string[],
  });
  const [newDomain, setNewDomain] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const logsRes = await fetchWithAuth('/api/logs');
      const logsData = await logsRes.json();
      setLogs(Array.isArray(logsData) ? logsData : []);

      if (isSuperAdmin) {
        const settingsRes = await fetchWithAuth('/api/settings');
        const settingsData = await settingsRes.json();
        if (settingsRes.ok && settingsData && !settingsData.error) {
          setSettings({
            request_notification_email: settingsData.request_notification_email || '',
            low_inventory_email: settingsData.low_inventory_email || '',
            allowed_domains: settingsData.allowed_domains || [],
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        alert('Settings saved successfully!');
        fetchData();
      } else {
        alert('Failed to save settings');
      }
    } catch {
      alert('Error saving settings');
    }
  };

  const addDomain = () => {
    const formatted = newDomain.trim().toLowerCase();
    if (!formatted) return;
    const withAt = formatted.startsWith('@') ? formatted : `@${formatted}`;
    if (!settings.allowed_domains.includes(withAt)) {
      setSettings({ ...settings, allowed_domains: [...settings.allowed_domains, withAt] });
      setNewDomain('');
    }
  };

  const removeDomain = (domain: string) => {
    setSettings({
      ...settings,
      allowed_domains: settings.allowed_domains.filter((d) => d !== domain),
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-100 rounded-lg w-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className={`${isSuperAdmin ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-6`}>
          {isSuperAdmin && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Allowed Email Domains</h3>
              <p className="text-sm text-slate-600 mb-4">
                Restrict public form submissions to these official County or State email suffixes
                (remember to click Save Settings after editing).
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="e.g. @hawaiicounty.gov"
                />
                <button
                  type="button"
                  onClick={addDomain}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
                >
                  Add Domain
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {settings.allowed_domains.map((domain) => (
                  <span
                    key={domain}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium shadow-sm"
                  >
                    {domain}
                    <button
                      type="button"
                      onClick={() => removeDomain(domain)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-900">System Audit Logs</h2>
            <div className="flex gap-2">
              <button
                onClick={() => exportToCSV(logs, 'audit_logs.csv')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button
                onClick={() => setIsHelpOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                <HelpCircle className="w-4 h-4" /> Guide
              </button>
            </div>
          </div>

          <HelpModal
            isOpen={isHelpOpen}
            onClose={() => setIsHelpOpen(false)}
            title="Audit Trail & Settings"
          >
            <p>
              Every checkout, check-in, order entry, catalog edit, and user permission update writes
              an immutable entry to the System Audit Logs.
            </p>
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
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {log.username || log.user || 'System'}
                    </td>
                    <td className="px-4 py-3 text-emerald-600 font-medium">{log.action}</td>
                    <td className="px-4 py-3 text-slate-600">{log.details}</td>
                    <td className="px-4 py-3">
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <pre className="text-xs bg-slate-100 p-1.5 rounded whitespace-pre-wrap">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-slate-400 text-xs italic">None</span>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No audit logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {isSuperAdmin && (
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit sticky top-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Email & Whitelist Settings
            </h3>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  New Request Notification Email
                </label>
                <input
                  type="email"
                  required
                  value={settings.request_notification_email}
                  onChange={(e) =>
                    setSettings({ ...settings, request_notification_email: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Low Inventory Warning Email
                </label>
                <input
                  type="email"
                  required
                  value={settings.low_inventory_email}
                  onChange={(e) =>
                    setSettings({ ...settings, low_inventory_email: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-800 transition-colors"
                >
                  Save All Settings
                </button>
              </div>
            </form>
          </div>
        )}

        {isSuperAdmin && (
          <div className="lg:col-span-3 bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Power BI Integration (M2M)
            </h3>
            <div className="space-y-2 text-sm text-slate-700">
              <p>Connect Power BI via the Web connector using the endpoint below:</p>
              <div className="bg-slate-900 text-emerald-400 p-3 rounded-lg font-mono text-xs overflow-x-auto">
                {window.location.origin}/api/export/analytics
              </div>
              <p>
                Pass your configured <code className="bg-slate-200 px-1 py-0.5 rounded">POWERBI_API_KEY</code> via the{' '}
                <code className="bg-slate-200 px-1 py-0.5 rounded">x-api-key</code> HTTP header.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RecurringOrdersView({ fetchWithAuth }: { fetchWithAuth: any }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [department, setDepartment] = useState('');
  const [eventName, setEventName] = useState('');
  const [frequency, setFrequency] = useState<
    'weekly' | 'monthly_exact' | 'monthly_nth_weekday' | 'quarterly' | 'annually'
  >('monthly_exact');
  const [nextRunDate, setNextRunDate] = useState('');
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [ordinal, setOrdinal] = useState('first');
  const [weekday, setWeekday] = useState('1');
  const [isStationed, setIsStationed] = useState(false);

  const fetchTemplatesAndCategories = async () => {
    try {
      setLoading(true);
      const [tplRes, catRes] = await Promise.all([
        fetchWithAuth('/api/recurring'),
        fetchWithAuth('/api/admin/categories'),
      ]);
      if (tplRes.ok && catRes.ok) {
        setTemplates(await tplRes.json());
        setCategories(await catRes.json());
      }
    } catch (err) {
      console.error('Error fetching recurring orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplatesAndCategories();
  }, []);

  const addLineItem = () => {
    if (categories.length > 0) {
      setLineItems([
        ...lineItems,
        {
          category_id: categories[0].id,
          category_name: categories[0].name,
          quantity: 1,
        },
      ]);
    }
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const updated = [...lineItems];
    if (field === 'category_id') {
      const cat = categories.find((c) => String(c.id) === String(value));
      updated[index] = {
        ...updated[index],
        category_id: value,
        category_name: cat ? cat.name : 'Unknown',
      };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const handleDeleteTemplate = async (id: string) => {
    if (
      confirm(
        'Archive this recurring order template? Future spawns will stop, and any stationed reusable stock will be returned to inventory.'
      )
    ) {
      try {
        const response = await fetchWithAuth(`/api/recurring/${id}`, { method: 'DELETE' });
        if (response.ok) {
          fetchTemplatesAndCategories();
        } else {
          alert('Failed to delete template');
        }
      } catch (err) {
        console.error('Error deleting template:', err);
      }
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!department || !eventName || !nextRunDate || lineItems.length === 0) {
      alert('Please fill out all required fields and add at least one line item.');
      return;
    }
    try {
      setSubmitting(true);
      const response = await fetchWithAuth('/api/recurring', {
        method: 'POST',
        body: JSON.stringify({
          department,
          event_name: eventName,
          frequency,
          next_run_date: new Date(`${nextRunDate}T12:00:00Z`).toISOString(),
          line_items: lineItems,
          is_stationed: isStationed,
          ordinal,
          weekday,
        }),
      });
      if (response.ok) {
        setDepartment('');
        setEventName('');
        setFrequency('monthly_exact');
        setNextRunDate('');
        setLineItems([]);
        setIsStationed(false);
        setOrdinal('first');
        setWeekday('1');
        fetchTemplatesAndCategories();
      } else {
        alert('Failed to create recurring order template');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Recurring Order Spawner Templates
          </h2>
          <p className="text-sm text-slate-500">
            Matching rules automatically spawn Approved or Stationed tickets within a 30-day
            lookahead window.
          </p>
        </div>
        <button
          onClick={() => setIsHelpOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors shrink-0"
        >
          <HelpCircle className="w-4 h-4" /> How to use this page
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Active Recurrences
            </h3>
            {loading ? (
              <div className="py-8 text-center text-slate-500">Loading templates...</div>
            ) : templates.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                No active recurring rules specified.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Event Name</th>
                      <th className="py-3 px-4">Frequency</th>
                      <th className="py-3 px-4">Next Event Date</th>
                      <th className="py-3 px-4">Line Items</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {templates.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {entry.department}
                          {entry.is_stationed && (
                            <span className="block text-[10px] text-emerald-700 font-semibold uppercase">
                              Stationed Off-Site
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{entry.event_name}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {entry.frequency}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {entry.next_run_date ? entry.next_run_date.split('T')[0] : 'N/A'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs text-slate-600 max-w-xs space-y-0.5">
                            {(entry.line_items || []).map((li: any, idx: number) => (
                              <div
                                key={idx}
                                className="flex justify-between border-b border-dashed border-slate-100 pb-0.5"
                              >
                                <span>{li.category_name}</span>
                                <span className="font-semibold text-slate-800 ml-2">
                                  x{li.quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteTemplate(entry.id)}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer transition-colors"
                            title="Archive Recurrence Rule"
                          >
                            <Trash2 className="w-4 h-4 inline-block" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 h-fit space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
            Configure New Recurrence
          </h3>

          <form onSubmit={handleCreateTemplate} className="space-y-4 text-sm text-slate-700">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Department</label>
              <select
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border cursor-pointer"
              >
                <option value="" disabled>
                  Select a Department...
                </option>
                {hawaiiCountyDepartments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Event Name</label>
              <input
                type="text"
                required
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Planning Commission Meeting"
                className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly_exact">Monthly (Exact Date)</option>
                <option value="monthly_nth_weekday">Monthly (Nth Weekday)</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>

            {frequency === 'monthly_nth_weekday' && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ordinal</label>
                  <select
                    value={ordinal}
                    onChange={(e) => setOrdinal(e.target.value)}
                    className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border"
                  >
                    <option value="first">First</option>
                    <option value="second">Second</option>
                    <option value="third">Third</option>
                    <option value="fourth">Fourth</option>
                    <option value="last">Last</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Weekday</label>
                  <select
                    value={weekday}
                    onChange={(e) => setWeekday(e.target.value)}
                    className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border"
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="flex items-start gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={isStationed}
                  onChange={(e) => setIsStationed(e.target.checked)}
                  className="mt-1 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="block text-xs font-semibold text-slate-700">
                    Items Relocated to Hub (Stationed)
                  </span>
                  <p className="text-[10px] text-slate-500">
                    Deducts reusable allocation upfront for off-site partner hubs (e.g. West Hawaiʻi
                    Civic Center) and spawns &lsquo;Stationed Usage&rsquo; tracking tickets.
                  </p>
                </div>
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                First Event Date
              </label>
              <input
                type="date"
                required
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
                className="w-full rounded-lg border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 text-sm px-3 py-2 bg-white border text-slate-700"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold text-slate-600">
                  Reserved Line Items
                </label>
                <button
                  type="button"
                  onClick={addLineItem}
                  className="text-xs text-emerald-600 hover:text-emerald-800 font-medium cursor-pointer"
                >
                  + Add Item
                </button>
              </div>
              {lineItems.length === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  No line items added yet. Click &ldquo;+ Add Item&rdquo; above.
                </p>
              ) : (
                <div className="space-y-2 border-t border-slate-200 pt-2 max-h-48 overflow-y-auto pr-1">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        value={item.category_id}
                        onChange={(e) => updateLineItem(idx, 'category_id', e.target.value)}
                        className="flex-1 rounded-lg border-slate-300 text-xs py-1.5 px-2 bg-white border text-slate-700"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        required
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(idx, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        className="w-16 rounded-lg border-slate-300 text-xs py-1.5 px-2 bg-white border text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                        title="Remove Item"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-2.5 rounded-xl text-sm transition-colors cursor-pointer mt-2"
            >
              {submitting ? 'Creating...' : 'Register Recurrence Rule'}
            </button>
          </form>
        </div>
      </div>

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        title="Recurring Requests Walkthrough"
      >
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>30-Day Lookahead Spawner:</strong> When Cloud Scheduler triggers{' '}
            <code>POST /api/cron/process-recurring</code>, any rule due within the next 30 days
            spawns an Approved ticket in the Requests Queue and advances its next run date.
          </li>
          <li>
            <strong>Stationed Hubs:</strong> Use the Stationed checkbox when reusable kits live
            permanently with a partner department; archiving the rule returns reusable stock back to
            OSCER's shelf count.
          </li>
        </ul>
      </HelpModal>
    </div>
  );
}
