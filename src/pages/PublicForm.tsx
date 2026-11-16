import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { CheckCircle2, AlertCircle, Package } from 'lucide-react';

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

const sortOrder = [
  'Compostable Plates',
  'Compostable Napkins',
  'Compostable Chopsticks',
  'Compostable Forks',
  'Compostable Spoons',
  'Compostable Knives',
  'Reusable Cups',
  'Reusable (Aluminum) Cups',
  'Reusable Plates',
  'Reusable (Aluminum) Plates',
  'Reusable Water Jugs',
];

const DEFAULT_DOMAINS = [
  '@hawaiicounty.gov',
  '@hawaii.gov',
  '@hawaiipolice.gov',
  '@hawaiiprosecutors.gov',
];

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWeekendDateString(isoDate: string): boolean {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = localDate.getDay();
  return day === 0 || day === 6;
}

function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added++;
    }
  }
  return result;
}

export function PublicForm() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [refillBanner, setRefillBanner] = useState('');

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
  const [bulkBoxes, setBulkBoxes] = useState<Record<string, number>>({});
  const [setsRequested, setSetsRequested] = useState(0);
  const [allowedDomains, setAllowedDomains] = useState<string[]>(DEFAULT_DOMAINS);

  useEffect(() => {
    fetch('/api/allowed-domains')
      .then((res) => (res.ok ? res.json() : { allowed_domains: DEFAULT_DOMAINS }))
      .then((data) => {
        if (Array.isArray(data?.allowed_domains) && data.allowed_domains.length > 0) {
          setAllowedDomains(data.allowed_domains);
        }
      })
      .catch((err) => console.error('Failed to load allowed domains:', err));

    const refillId = new URLSearchParams(window.location.search).get('refill');

    fetch('/api/categories')
      .then((res) => res.json())
      .then(async (data) => {
        const cats: InventoryItem[] = Array.isArray(data) ? data : [];
        setInventory(cats);

        if (refillId) {
          try {
            const tplRes = await fetch(`/api/public/refill/${encodeURIComponent(refillId)}`);
            if (tplRes.ok) {
              const tpl = await tplRes.json();
              const nextWeekday = formatLocalDate(addBusinessDays(new Date(), 2));
              setFormData((prev) => ({
                ...prev,
                department: tpl.department || prev.department,
                event_name: tpl.event_name ? `Restock: ${tpl.event_name}` : prev.event_name,
                check_out_date: nextWeekday,
                check_in_date: nextWeekday,
              }));

              const prefilledQty: Record<string, number> = {};
              for (const li of tpl.line_items || []) {
                const matchedCat = cats.find((c) => String(c.id) === String(li.category_id));
                if (!matchedCat) continue;
                const step = matchedCat.name === 'Reusable Water Jugs' ? 1 : 10;
                const available =
                  matchedCat.available_to_promise ?? matchedCat.current_count ?? 0;
                const rounded = Math.ceil((Number(li.quantity) || 0) / step) * step;
                const maxStepAligned =
                  step > 1 ? Math.floor(available / step) * step : available;
                prefilledQty[matchedCat.id] = Math.min(rounded, Math.max(0, maxStepAligned));
              }
              setQuantities(prefilledQty);
              setRefillBanner(
                `Pre-filled consumable restock for "${tpl.event_name}". Adjust quantities below if needed.`
              );
            }
          } catch (e) {
            console.error('Failed to load refill template:', e);
          }
        }

        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load available library items.');
        setLoading(false);
      });
  }, []);

  const today = new Date();
  const minCheckOutDateString = formatLocalDate(addBusinessDays(today, 2));
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60);
  const maxDateString = formatLocalDate(maxDate);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    let parsedValue: string | boolean = value;
    if (type === 'checkbox') {
      parsedValue = (e.target as HTMLInputElement).checked;
    }

    if (name === 'check_out_date' || name === 'check_in_date') {
      if (value && isWeekendDateString(value)) {
        setError('Check-out and check-in dates cannot fall on a weekend (Monday-Friday only).');
        return;
      }

      if (name === 'check_out_date' && value && value < minCheckOutDateString) {
        setError('Please allow at least 2 business days lead time for check-out preparation.');
        return;
      }

      if (
        name === 'check_in_date' &&
        value &&
        formData.check_out_date &&
        value < formData.check_out_date
      ) {
        setError('Check-in date cannot be earlier than the check-out date.');
        return;
      }

      setError('');
    }

    setFormData((prev) => {
      const updated = { ...prev, [name]: parsedValue };
      if (
        name === 'check_out_date' &&
        typeof parsedValue === 'string' &&
        prev.check_in_date &&
        prev.check_in_date < parsedValue
      ) {
        updated.check_in_date = parsedValue;
      }
      return updated;
    });
  };

  const getItemStep = (item: InventoryItem): number => {
    return item.name === 'Reusable Water Jugs' ? 1 : 10;
  };

  const handleQuantityChange = (item: InventoryItem, value: string, availableCount: number) => {
    if (value === '') {
      setQuantities((prev) => ({ ...prev, [item.id]: 0 }));
      return;
    }

    let num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      setQuantities((prev) => ({ ...prev, [item.id]: 0 }));
      return;
    }

    const step = getItemStep(item);
    if (step > 1) {
      num = Math.round(num / step) * step;
    }

    const otherAllocated =
      setsRequested * (item.kit_yield || 0) +
      (bulkBoxes[item.id] || 0) * (item.bulk_unit_size || 0);
    const remainingMax = Math.max(0, availableCount - otherAllocated);
    const clampedMax = step > 1 ? Math.floor(remainingMax / step) * step : remainingMax;

    setQuantities((prev) => ({ ...prev, [item.id]: Math.min(num, clampedMax) }));
  };

  const handleBulkBoxChange = (item: InventoryItem, value: string) => {
    const boxes = Math.max(0, parseInt(value, 10) || 0);
    setBulkBoxes((prev) => ({ ...prev, [item.id]: boxes }));
  };

  const getTotalQuantity = (item: InventoryItem): number => {
    const aLaCarte = quantities[item.id] || 0;
    const setYield = item.kit_yield || 0;
    const boxUnits = (bulkBoxes[item.id] || 0) * (item.bulk_unit_size || 0);
    return aLaCarte + setsRequested * setYield + boxUnits;
  };

  const buildPackHint = (item: InventoryItem): string | undefined => {
    const parts: string[] = [];
    const kitYield = item.kit_yield || 0;
    const boxes = bulkBoxes[item.id] || 0;
    const boxSize = item.bulk_unit_size || 0;
    const aLaCarte = quantities[item.id] || 0;

    if (setsRequested > 0 && kitYield > 0) {
      parts.push(`${setsRequested}x Kit (${setsRequested * kitYield})`);
    }
    if (boxes > 0 && boxSize > 0) {
      parts.push(`${boxes}x ${item.bulk_unit_label || 'Box'} (${boxes * boxSize})`);
    }
    if (aLaCarte > 0 && (parts.length > 0 || boxSize > 0)) {
      parts.push(`+${aLaCarte} loose`);
    }
    return parts.length > 0 ? parts.join(' + ') : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.terms_agreed) {
      setError('You must agree to the return and care terms.');
      return;
    }

    if (formData.check_out_date < minCheckOutDateString) {
      setError('Check-out date must be at least 2 business days from today.');
      return;
    }

    if (formData.check_in_date < formData.check_out_date) {
      setError('Check-in date cannot be earlier than check-out date.');
      return;
    }

    if (
      isWeekendDateString(formData.check_out_date) ||
      isWeekendDateString(formData.check_in_date)
    ) {
      setError('Check-out and check-in dates must fall on a weekday (Monday-Friday).');
      return;
    }

    const email = formData.requester_email.trim().toLowerCase();
    const domainsToCheck = allowedDomains.length > 0 ? allowedDomains : DEFAULT_DOMAINS;
    const isAllowed = domainsToCheck.some((domain) => email.endsWith(domain.toLowerCase()));

    if (!isAllowed) {
      setError('Invalid email domain. Please use an approved County or State email address.');
      return;
    }

    const requestableItems = inventory.filter(
      (item) => item.is_requestable === 1 || (item as any).is_requestable === true
    );

    const line_items = requestableItems
      .map((item) => {
        const pack_hint = buildPackHint(item);
        return {
          category_id: item.id,
          category_name: item.name || item.category_name || item.category || 'Unknown Item',
          quantity: getTotalQuantity(item),
          ...(pack_hint ? { pack_hint } : {}),
        };
      })
      .filter((item) => item.quantity > 0);

    if (line_items.length === 0) {
      setError('Please select at least one kit or individual item to request.');
      return;
    }

    const exceededItems = requestableItems.filter((item) => {
      const availableCount = item.available_to_promise ?? item.current_count ?? item.count ?? 0;
      return getTotalQuantity(item) > availableCount;
    });

    if (exceededItems.length > 0) {
      setError(
        `Requested quantity exceeds available inventory for: ${exceededItems
          .map((i) => i.name || 'Unknown')
          .join(', ')}`
      );
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
          line_items,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to submit request.');
        return;
      }

      setSuccess(true);
      setRefillBanner('');
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
      setBulkBoxes({});
      setSetsRequested(0);

      fetch('/api/categories')
        .then((r) => r.json())
        .then((cats) => {
          if (Array.isArray(cats)) setInventory(cats);
        })
        .catch(() => {});
    } catch (err) {
      console.error(err);
      setError('An error occurred while submitting your request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Request Submitted!</h2>
        <p className="text-slate-600 mb-2">
          Your request has been received and is awaiting OSCER staff approval.
        </p>
        <p className="text-emerald-700 font-medium mb-6">
          We will confirm pickup details within 2 business days. Mahalo for using the Reduced Waste
          Library!
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          Submit Another Request
        </button>
      </div>
    );
  }

  const sortedInventory = [...inventory].sort((a, b) => {
    const aName = a.name || '';
    const bName = b.name || '';
    const aIndex = sortOrder.indexOf(aName);
    const bIndex = sortOrder.indexOf(bName);
    const aVal = aIndex === -1 ? 999 : aIndex;
    const bVal = bIndex === -1 ? 999 : bIndex;
    return aVal !== bVal ? aVal - bVal : aName.localeCompare(bName);
  });

  const kitComponents = sortedInventory.filter((cat) => (cat.kit_yield || 0) > 0);
  const platesItem = kitComponents.find((i) => i.name?.toLowerCase().includes('plate'));
  const baseKitSize = platesItem?.kit_yield || kitComponents[0]?.kit_yield || 25;

  const kitSummaryText =
    kitComponents.length > 0
      ? kitComponents.map((c) => `${c.kit_yield} ${c.name}`).join(', ')
      : '';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Request Items</h1>
        <p className="text-slate-600 mt-2">
          Reserve reusable and compostable event supplies from the County of Hawai{'\u02BB'}i Reduced Waste
          Library.
        </p>
      </div>

      {refillBanner && (
        <div className="mb-6 p-4 bg-emerald-50 text-emerald-800 rounded-xl flex items-start gap-3 border border-emerald-200">
          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-600" />
          <p className="text-sm font-medium">{refillBanner}</p>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <h2 className="text-xl font-semibold text-slate-900 border-b border-slate-100 pb-4">
            Event Details
          </h2>

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
                placeholder="jane.doe@hawaiicounty.gov"
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
                placeholder="(808) 961-8211"
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

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Event Name</label>
              <input
                required
                type="text"
                name="event_name"
                value={formData.event_name}
                onChange={handleInputChange}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Quarterly Commission Workshop"
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
                min={minCheckOutDateString}
                max={maxDateString}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
              <p className="text-[11px] text-slate-500 italic mt-1 leading-tight">
                Requires 2 business days notice (Mon-Fri). For events &gt;60 days out, contact OSCER
                directly.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Check-in Date</label>
              <input
                required
                type="date"
                name="check_in_date"
                value={formData.check_in_date}
                onChange={handleInputChange}
                min={formData.check_out_date || minCheckOutDateString}
                max={maxDateString}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <h2 className="text-xl font-semibold text-slate-900 border-b border-slate-100 pb-4">
            Select Items
          </h2>

          {kitComponents.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5 mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-emerald-900">
                    {baseKitSize}-Person Pre-Made Event Sets
                  </h3>
                  <p className="text-sm text-emerald-700 mt-1">Each set includes: {kitSummaryText}.</p>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {kitComponents.map(
                      (c) =>
                        c.image_url && (
                          <div key={c.id} className="group relative">
                            <img
                              src={c.image_url}
                              alt={c.name}
                              className="w-10 h-10 rounded-lg border border-emerald-200 object-cover shadow-sm transition-all cursor-help"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-emerald-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
                              {c.name} (x{c.kit_yield})
                            </div>
                          </div>
                        )
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <label className="block text-xs font-bold text-emerald-800 uppercase mb-1">
                    Kit Quantity
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={setsRequested || ''}
                    onChange={(e) => setSetsRequested(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-24 px-3 py-2 rounded-lg border border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              A La Carte Top-Ups (Intervals of 10)
            </h3>

            {sortedInventory
              .filter((item) => item.is_requestable === 1 || (item as any).is_requestable === true)
              .map((item) => {
                const total = getTotalQuantity(item);
                const availableCount =
                  item.available_to_promise ?? item.current_count ?? item.count ?? 0;
                const categoryName = item.name || 'Unknown';
                const isExceeded = total > availableCount;
                const imageUrl = (item as any).photo_url || item.image_url;
                const step = getItemStep(item);
                const hasBulkOption = Boolean(item.bulk_unit_size && item.bulk_unit_size > 0);
                const bulkLabel = item.bulk_unit_label || 'Box';

                return (
                  <div
                    key={item.id}
                    className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border ${
                      isExceeded
                        ? 'border-red-200 bg-red-50'
                        : 'border-slate-100 bg-slate-50/50 hover:bg-slate-50'
                    } transition-colors gap-4`}
                  >
                    <div className="flex items-center gap-4">
                      {imageUrl ? (
                        <div className="shrink-0 hidden sm:block">
                          <img
                            src={imageUrl}
                            alt={categoryName}
                            className="w-12 h-12 object-cover rounded-lg shadow-sm border border-slate-200"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="shrink-0 hidden sm:flex w-12 h-12 rounded-lg bg-white border border-slate-200 items-center justify-center">
                          <Package className="w-5 h-5 text-slate-300" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-900">{categoryName}</h3>
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                              item.item_type === 'reusable'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {item.item_type === 'reusable' ? 'Reusable' : 'Compostable'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {availableCount > 0 ? (
                            <span className="text-emerald-600 font-medium">
                              {availableCount} available
                            </span>
                          ) : (
                            <span className="text-red-500 font-medium">Out of stock</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 justify-end">
                      <div className="text-right mr-1">
                        <div
                          className={`text-sm font-medium ${
                            isExceeded ? 'text-red-600' : 'text-slate-700'
                          }`}
                        >
                          Total Requested: {total}
                        </div>
                        {isExceeded && <div className="text-xs text-red-500">Exceeds inventory</div>}
                      </div>

                      <div className="w-px h-8 bg-slate-200 hidden md:block"></div>

                      {hasBulkOption && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">
                            {bulkLabel} ({item.bulk_unit_size} ct)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={bulkBoxes[item.id] || ''}
                            onChange={(e) => handleBulkBoxChange(item, e.target.value)}
                            disabled={availableCount < (item.bulk_unit_size || 1)}
                            className="w-20 px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-100"
                            placeholder="0"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs text-slate-500 mb-1">
                          A La Carte (+{step})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step={step}
                          value={quantities[item.id] || ''}
                          onChange={(e) =>
                            handleQuantityChange(item, e.target.value, availableCount)
                          }
                          disabled={availableCount <= 0}
                          className="w-24 px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-100"
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
              Upon completion of the event, I will wash all reusable items and return them to OSCER
              within 1 week. If any reusable equipment is damaged, lost, or stolen, I will report it
              to OSCER upon check-in.
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
            className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-70 flex items-center gap-2 cursor-pointer"
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
