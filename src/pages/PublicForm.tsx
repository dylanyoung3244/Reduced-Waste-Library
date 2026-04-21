import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { cn } from '../lib/utils';
import { CheckCircle2, AlertCircle } from 'lucide-react';

const hawaiiCountyDepartments = [
  "Animal Control and Protection Agency",
  "Civil Defense Agency",
  "Corporation Counsel",
  "County Council",
  "Department of Environmental Management",
  "Department of Finance",
  "Department of Human Resources",
  "Department of Information Technology",
  "Department of Liquor Control",
  "Department of Parks and Recreation",
  "Department of Planning",
  "Department of Public Works",
  "Department of Research and Development",
  "Department of Water Supply",
  "Elections Division",
  "Fire Department",
  "Mass Transit Agency",
  "Mayor's Office",
  "Office of Aging",
  "Office of Housing and Community Development",
  "Office of Sustainability, Climate, Equity, and Resilience (OSCER)",
  "Office of the County Auditor",
  "Office of the County Clerk",
  "Office of the Prosecuting Attorney",
  "Police Department"
];

const sortOrder = [
  "Compostable Napkins",
  "Compostable Chopsticks",
  "Compostable Forks",
  "Compostable Spoons",
  "Compostable Knives",
  "Reusable (Aluminum) Cups",
  "Reusable (Aluminum) Plates",
  "Reusable Water Jugs"
];

export function PublicForm() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    requester_name: '',
    requester_email: '',
    requester_phone: '',
    department: '',
    event_name: '',
    check_out_date: '',
    check_in_date: '',
    terms_agreed: false,
  });

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [setsRequested, setSetsRequested] = useState(0);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [kitComponents, setKitComponents] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setAllowedDomains(data.allowed_domains || []))
      .catch(err => console.error('Failed to load settings', err));

    fetch('/api/categories')
      .then(res => res.json())
      .then(data => {
        const cats = Array.isArray(data) ? data : [];
        setInventory(cats);
        setKitComponents(cats.filter((cat: any) => cat.default_yield > 0));
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load categories.');
        setLoading(false);
      });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    // Checkbox handling
    let parsedValue: string | boolean = value;
    if (type === 'checkbox') {
      parsedValue = (e.target as HTMLInputElement).checked;
    }

    // Weekend Blocker Logic
    if (name === 'check_out_date' || name === 'check_in_date') {
      const selectedDate = new Date(value);
      const day = selectedDate.getUTCDay();
      if (day === 0 || day === 6) {
        setError('Check-out and check-in dates cannot fall on a weekend.');
        return; 
      } else {
        setError(''); 
      }
    }

    setFormData(prev => ({
      ...prev,
      [name]: parsedValue
    }));
  };

  const handleQuantityChange = (categoryId: string, categoryName: string, value: string, max: number) => {
    let num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      setQuantities(prev => ({ ...prev, [categoryId]: 0 }));
      return;
    }
    
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
    const setYield = (item as any).kit_yield || 0;
    return aLaCarte + (setsRequested * setYield);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.terms_agreed) {
      setError('You must agree to the terms.');
      return;
    }

    // Frontend Email Whitelist Check
    const email = formData.requester_email.toLowerCase();
    const domainsToCheck = allowedDomains.length > 0 ? allowedDomains : ['@hawaiicounty.gov', '@hawaii.gov', '@hawaiipolice.gov', '@hawaiiprosecutors.gov'];
    const isAllowed = domainsToCheck.some(domain => email.endsWith(domain.toLowerCase()));

    if (!isAllowed) {
      setError('Invalid email domain. Please use an approved county email address.');
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

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to submit request.');
        return;
      }
      
      setSuccess(true);
      setFormData({
        requester_name: '',
        requester_email: '',
        requester_phone: '',
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
        <p className="text-slate-600 mb-2">Your request has been received and is awaiting staff approval.</p>
        <p className="text-emerald-700 font-medium mb-6">We will confirm with you within 2 business days. Thank you for using the Reduced Waste Library!</p>
        <button 
          onClick={() => setSuccess(false)}
          className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          Submit Another Request
        </button>
      </div>
    );
  }

  // Sort inventory based on Kendra's custom order
  const sortedInventory = [...inventory].sort((a, b) => {
    const aName = a.name || '';
    const bName = b.name || '';
    const aIndex = sortOrder.indexOf(aName);
    const bIndex = sortOrder.indexOf(bName);
    const aVal = aIndex === -1 ? 999 : aIndex;
    const bVal = bIndex === -1 ? 999 : bIndex;
    return aVal - bVal;
  });

  // Calculate dynamic kit details
  const platesItem = inventory.find(i => i.name === 'Compostable Plates' || (i as any).category_name === 'Compostable Plates') as any;
  const baseKitSize = platesItem && platesItem.kit_yield > 0 ? platesItem.kit_yield : 25;

  const napkinsItem = inventory.find(i => i.name === 'Compostable Napkins' || (i as any).category_name === 'Compostable Napkins') as any;
  const napkinYield = napkinsItem && napkinsItem.kit_yield > 0 ? napkinsItem.kit_yield : 50;

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
              <label className="text-sm font-medium text-slate-700">County Email Address</label>
              <input 
                required
                type="email" 
                name="requester_email"
                value={formData.requester_email}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="jane@example.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Phone Number</label>
              <input 
                required
                type="tel" 
                name="requester_phone"
                value={formData.requester_phone}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Department</label>
              <select
                required
                name="department"
                value={formData.department}
                onChange={handleInputChange}
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
                <h3 className="text-lg font-semibold text-emerald-900">{baseKitSize} Person Pre-Made Sets</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  This set includes: {baseKitSize} compostable plates, forks, knives, and spoons; {baseKitSize} reusable (aluminum) cups, and ~{napkinYield} compostable napkins.
                </p>
                <div className="flex flex-wrap gap-3 mt-3">
                  {kitComponents.map(c => c.image_url && (
                    <div key={c.id} className="group relative">
                      <img src={c.image_url} alt={c.name} className="w-10 h-10 rounded-lg border border-emerald-200 object-cover shadow-sm grayscale hover:grayscale-0 transition-all cursor-help" referrerPolicy="no-referrer" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-emerald-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                        {c.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0">
                <label className="block text-xs font-bold text-emerald-800 uppercase mb-1">Kit Quantity</label>
                <input
                  type="number"
                  min="0"
                  value={setsRequested || ''}
                  onChange={(e) => setSetsRequested(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 px-3 py-2 rounded-lg border border-emerald-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">A La Carte Items (Intervals of 10)</h3>
            {sortedInventory.filter(cat => cat.is_requestable !== 0).map((item) => {
              const total = getTotalQuantity(item);
              const currentCount = item.current_count ?? item.count ?? 0;
              const categoryName = item.name || 'Unknown';
              const isExceeded = total > currentCount;
              // Check if the item object has a photo_url or image_url from the DB
              const imageUrl = (item as any).photo_url || (item as any).image_url;

              return (
                <div key={item.id} className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border ${isExceeded ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50/50 hover:bg-slate-50'} transition-colors gap-4`}>
                  <div className="flex items-center gap-4">
                    {imageUrl && (
                      <div className="shrink-0 hidden md:block">
                        <img src={imageUrl} alt={categoryName} className="w-12 h-12 object-cover rounded shadow-sm border border-slate-200" />
                      </div>
                    )}
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

        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

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
