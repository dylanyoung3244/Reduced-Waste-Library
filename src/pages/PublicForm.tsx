import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { cn } from '../lib/utils';
import { CheckCircle2, AlertCircle } from 'lucide-react';

const hawaiiCountyDepartments = [
  "Animal Control and Rescue Agency",
  "Civil Defense Agency",
  "Corporation Counsel",
  "County Council",
  "Department of Environmental Management",
  "Department of Finance",
  "Department of Human Resources",
  "Department of Information Technology",
  "Department of Liquor Control",
  "Department of Parks and Recreation",
  "Department of Public Works",
  "Department of Research and Development",
  "Department of Water Supply",
  "Elections Division",
  "Hawaiʻi Fire Department",
  "Hawaiʻi Police Department",
  "Mass Transit Agency",
  "Mayor's Office",
  "Office of Aging",
  "Office of Housing and Community Development",
  "Office of Sustainability, Climate, Equity, and Resilience (OSCER)",
  "Office of the County Auditor",
  "Office of the County Clerk",
  "Office of the Prosecuting Attorney",
  "Planning Department"
];

export function PublicForm() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    requester_name: '',
    department: '',
    event_name: '',
    check_out_date: '',
    check_in_date: '',
    terms_agreed: false,
  });

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [setsRequested, setSetsRequested] = useState(0);

  // Map category names to their yield in a single 25-person set
  const setYields: Record<string, number> = {
    'Compostable Plates': 25,
    'Reusable Cups': 25,
    'Compostable Forks': 25,
    'Compostable Knives': 25,
    'Compostable Spoons': 25,
    'Compostable Napkins': 50,
  };

  useEffect(() => {
    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        setInventory(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load categories.');
        setLoading(false);
      });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleQuantityChange = (categoryId: string, categoryName: string, value: string, max: number) => {
    let num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      setQuantities(prev => ({ ...prev, [categoryId]: 0 }));
      return;
    }
    
    // Enforce interval of 10 unless it's a water jug
    const isJug = categoryName === 'Reusable Water Jugs';
    if (!isJug) {
      num = Math.round(num / 10) * 10;
    }

    if (num > max) {
      setQuantities(prev => ({ ...prev, [categoryId]: isJug ? max : Math.floor(max / 10) * 10 }));
      return;
    }
    setQuantities(prev => ({ ...prev, [categoryId]: num }));
  };

  const getTotalQuantity = (item: InventoryItem) => {
    const aLaCarte = quantities[item.id] || 0;
    const categoryName = item.name || 'Unknown';
    const setYield = setYields[categoryName] || 0;
    return aLaCarte + (setsRequested * setYield);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.terms_agreed) {
      setError('You must agree to the terms.');
      return;
    }

    const line_items = inventory
      .map(item => ({
        category_id: item.id,
        category_name: (item as any).name || item.category_name || item.category || 'Unknown Item',
        quantity: getTotalQuantity(item)
      }))
      .filter(item => item.quantity > 0);

    if (line_items.length === 0) {
      setError('Please select at least one item to request.');
      return;
    }

    // Check if total requested exceeds available inventory
    const exceededItems = inventory.filter(item => {
      const currentCount = item.current_count ?? item.count ?? 0;
      return getTotalQuantity(item) > currentCount;
    });
    if (exceededItems.length > 0) {
      setError(`Requested quantity exceeds available inventory for: ${exceededItems.map(i => i.name || 'Unknown').join(', ')}`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          line_items
        })
      });

      if (!res.ok) throw new Error('Failed to submit request');
      
      setSuccess(true);
      setFormData({
        requester_name: '',
        department: '',
        event_name: '',
        check_out_date: '',
        check_in_date: '',
        terms_agreed: false,
      });
      setQuantities({});
      setSetsRequested(0);
    } catch (err) {
      console.error(err);
      setError('An error occurred while submitting your request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div></div>;
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Request Submitted!</h2>
        <p className="text-slate-600 mb-6">Your request has been received and is awaiting staff approval.</p>
        <button 
          onClick={() => setSuccess(false)}
          className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          Submit Another Request
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Request Items</h1>
        <p className="text-slate-600 mt-2">Fill out the form below to request items from the Reduced Waste Library.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <h2 className="text-xl font-semibold text-slate-900 border-b border-slate-100 pb-4">Event Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Full Name</label>
              <input 
                required
                type="text" 
                name="requester_name"
                value={formData.requester_name}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Department</label>
              <select
                required
                name="department"
                value={formData.department}
                onChange={handleInputChange as any}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white"
              >
                <option value="" disabled>Select a Department...</option>
                {hawaiiCountyDepartments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Event Name</label>
              <input 
                required
                type="text" 
                name="event_name"
                value={formData.event_name}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Annual Picnic"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Check-out Date</label>
              <input 
                required
                type="date" 
                name="check_out_date"
                value={formData.check_out_date}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Check-in Date</label>
              <input 
                required
                type="date" 
                name="check_in_date"
                value={formData.check_in_date}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <h2 className="text-xl font-semibold text-slate-900 border-b border-slate-100 pb-4">Select Items</h2>
          
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 mb-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">25 Person Pre-Made Sets</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  This set includes the following: 25 - Compostable Plates, 25 - Reusable (Aluminum) Cups, 25 - Compostable Forks, 25 - Compostable Knives, 25 - Compostable Spoons, ~50 - Compostable Napkins
                </p>
              </div>
              <div className="shrink-0">
                <input
                  type="number"
                  min="0"
                  value={setsRequested || ''}
                  onChange={(e) => setSetsRequested(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 px-3 py-2 rounded-lg border border-emerald-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">A La Carte Items (Intervals of 10)</h3>
            {inventory.map((item) => {
              const total = getTotalQuantity(item);
              const currentCount = item.current_count ?? item.count ?? 0;
              const categoryName = item.name || 'Unknown';
              const isExceeded = total > currentCount;

              return (
                <div key={item.id} className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border ${isExceeded ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50/50 hover:bg-slate-50'} transition-colors gap-4`}>
                  <div>
                    <h3 className="font-medium text-slate-900">{categoryName}</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      {currentCount > 0 ? (
                        <span className="text-emerald-600 font-medium">{currentCount} available</span>
                      ) : (
                        <span className="text-red-500 font-medium">Out of stock</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`text-sm font-medium ${isExceeded ? 'text-red-600' : 'text-slate-700'}`}>
                        Total Requested: {total}
                      </div>
                      {isExceeded && <div className="text-xs text-red-500">Exceeds inventory</div>}
                    </div>
                    <div className="w-px h-8 bg-slate-200 hidden md:block"></div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">
                        A La Carte {item.name === 'Reusable Water Jugs' ? '(+1)' : '(+10)'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step={item.name === 'Reusable Water Jugs' ? "1" : "10"}
                        value={quantities[item.id] || ''}
                        onChange={(e) => handleQuantityChange(item.id, item.name, e.target.value, currentCount)}
                        disabled={currentCount <= 0}
                        className="w-24 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-100"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="flex items-center h-6">
              <input 
                type="checkbox" 
                name="terms_agreed"
                checked={formData.terms_agreed}
                onChange={handleInputChange}
                className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 transition-all cursor-pointer"
              />
            </div>
            <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
              Upon completion of the event, I will wash the equipment and return it to OSCER within 1 week. If the equipment is damaged, lost, or stolen, I will report this to OSCER.
            </span>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-70 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Submitting...
              </>
            ) : (
              'Submit Request'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
