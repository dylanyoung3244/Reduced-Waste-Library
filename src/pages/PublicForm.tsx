import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../types';
import { CheckCircle2, AlertCircle, Minus, Plus, Package } from 'lucide-react';

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

function isWeekendIsoDate(isoDate: string): boolean {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = localDate.getDay();
  return day === 0 || day === 6;
}

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
  const [boxQuantities, setBoxQuantities] = useState<Record<string, number>>({});
  const [setsRequested, setSetsRequested] = useState(0);
  const [allowedDomains, setAllowedDomains] = useState<string[]>(DEFAULT_DOMAINS);
  const [kitComponents, setKitComponents] = useState<InventoryItem[]>([]);

  useEffect(() => {
    fetch('/api/allowed-domains')
      .then((res) => (res.ok ? res.json() : { allowed_domains: DEFAULT_DOMAINS }))
      .then((data) => {
        if (Array.isArray(data?.allowed_domains) && data.allowed_domains.length > 0) {
          setAllowedDomains(data.allowed_domains);
        }
      })
      .catch((err) => console.error('Failed to load allowed domains:', err));

    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => {
        const cats: InventoryItem[] = Array.isArray(data) ? data : [];
        setInventory(cats);
        setKitComponents(cats.filter((cat) => (cat.kit_yield ?? 0) > 0));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load inventory categories. Please refresh the page.');
        setLoading(false);
      });
  }, []);

  const today = new Date();
  const minDateString = formatLocalDate(today);
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60);
  const maxDateString = formatLocalDate(maxDate);

  const isSingleUnitItem = (item: InventoryItem): boolean => {
    return item.name === 'Reusable Water Jugs';
  };

  const getStepSize = (item: InventoryItem): number => {
    return isSingleUnitItem(item) ? 1 : 10;
  };

  const getAvailableCount = (item: InventoryItem): number => {
    return item.available_to_promise ?? item.current_count ?? item.count ?? 0;
  };

  const getTotalQuantity = (item: InventoryItem): number => {
    const aLaCarte = quantities[item.id] || 0;
    const bulkSize = item.bulk_unit_size && item.bulk_unit_size > 0 ? item.bulk_unit_size : 0;
    const bulkUnits = (boxQuantities[item.id] || 0) * bulkSize;
    const setYield = item.kit_yield || 0;
    return aLaCarte + bulkUnits + setsRequested * setYield;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
      return;
    }

    if (name === 'check_out_date' || name === 'check_in_date') {
      if (value && isWeekendIsoDate(value)) {
        setError('Check-out and check-in dates cannot fall on a Saturday or Sunday.');
        setFormData((prev) => ({ ...prev, [name]: '' }));
        return;
      }
      if (value && value < minDateString) {
        setError('Dates cannot be in the past.');
        setFormData((prev) => ({ ...prev, [name]: '' }));
        return;
      }
      if (name === 'check_in_date' && formData.check_out_date && value < formData.check_out_date) {
        setError('Check-in date cannot be earlier than the check-out date.');
        setFormData((prev) => ({ ...prev, check_in_date: formData.check_out_date }));
        return;
      }
      if (name === 'check_out_date' && formData.check_in_date && formData.check_in_date < value) {
        setError('');
        setFormData((prev) => ({
          ...prev,
          check_out_date: value,
          check_in_date: value,
        }));
        return;
      }
      setError('');
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleRawQuantityInput = (item: InventoryItem, rawValue: string) => {
    if (rawValue === '') {
      setQuantities((prev) => ({ ...prev, [item.id]: 0 }));
      return;
    }
    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuantities((prev) => ({ ...prev, [item.id]: 0 }));
      return;
    }
    setQuantities((prev) => ({ ...prev, [item.id]: parsed }));
  };

  const normalizeQuantityOnBlur = (item: InventoryItem) => {
    const current = quantities[item.id] || 0;
    if (current <= 0) return;

    const step = getStepSize(item);
    const available = getAvailableCount(item);
    const otherAllocated =
      setsRequested * (item.kit_yield || 0) +
      (boxQuantities[item.id] || 0) * (item.bulk_unit_size || 0);
    const maxALaCarte = Math.max(0, available - otherAllocated);

    let normalized = step > 1 ? Math.round(current / step) * step : current;
    if (normalized > maxALaCarte) {
      normalized = step > 1 ? Math.floor(maxALaCarte / step) * step : maxALaCarte;
    }
    setQuantities((prev) => ({ ...prev, [item.id]: Math.max(0, normalized) }));
  };

  const adjustALaCarte = (item: InventoryItem, deltaSteps: number) => {
    const step = getStepSize(item);
    const current = quantities[item.id] || 0;
    const next = Math.max(0, current + deltaSteps * step);
    setQuantities((prev) => ({ ...prev, [item.id]: next }));
  };

  const adjustBoxQuantity = (item: InventoryItem, nextBoxes: number) => {
    setBoxQuantities((prev) => ({
      ...prev,
      [item.id]: Math.max(0, Math.floor(nextBoxes) || 0),
    }));
  };

  const buildPackHint = (item: InventoryItem): string | undefined => {
    const hints: string[] = [];
    const setQty = setsRequested * (item.kit_yield || 0);
    const boxes = boxQuantities[item.id] || 0;
    const bulkSize = item.bulk_unit_size || 0;
    const bulkLabel = item.bulk_unit_label || 'Box';
    const loose = quantities[item.id] || 0;

    if (setsRequested > 0 && setQty > 0) {
      hints.push(`${setsRequested}x Kit (${setQty})`);
    }
    if (boxes > 0 && bulkSize > 0) {
      hints.push(`${boxes}x ${bulkLabel} (${boxes * bulkSize})`);
    }
    if (loose > 0 && (hints.length > 0 || boxes > 0)) {
      hints.push(`+${loose} loose`);
    }
    return hints.length > 0 ? hints.join(', ') : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.terms_agreed) {
      setError('You must agree to the return and care terms before submitting.');
      return;
    }

    if (formData.check_out_date < minDateString) {
      setError('Check-out date cannot be in the past.');
      return;
    }

    if (formData.check_in_date < formData.check_out_date) {
      setError('Check-in date cannot be earlier than the check-out date.');
      return;
    }

    if (isWeekendIsoDate(formData.check_out_date) || isWeekendIsoDate(formData.check_in_date)) {
      setError('Check-out and check-in dates must fall on County business days (Monday–Friday).');
      return;
    }

    const email = formData.requester_email.trim().toLowerCase();
    const domainsToCheck = allowedDomains.length > 0 ? allowedDomains : DEFAULT_DOMAINS;
    const isAllowed = domainsToCheck.some((domain) => email.endsWith(domain.toLowerCase()));
    if (!isAllowed) {
      setError(
        `Invalid email domain. Please use an approved email address (${domainsToCheck.join(', ')}).`
      );
      return;
    }

    // Ensure all typed A La Carte inputs obey step intervals before submitting
    const invalidStepItem = inventory
      .filter((item) => item.is_requestable === 1)
      .find((item) => {
        const step = getStepSize(item);
        const val = quantities[item.id] || 0;
        return val > 0 && val % step !== 0;
      });

    if (invalidStepItem) {
      normalizeQuantityOnBlur(invalidStepItem);
      setError(
        `A La Carte quantities for ${invalidStepItem.name} must be in multiples of ${getStepSize(invalidStepItem)}. We adjusted the number—please review and submit again.`
      );
      return;
    }

    const requestableItems = inventory.filter((item) => item.is_requestable === 1);

    const line_items = requestableItems
      .map((item) => {
        const packHint = buildPackHint(item);
        return {
          category_id: item.id,
          category_name: item.name || item.category_name || item.category || 'Unknown Item',
          quantity: getTotalQuantity(item),
          ...(packHint ? { pack_hint: packHint } : {}),
        };
      })
      .filter((item) => item.quantity > 0);

    if (line_items.length === 0) {
      setError('Please select at least one kit or item to request.');
      return;
    }

    const exceededItems = requestableItems.filter(
      (item) => getTotalQuantity(item) > getAvailableCount(item)
    );

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
      setBoxQuantities({});
      setSetsRequested(0);

      // Refresh live ATP counts after submission
      fetch('/api/categories')
        .then((r) => r.json())
        .then((cats) => {
          if (Array.isArray(cats)) {
            setInventory(cats);
            setKitComponents(cats.filter((c: InventoryItem) => (c.kit_yield ?? 0) > 0));
          }
        })
        .catch(() => {});
    } catch (err) {
      console.error(err);
      setError('A network error occurred while submitting your request.');
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
          Your request has been received and reserved pending staff review.
        </p>
        <p className="text-emerald-700 font-medium mb-6">
          We will confirm pickup details within 2 business days. Mahalo for using the Reduced Waste
          Library!
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-emerald-700 transition-colors cursor-pointer"
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
    if (aVal !== bVal) return aVal - bVal;
    return aName.localeCompare(bName);
  });

  const platesItem = inventory.find((i) => i.name === 'Compostable Plates');
  const baseKitSize =
    platesItem && (platesItem.kit_yield ?? 0) > 0
      ? platesItem.kit_yield!
      : kitComponents[0]?.kit_yield || 25;

  const kitSummaryText =
    kitComponents.length > 0
      ? `Each set includes: ${kitComponents
          .map((c) => `${c.kit_yield} ${c.name.toLowerCase()}`)
          .join(', ')}.`
      : `Standard ${baseKitSize}-person event bundle.`;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Request Items</h1>
        <p className="text-slate-600 mt-2">
          Reserve reusable and fiber-compostable event supplies from the OSCER Reduced Waste
          Library.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
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
              <label className="text-sm font-medium text-slate-700">
                Check-out Date (Mon–Fri)
              </label>
              <input
                required
                type="date"
                name="check_out_date"
                value={formData.check_out_date}
                onChange={handleInputChange}
                min={minDateString}
                max={maxDateString}
                className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
              />
              <p className="text-[11px] text-slate-500 italic mt-1 leading-tight">
                Please allow 2 business days for preparation. For events more than 60 days out,
                contact OSCER directly.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Return / Check-in Date (Mon–Fri)
              </label>
              <input
                required
                type="date"
                name="check_in_date"
                value={formData.check_in_date}
                onChange={handleInputChange}
                min={formData.check_out_date || minDateString}
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
                  <p className="text-sm text-emerald-700 mt-1">{kitSummaryText}</p>
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
                              {c.name} ({c.kit_yield})
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
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSetsRequested((prev) => Math.max(0, prev - 1))}
                      className="p-2 rounded-lg bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                      aria-label="Decrease kits"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={setsRequested || ''}
                      onChange={(e) =>
                        setSetsRequested(Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-16 text-center px-2 py-2 rounded-lg border border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm font-medium"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => setSetsRequested((prev) => prev + 1)}
                      className="p-2 rounded-lg bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                      aria-label="Increase kits"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Individual &amp; Top-Up Items
            </h3>

            {sortedInventory
              .filter((item) => item.is_requestable === 1)
              .map((item) => {
                const total = getTotalQuantity(item);
                const availableCount = getAvailableCount(item);
                const categoryName = item.name || 'Unknown';
                const isExceeded = total > availableCount;
                const step = getStepSize(item);
                const hasBulkOption = Boolean(item.bulk_unit_size && item.bulk_unit_size > 0);
                const bulkLabel = item.bulk_unit_label || 'Box';
                const imageUrl = item.image_url;

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
                      <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={categoryName}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Package className="w-5 h-5 text-slate-300" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-slate-900">{categoryName}</h3>
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                              item.item_type === 'reusable'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {item.item_type === 'reusable' ? 'Reusable (Return)' : 'Compostable'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">
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

                    <div className="flex flex-wrap items-center justify-end gap-4">
                      <div className="text-right min-w-[110px]">
                        <div
                          className={`text-sm font-semibold ${
                            isExceeded ? 'text-red-600' : 'text-slate-700'
                          }`}
                        >
                          Total: {total}
                        </div>
                        {isExceeded && (
                          <div className="text-xs text-red-500 font-medium">Exceeds available</div>
                        )}
                      </div>

                      {hasBulkOption && (
                        <>
                          <div className="w-px h-8 bg-slate-200 hidden sm:block"></div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">
                              {bulkLabel} ({item.bulk_unit_size} ct)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={boxQuantities[item.id] || ''}
                              onChange={(e) =>
                                adjustBoxQuantity(item, parseInt(e.target.value, 10) || 0)
                              }
                              disabled={availableCount < (item.bulk_unit_size || 1)}
                              className="w-20 px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50 disabled:bg-slate-100 text-sm"
                              placeholder="0"
                            />
                          </div>
                        </>
                      )}

                      <div className="w-px h-8 bg-slate-200 hidden sm:block"></div>

                      <div>
                        <label className="block text-xs text-slate-500 mb-1">
                          A La Carte (+{step})
                        </label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={availableCount <= 0 || (quantities[item.id] || 0) <= 0}
                            onClick={() => adjustALaCarte(item, -1)}
                            className="p-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            aria-label={`Remove ${step} ${categoryName}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0"
                            step={step}
                            value={quantities[item.id] || ''}
                            onChange={(e) => handleRawQuantityInput(item, e.target.value)}
                            onBlur={() => normalizeQuantityOnBlur(item)}
                            disabled={availableCount <= 0}
                            className="w-20 text-center px-2 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all disabled:opacity-50 disabled:bg-slate-100 text-sm"
                            placeholder="0"
                          />
                          <button
                            type="button"
                            disabled={availableCount <= 0 || total + step > availableCount}
                            onClick={() => adjustALaCarte(item, 1)}
                            className="p-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                            aria-label={`Add ${step} ${categoryName}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
              to OSCER immediately.
            </span>
          </label>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3 border border-red-100">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
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
