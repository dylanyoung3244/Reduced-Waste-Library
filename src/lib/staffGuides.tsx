import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export type StaffGuideKey =
  | 'requests'
  | 'recurring'
  | 'inventory'
  | 'categories'
  | 'catalog'
  | 'procurement'
  | 'history'
  | 'users'
  | 'settings';

export interface StaffGuideEntry {
  title: string;
  buttonLabel: string;
  content: React.ReactNode;
}

export const STAFF_TAB_GUIDES: Record<StaffGuideKey, StaffGuideEntry> = {
  requests: {
    title: 'Requests Fulfillment Walkthrough (SOP-01)',
    buttonLabel: 'Workflow Guide',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Overview:</strong> Triage, pack, check out, and check in event supply requests.
          Every status transition, edit, delete, and CSV import runs inside an atomic Firestore
          transaction.
        </p>

        <div>
          <h4 className="font-semibold text-slate-900 mb-1.5">1. Request Status Lifecycle</h4>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <span className="bg-amber-100 text-amber-800 font-semibold px-1.5 py-0.5 rounded">
                Awaiting
              </span>{' '}
              Initial public state. Reserves items from Available-to-Promise (ATP) immediately.
              Verify staff coverage at 32 Kino{'\u02BB'}ole St and dishwashing turnaround within 2
              business days.
            </li>
            <li>
              <span className="bg-blue-100 text-blue-800 font-semibold px-1.5 py-0.5 rounded">
                Approved
              </span>{' '}
              Automatically emails approval confirmation to the requester while keeping ATP reserved.
            </li>
            <li>
              <span className="bg-sky-100 text-sky-800 font-semibold px-1.5 py-0.5 rounded">
                Awaiting Pick Up
              </span>{' '}
              Order is pulled, labeled with Requester Name + Pickup Date, and staged. Read the gray{' '}
              <strong>pack hint</strong> under each line item (e.g. <code>2x Kit (50)</code> or{' '}
              <code>1x Sleeve (100)</code>) so you hand out sealed sleeves/kits instead of counting
              loose items.
            </li>
            <li>
              <span className="bg-purple-100 text-purple-800 font-semibold px-1.5 py-0.5 rounded">
                Checked-out
              </span>{' '}
              Deducts physical <strong>On-Shelf</strong> stock, moves Reusables into{' '}
              <strong>Currently Out</strong>, logs <strong>Lifetime Issued</strong>, and fires
              Low-Stock warning emails if any category crosses its alert threshold.
            </li>
            <li>
              <span className="bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.5 rounded">
                Checked-in
              </span>{' '}
              Restores <strong>Reusable</strong> items back to On-Shelf stock while leaving{' '}
              <strong>Consumable</strong> items permanently deducted. (Flip consumable-only tickets
              to Checked-in after the event date to clear your active queue.)
            </li>
            <li>
              <span className="bg-red-100 text-red-800 font-semibold px-1.5 py-0.5 rounded">
                Denied
              </span>{' '}
              Releases ATP holds (or reverses deductions if previously Checked-out).
            </li>
            <li>
              <span className="bg-slate-200 text-slate-800 font-semibold px-1.5 py-0.5 rounded">
                Stationed Usage / Test
              </span>{' '}
              <code>Stationed Usage</code> auto-logs cycle reuse for off-site stationed reusable
              kits (credits Lifetime Issued only). <code>Test</code> has zero impact on inventory.
            </li>
          </ul>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900">
          <strong>Sanitation & Missing Reusables Warning:</strong> Inspect all returned totes&mdash;wash,
          sanitize, and completely air-dry any damp or spotted metal cups/plates before sealing
          totes. <strong>Important:</strong> If a requester loses reusable items (e.g., returns 38 of
          40 cups), do <em>not</em> edit the request quantity down to 38 before clicking Checked-in
          (the delta engine would refund the difference!). Check the request in normally and notify
          an Admin/Super Admin to adjust stock.
        </div>

        <p className="text-xs text-slate-500">
          <strong>Tip:</strong> Completed (<code>Checked-in</code>), <code>Denied</code>, and{' '}
          <code>Test</code> requests are unchecked in the Filter Statuses bar by default to keep the
          daily queue clean&mdash;check them anytime to search or export historical events.
        </p>
      </div>
    ),
  },

  recurring: {
    title: 'Recurring Schedules, Stationed Hubs & QR Refills (SOP-01)',
    buttonLabel: 'How Modes Work',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Automatic 30-Day Spawner:</strong> Whenever staff open the Requests tab, the
          server automatically checks active schedules (throttled to once per hour) and spawns due
          tickets up to <strong>30 days ahead</strong> (up to 6 catch-up cycles per pass).
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>1. Standard Standing Event (Unstationed):</strong> Leave{' '}
            <em>Reusables Relocated Off-Site</em> unchecked. Deducts 0 upfront and spawns one{' '}
            <code>Approved</code> ticket for all items 30 days before each meeting.
          </li>
          <li>
            <strong>2. Stationed Hub &mdash; Option A (Send Consumables Per Cycle):</strong> Check{' '}
            <em>Reusables Relocated Off-Site</em> + keep <em>Send Per Cycle</em>. Deducts{' '}
            <strong>only Reusable</strong> items upfront (moved to <em>Currently Out</em>). Each
            cycle logs a <code>Stationed Usage</code> reuse credit for the reusables and spawns a
            separate <code>Approved</code> fulfillment ticket containing <strong>only</strong> the
            consumables to pack and send.
          </li>
          <li>
            <strong>3. Stationed Hub &mdash; Option B (Bulk Stash at Hub):</strong> Check{' '}
            <em>Reusables Relocated Off-Site</em> + select <em>Bulk Stash at Hub</em>. Reusables
            still log cycle reuse automatically, while consumables are only replenished when the hub
            uses its <strong>Refill Link</strong> (optional Day-1 Approved starter box on creation).
          </li>
          <li>
            <strong>4. Breakroom Kanban (On-Demand QR Pull):</strong> Set Schedule to{' '}
            <em>On-Demand Only</em> (auto-enables <strong>Bulk Box / Sleeve Mode</strong>), click{' '}
            <strong>Refill Link</strong> to copy <code>/?refill=&lt;id&gt;</code>, and print a QR
            code for the breakroom bin. Scanning hides the 25-person party kit banner and pre-fills
            sealed sleeve/box counts while still allowing loose A La Carte overrides.
          </li>
        </ul>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
          <strong>Editing & Retiring Stationed Hubs:</strong> Clicking <strong>Edit</strong>{' '}
          reconciles stationed reusable quantity changes atomically. Clicking <strong>Delete</strong>{' '}
          archives the rule, stops future spawns, and automatically returns stationed Reusable items
          back to Hilo On-Shelf stock.
        </div>
      </div>
    ),
  },

  inventory: {
    title: 'Real-Time Inventory & Reconciliation Guide (SOP-01 / SOP-02)',
    buttonLabel: 'Inventory Guide',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Overview:</strong> Displays real-time base-unit counts across all public and
          internal categories. Every number is stored in <strong>individual units</strong> (never
          boxes).
        </p>

        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Behavior (Reusable vs. Consumable):</strong> Reusables return to On-Shelf stock
            upon Check-in; Consumables remain permanently deducted once Checked-out.
          </li>
          <li>
            <strong>Total Procured:</strong> Cumulative historical units added from active orders in{' '}
            <em>Procurement</em>.
          </li>
          <li>
            <strong>On-Shelf:</strong> Physical units currently sitting in OSCER Hilo storage
            (excludes checked-out reusables and stationed hub allocations).
          </li>
          <li>
            <strong>Reserved:</strong> Sum of units held by <code>Awaiting</code>,{' '}
            <code>Approved</code>, and <code>Awaiting Pick Up</code> tickets.
          </li>
          <li>
            <strong>Available (ATP):</strong> <code>max(0, On-Shelf - Reserved)</code> &mdash; the
            exact cap enforced on the Public Request Form.
          </li>
          <li>
            <strong>Currently Out:</strong> Reusable items currently off-site on a{' '}
            <code>Checked-out</code> event or relocated to a Stationed Hub. (Consumables never stay
            here.)
          </li>
          <li>
            <strong>Lifetime Issued:</strong> Cumulative units fulfilled across Checked-out,
            Checked-in, and recurring <code>Stationed Usage</code> cycles for OSCER reporting.
          </li>
        </ul>

        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
          <strong>Super Admin &mdash; Reconcile Counters:</strong> Recomputes every category counter
          from scratch across all active Orders, Requests, and Stationed Hubs inside a single
          transaction. Run anytime after bulk migrations or if a counter ever appears out of sync.
        </div>
      </div>
    ),
  },

  categories: {
    title: 'Categories, Pre-Made Kits & Sleeve Specs (SOP-02)',
    buttonLabel: 'How to use this page',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Tier 1 &mdash; Requestable Categories:</strong> Categories represent abstract items
          County staff borrow (decoupled from specific Amazon/Walmart vendor SKUs).
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Return Behavior (Critical):</strong> Explicitly select <em>Reusable</em> (restores
            to On-Shelf at Check-in; deducts upfront on Stationed Hubs) vs. <em>Consumable</em>{' '}
            (permanently deducted at Check-out). Never rely on the category title alone.
          </li>
          <li>
            <strong>Qty per Pre-Made Kit:</strong> Defines the recipe for the 25-Person Event Set
            banner on the public form (standard: 25 Compostable Plates, 25 Reusable Cups, 25 Forks,
            25 Knives, 25 Spoons, 50 Napkins; <code>0</code> excludes Chopsticks & Water Jugs).
          </li>
          <li>
            <strong>Low-Stock Alert:</strong> Sends an automated warning email to Low-Stock
            Recipients whenever a Check-out pushes On-Shelf stock below this unit count.
          </li>
          <li>
            <strong>Optional Request by Box / Sleeve:</strong> Use sealed inner sleeve sizes (e.g.,{' '}
            <code>Sleeve</code> of <code>100</code> or <code>125</code> for plates/utensils,{' '}
            <code>250</code> for napkins, <code>200</code> for chopsticks; <code>0</code> disables)
            so regular event organizers can request sealed packs without ordering 1,000-unit master
            cases.
          </li>
          <li>
            <strong>Visibility:</strong> <em>Internal Only</em> hides a category from the public
            form while keeping it visible across staff Inventory, Recurring Rules, and Procurement.
          </li>
        </ul>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900">
          <strong>Updating Sleeve / Box Sizes:</strong> Saving a new Sleeve/Box size updates the
          Public Form immediately with zero code deploy. Remember to also click <strong>Edit</strong>{' '}
          on any existing Bulk Recurring Templates if you want their saved base-unit quantities
          updated to match.
        </div>
      </div>
    ),
  },

  catalog: {
    title: 'Vendor Catalog, BOM Mapping & Material Standards (SOP-02)',
    buttonLabel: 'Guide',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Tier 2 &mdash; Vendor Independence:</strong> Catalog SKUs represent real commercial
          cases purchased from vendors. Mapping a SKU's <strong>Kit Components (BOM)</strong>{' '}
          converts purchased cases into base category units:
        </p>

        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl font-mono text-xs text-emerald-950">
          Units Added = (Cases Ordered) &times; (SKU Pack Size) &times; (BOM Yield Multiplier)
        </div>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Single-Category Case:</strong> A 500-ct case of plates or 1,000-ct case of forks
            uses <code>Pack Size = 500</code> (or <code>1000</code>) and{' '}
            <code>Yield Multiplier = 1</code>. <strong>Warning:</strong> Never set both Pack Size =
            1000 and Yield Multiplier = 1000, or 1 case will add 1,000,000 units!
          </li>
          <li>
            <strong>Multi-Item Combo Case:</strong> A combo box containing 140 forks, 120 knives,
            and 120 spoons uses <code>Pack Size = 1</code> and three BOM component rows (140, 120,
            120).
          </li>
          <li>
            <strong>Never Overwrite Historical Pack Sizes:</strong> If a vendor changes case sizes
            (e.g., from 125-ct to 500-ct plates), click <strong>Delete</strong> (archive) on the
            retired SKU and create a new SKU. Changing Pack Size on an old SKU would alter historical
            order math during counter reconciliation.
          </li>
          <li>
            <strong>Hawai{'\u02BB'}i Island Compostable Standard:</strong> Strictly procure
            fiber-based items (bagasse/sugarcane or uncoated paper plates, bamboo/wood cutlery &
            chopsticks, paper/bamboo napkins). Avoid PLA &ldquo;corn plastic&rdquo; cups and
            cutlery, which contaminate local green-waste/mulch streams.
          </li>
        </ul>
      </div>
    ),
  },

  procurement: {
    title: 'Logging Incoming Restock Orders (SOP-02)',
    buttonLabel: 'How to use this page',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Overview:</strong> Log vendor restocks to atomically increment Category{' '}
          <strong>On-Shelf</strong> and <strong>Total Procured</strong> inventory via BOM math.
        </p>

        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Order Header:</strong> Enter the unique Order / PO / Invoice Number, dates, and
            Procurement Method (Credit Card / P-Card, Purchase Order, or Invoice).
          </li>
          <li>
            <strong>Private Receipt Upload:</strong> Attach the PDF or image invoice/packing slip
            (max 10 MB). Receipts are stored privately and streamed exclusively to authenticated
            staff via <code>/api/receipts/</code>&mdash;never publicly accessible on the web.
          </li>
          <li>
            <strong>Enter Case / Pack Counts (Not Individual Units):</strong> In the{' '}
            <em>Packs</em> column, enter the number of <strong>cases/boxes</strong> purchased (e.g.,
            enter <code>2</code> for two 1,000-ct cases of forks&mdash;do <em>not</em> enter{' '}
            <code>2000</code>).
          </li>
          <li>
            <strong>Fixing Mistakes:</strong> Never log negative or duplicate adjustment orders. To
            correct a typo on an existing order, open <em>Procurement History</em> and click{' '}
            <strong>Edit</strong>&mdash;the system will automatically reconcile the exact BOM stock
            difference.
          </li>
        </ol>
      </div>
    ),
  },

  history: {
    title: 'Procurement History, Receipts & BOM Reconciliation (SOP-02)',
    buttonLabel: 'History Guide',
    content: (
      <div className="space-y-4 text-sm">
        <p>
          <strong>Overview:</strong> Audit past vendor purchases, inspect itemized case breakdowns,
          retrieve P-Card receipts, and edit or archive orders with automatic inventory
          reconciliation.
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Expand Line Items:</strong> Click anywhere on an order row to expand its
            catalog SKUs, mapped categories, pack counts, unit prices, shipping, and tax.
          </li>
          <li>
            <strong>Authenticated Receipt Streaming:</strong> Clicking <strong>Receipt</strong>{' '}
            fetches the private PDF/image from Cloud Storage using your staff login token and opens
            it in a temporary secure browser tab.
          </li>
          <li>
            <strong>Editing Orders:</strong> Clicking <strong>Edit</strong> opens the order in the{' '}
            <em>Procurement</em> tab. Saving changes computes <code>(New BOM Yield - Old BOM Yield)</code>{' '}
            inside a Firestore transaction and updates Category stock cleanly.
          </li>
          <li>
            <strong>Deleting & Restoring:</strong> Clicking <strong>Delete</strong> soft-archives
            the order and reverses its inventory additions. Super Admins can check{' '}
            <em>Toggle Recycle Bin View</em> in the top header to <strong>Restore</strong> archived
            orders.
          </li>
        </ul>
      </div>
    ),
  },

  users: {
    title: 'Staff Role Matrix & Account Security (SOP-01 / SOP-02)',
    buttonLabel: 'Roles Guide',
    content: (
      <div className="space-y-4 text-sm">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>User (Fulfillment Operator):</strong> Access to <em>Requests</em> and{' '}
            <em>Inventory Overview</em> for daily request triage, packing, check-out, and check-in.
          </li>
          <li>
            <strong>Audit (Strictly Read-Only):</strong> Read-only access to <em>Requests</em>,{' '}
            <em>Inventory Overview</em>, <em>Procurement History</em> (including viewing P-Card
            receipts), and <em>Audit Logs</em>, plus CSV exports. Blocked from modifying any record.
          </li>
          <li>
            <strong>Admin (Program Coordinator):</strong> Full operational access to{' '}
            <em>Requests</em>, <em>Recurring Requests</em> (Stationed Hubs & QR Refills),{' '}
            <em>Categories & Kits</em>, <em>Catalog Editor</em>, <em>Procurement</em>, and CSV
            request imports.
          </li>
          <li>
            <strong>Super Admin (System Steward):</strong> All Admin permissions plus{' '}
            <em>User Management</em>, <em>Reconcile Counters</em>, <em>Toggle Recycle Bin View</em>{' '}
            (restore deleted records), and <em>Settings & Logs</em>.
          </li>
        </ul>

        <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-800">
          <strong>Password & Hash Security:</strong> New passwords require at least{' '}
          <strong>8 characters</strong> (leave blank when editing an existing user to keep their
          current password). Bcrypt password hashes are stripped server-side and never appear in API
          responses or CSV exports.
        </div>
      </div>
    ),
  },

  settings: {
    title: 'Notifications, Domain Whitelist, Audit Logs & Power BI (SOP-02)',
    buttonLabel: 'Guide',
    content: (
      <div className="space-y-4 text-sm">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Multi-Recipient Email Lists:</strong> Type or paste one or more email addresses
            (comma/semicolon separated) into <em>New Request Recipients</em> or{' '}
            <em>Low-Stock Alert Recipients</em>, click <strong>+</strong> (or press Enter), then
            click <strong>Save All Settings</strong>. Use <strong>Send Test Email</strong> to verify
            live delivery.
          </li>
          <li>
            <strong>Server Email Transport (AI Studio Secrets):</strong> Set either{' '}
            <code>SMTP_USER</code> + <code>SMTP_PASS</code> (must be a 16-character Google App
            Password on the shared OSCER Google account) <em>or</em>{' '}
            <code>EMAIL_WEBHOOK_URL</code> inside AI Studio Secrets, then republish the app.
          </li>
          <li>
            <strong>Allowed Email Domains:</strong> Controls which government email suffixes (e.g.{' '}
            <code>@hawaiicounty.gov</code>, <code>@hawaii.gov</code>) are accepted on the Public
            Request Form. Remember to click <strong>Save All Settings</strong> after adding/removing
            domains.
          </li>
          <li>
            <strong>Power BI M2M Analytics:</strong> In Power BI Desktop, choose{' '}
            <em>Get Data &rarr; Web &rarr; Advanced</em>, enter the{' '}
            <code>/api/export/analytics</code> URL shown at the bottom of this tab, and pass HTTP
            header <code>x-api-key</code> set to your <code>POWERBI_API_KEY</code> secret.
          </li>
        </ul>
      </div>
    ),
  },
};

const LEGACY_TITLE_TO_KEY: Record<string, StaffGuideKey> = {
  'Requests Workflow Walkthrough': 'requests',
  'Procurement (Orders) Walkthrough': 'procurement',
  'Catalog & BOM Mapping Guide': 'catalog',
  'Categories & Kits Walkthrough': 'categories',
  'Staff Role Matrix': 'users',
  'Email Setup & Audit Trail Guide': 'settings',
  'Audit Trail & Settings': 'settings',
  'Stationed Hubs, Bulk Boxes & Breakroom Refill Modes': 'recurring',
  'Stationed Hubs & Breakroom Refill Modes': 'recurring',
  'Recurring Requests Walkthrough': 'recurring',
};

export function resolveStaffGuide(
  tabOrTitle?: string
): { title: string; content: React.ReactNode } | null {
  if (!tabOrTitle) return null;
  if (tabOrTitle in STAFF_TAB_GUIDES) {
    const entry = STAFF_TAB_GUIDES[tabOrTitle as StaffGuideKey];
    return { title: entry.title, content: entry.content };
  }
  const mappedKey = LEGACY_TITLE_TO_KEY[tabOrTitle];
  if (mappedKey) {
    const entry = STAFF_TAB_GUIDES[mappedKey];
    return { title: entry.title, content: entry.content };
  }
  return null;
}

export function StaffGuideModal({
  isOpen,
  onClose,
  title,
  tab,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  tab?: StaffGuideKey;
  children?: React.ReactNode;
}) {
  if (!isOpen) return null;
  const resolved = resolveStaffGuide(tab || title);
  const displayTitle = resolved ? resolved.title : title || 'Guide';
  const displayBody = resolved ? resolved.content : children;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <h2 className="text-2xl font-bold text-slate-900">{displayTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl font-bold leading-none"
          >
            &times;
          </button>
        </div>
        <div className="p-6 overflow-y-auto text-slate-700 space-y-4 text-left">{displayBody}</div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

export function StaffGuideButton({ tab }: { tab: StaffGuideKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const entry = STAFF_TAB_GUIDES[tab];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
      >
        <HelpCircle className="w-4 h-4" /> {entry.buttonLabel}
      </button>
      <StaffGuideModal isOpen={isOpen} onClose={() => setIsOpen(false)} tab={tab} />
    </>
  );
}
