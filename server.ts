import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, initDb, FieldValue, inferCategoryItemType } from './src/db.js';
import type { CategoryItemType, UserRole } from './src/types.js';

dotenv.config();

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const CONFIGURED_JWT_SECRET = process.env['JWT_SECRET'];
if (
  !CONFIGURED_JWT_SECRET ||
  CONFIGURED_JWT_SECRET === 'super-secret-key-change-me-in-production'
) {
  console.warn(
    '[SECURITY WARNING] JWT_SECRET is not set in environment secrets. Using a random ephemeral key for this instance; staff sessions will reset on container restart.'
  );
}
const JWT_SECRET: string =
  CONFIGURED_JWT_SECRET && CONFIGURED_JWT_SECRET !== 'super-secret-key-change-me-in-production'
    ? CONFIGURED_JWT_SECRET
    : crypto.randomBytes(32).toString('hex');

const BUCKET_NAME =
  process.env['GCS_BUCKET_NAME'] ||
  process.env['VITE_FIREBASE_STORAGE_BUCKET'] ||
  'oscer-procurement-receipts-staging';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
]);
const VALID_ROLES = new Set<UserRole>(['super_admin', 'admin', 'audit', 'user', 'staff']);
const RESERVATION_STATUSES = ['Awaiting', 'Approved', 'Awaiting Pick Up'];
const DEFAULT_ALLOWED_DOMAINS = [
  '@hawaiicounty.gov',
  '@hawaii.gov',
  '@hawaiipolice.gov',
  '@hawaiiprosecutors.gov',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const requestSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: 'Too many requests submitted from this network. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

interface JwtUserPayload {
  id: string;
  username: string;
  role: UserRole;
}

interface AuthenticatedRequest extends express.Request {
  user?: JwtUserPayload;
}

interface CategoryFootprint {
  stockDelta: number;
  deployedDelta: number;
  lifetimeDelta: number;
}

interface LowStockAlert {
  categoryName: string;
  newCount: number;
  threshold: number;
}

function safeCompareSecret(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== 'string' || !provided || !expected) {
    return false;
  }
  const bufA = Buffer.from(provided, 'utf8');
  const bufB = Buffer.from(expected, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseEmailList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((item) => String(item || '').split(/[,;\s]+/))
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function getMailTransporter(): nodemailer.Transporter | null {
  if (!process.env['SMTP_USER'] || !process.env['SMTP_PASS']) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env['SMTP_HOST'] || 'smtp.gmail.com',
    port: parseInt(process.env['SMTP_PORT'] || '587', 10),
    secure: process.env['SMTP_SECURE'] === 'true',
    auth: {
      user: process.env['SMTP_USER'],
      pass: process.env['SMTP_PASS'],
    },
  });
}

async function sendSystemEmail(params: {
  to: unknown;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; mode: 'webhook' | 'smtp' | 'unconfigured'; recipients: string[] }> {
  const recipients = Array.from(new Set(parseEmailList(params.to)));
  if (recipients.length === 0) {
    return { sent: false, mode: 'unconfigured', recipients: [] };
  }

  const webhookUrl = process.env['EMAIL_WEBHOOK_URL'];
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipients.join(';'),
        recipients,
        subject: params.subject,
        text: params.text,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Email webhook returned HTTP ${res.status}: ${errBody}`);
    }
    return { sent: true, mode: 'webhook', recipients };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    return { sent: false, mode: 'unconfigured', recipients };
  }

  await transporter.sendMail({
    from: process.env['SMTP_FROM'] || process.env['SMTP_USER'],
    to: recipients.join(', '),
    subject: params.subject,
    text: params.text,
  });

  return { sent: true, mode: 'smtp', recipients };
}

/**
 * Pure state-projection function: returns a single request's net cumulative
 * effect on a category's counters relative to total_procured.
 * Computing (newFootprint - oldFootprint) inside a Firestore transaction
 * guarantees exact reconciliation across status jumps, edits, deletes, and restores.
 */
function computeSingleItemFootprint(
  status: string,
  isDeleted: boolean,
  itemType: CategoryItemType,
  quantity: number
): CategoryFootprint {
  const qty = Math.max(0, Number(quantity) || 0);
  if (isDeleted || qty === 0) {
    return { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };
  }

  if (status === 'Checked-out') {
    return {
      stockDelta: -qty,
      deployedDelta: itemType === 'reusable' ? qty : 0,
      lifetimeDelta: qty,
    };
  }

  if (status === 'Checked-in') {
    return {
      // Reusables return to the shelf (net 0); consumables stay consumed (-qty).
      stockDelta: itemType === 'reusable' ? 0 : -qty,
      deployedDelta: 0,
      lifetimeDelta: qty,
    };
  }

  if (status === 'Stationed Usage') {
    // Reusables are already deducted on template stationing; log cycle reuse in lifetime metrics.
    return {
      stockDelta: 0,
      deployedDelta: 0,
      lifetimeDelta: qty,
    };
  }

  // Awaiting, Approved, Awaiting Pick Up, Denied, Test
  return { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };
}

function buildFootprintMap(
  lineItems: any[],
  status: string,
  isDeleted: boolean,
  categoryTypeById: Map<string, CategoryItemType>
): Map<string, CategoryFootprint> {
  const map = new Map<string, CategoryFootprint>();
  for (const li of lineItems || []) {
    if (!li?.category_id) continue;
    const catId = String(li.category_id);
    const itemType = categoryTypeById.get(catId) || 'consumable';
    const fp = computeSingleItemFootprint(status, isDeleted, itemType, Number(li.quantity) || 0);
    const prev = map.get(catId) || { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };
    map.set(catId, {
      stockDelta: prev.stockDelta + fp.stockDelta,
      deployedDelta: prev.deployedDelta + fp.deployedDelta,
      lifetimeDelta: prev.lifetimeDelta + fp.lifetimeDelta,
    });
  }
  return map;
}

function attachBulkPackHint(
  li: { category_id: string | number; category_name: string; quantity: number; pack_hint?: string },
  catData: any,
  isBulkMode: boolean
) {
  if (!isBulkMode || !catData) return li;
  const bulkSize = Number(catData.bulk_unit_size) || 0;
  const qty = Math.max(0, Number(li.quantity) || 0);
  if (bulkSize <= 0 || qty <= 0) return li;

  const label = catData.bulk_unit_label || 'Box';
  const fullBoxes = Math.floor(qty / bulkSize);
  const remainder = qty % bulkSize;
  const parts: string[] = [];

  if (fullBoxes > 0) {
    parts.push(`${fullBoxes}x ${label} (${fullBoxes * bulkSize})`);
  }
  if (remainder > 0) {
    parts.push(`+${remainder} loose`);
  }

  return parts.length > 0 ? { ...li, pack_hint: parts.join(' ') } : li;
}

function calculateNextRecurringRunDate(
  currentRunIso: string,
  frequency: string,
  weekdayStr?: string,
  ordinalStr?: string
): Date {
  const current = new Date(currentRunIso);
  const nextRun = new Date(current.getTime());

  if (frequency === 'weekly') {
    nextRun.setUTCDate(nextRun.getUTCDate() + 7);
    return nextRun;
  }

  if (frequency === 'quarterly') {
    const targetDay = nextRun.getUTCDate();
    nextRun.setUTCDate(1);
    nextRun.setUTCMonth(nextRun.getUTCMonth() + 3);
    const daysInMonth = new Date(
      Date.UTC(nextRun.getUTCFullYear(), nextRun.getUTCMonth() + 1, 0)
    ).getUTCDate();
    nextRun.setUTCDate(Math.min(targetDay, daysInMonth));
    return nextRun;
  }

  if (frequency === 'annually') {
    nextRun.setUTCFullYear(nextRun.getUTCFullYear() + 1);
    return nextRun;
  }

  if (frequency === 'monthly_nth_weekday') {
    // Always set day to 1 BEFORE advancing month to prevent 31st-of-month overflow
    const candidate = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1, 12, 0, 0)
    );
    const targetMonth = candidate.getUTCMonth();
    const targetWeekday = parseInt(weekdayStr || '1', 10) || 0;
    const ord = ordinalStr || 'first';

    while (candidate.getUTCDay() !== targetWeekday) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }

    if (ord === 'last') {
      while (true) {
        const probe = new Date(candidate.getTime());
        probe.setUTCDate(probe.getUTCDate() + 7);
        if (probe.getUTCMonth() === targetMonth) {
          candidate.setUTCDate(candidate.getUTCDate() + 7);
        } else {
          break;
        }
      }
    } else {
      const weeksMap: Record<string, number> = {
        first: 0,
        second: 1,
        third: 2,
        fourth: 3,
      };
      candidate.setUTCDate(candidate.getUTCDate() + (weeksMap[ord] ?? 0) * 7);
    }
    return candidate;
  }

  // monthly_exact (clamped safely to month length so Jan 31 -> Feb 28)
  const originalDay = nextRun.getUTCDate();
  nextRun.setUTCDate(1);
  nextRun.setUTCMonth(nextRun.getUTCMonth() + 1);
  const maxDayInNextMonth = new Date(
    Date.UTC(nextRun.getUTCFullYear(), nextRun.getUTCMonth() + 1, 0)
  ).getUTCDate();
  nextRun.setUTCDate(Math.min(originalDay, maxDayInNextMonth));
  return nextRun;
}

async function startServer(): Promise<void> {
  const app = express();
  const PORT = parseInt(process.env['PORT'] || '3001', 10);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  await initDb();

  const extractOptionalUser = (req: express.Request): JwtUserPayload | undefined => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || token === 'null' || token === 'undefined') return undefined;
    try {
      return jwt.verify(token, JWT_SECRET) as JwtUserPayload;
    } catch {
      return undefined;
    }
  };

  const authenticateToken = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Access denied: No token provided' });
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err || !decoded) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = decoded as JwtUserPayload;
      next();
    });
  };

  // Blocks read-only 'audit' accounts from mutating requests
  const requireOperator = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const role = req.user?.role;
    if (!role || role === 'audit') {
      return res.status(403).json({ error: 'Forbidden: Read-only audit role cannot modify records' });
    }
    next();
  };

  const requireAdmin = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
  };

  const requireSuperAdmin = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super Admin privileges required' });
    }
    next();
  };

  const requireAuditOrSuperAdmin = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const role = req.user?.role;
    if (role !== 'super_admin' && role !== 'audit') {
      return res.status(403).json({ error: 'Audit or Super Admin privileges required' });
    }
    next();
  };

  const requireApiKey = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const apiKey = req.headers['x-api-key'];
    if (!safeCompareSecret(apiKey, process.env['POWERBI_API_KEY'])) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
  };

  async function logAudit(
    user: string | undefined,
    action: string,
    details: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await db.collection('audit_logs').add({
        timestamp: new Date().toISOString(),
        username: user || 'System',
        user: user || 'System',
        action,
        details,
        metadata,
      });
    } catch (e) {
      console.error('Audit log failed:', e);
    }
  }

  async function dispatchLowStockAlerts(alerts: LowStockAlert[]): Promise<void> {
    if (alerts.length === 0) return;
    const settingsDoc = await db.collection('settings').doc('email_config').get();
    const settings = settingsDoc.data() || {};
    const recipientRaw = settings.low_inventory_email || process.env['NOTIFICATION_EMAIL'];

    for (const alert of alerts) {
      sendSystemEmail({
        to: recipientRaw,
        subject: `Low Inventory: ${alert.categoryName}`,
        text: `Warning: ${alert.categoryName} has fallen to ${alert.newCount} units. Alert threshold is ${alert.threshold}.`,
      }).catch((err) => console.error('Low stock email error:', err));
    }
  }

  /**
   * Executes an atomic Firestore transaction for any Order create/edit/delete/restore.
   * Strictly performs all reads before writes and enriches line items with catalog metadata.
   */
  async function executeOrderTransaction(params: {
    orderNumber: string;
    mode: 'create' | 'update' | 'delete' | 'restore';
    payload?: any;
  }): Promise<void> {
    const { orderNumber, mode, payload } = params;
    const orderRef = db.collection('orders').doc(orderNumber);

    await db.runTransaction(async (tx) => {
      const orderDoc = await tx.get(orderRef);

      if (mode === 'create' && orderDoc.exists && orderDoc.data()?.is_deleted !== true) {
        throw new HttpError(409, `Order ${orderNumber} already exists.`);
      }
      if (mode !== 'create' && !orderDoc.exists) {
        throw new HttpError(404, `Order ${orderNumber} not found.`);
      }

      const existingOrder = orderDoc.exists ? (orderDoc.data() as any) : null;
      const wasActive = Boolean(existingOrder && existingOrder.is_deleted !== true);
      const willBeActive = mode !== 'delete';

      const oldLineItems: any[] = wasActive ? existingOrder.line_items || [] : [];
      const rawNewLineItems: any[] =
        mode === 'create' || mode === 'update'
          ? payload?.line_items || []
          : existingOrder?.line_items || [];

      const allSkus = Array.from(
        new Set(
          [...oldLineItems, ...rawNewLineItems]
            .map((li) => String(li?.item_number || '').trim())
            .filter(Boolean)
        )
      );

      // Read all referenced inventory items
      const skuDocs = await Promise.all(
        allSkus.map((sku) => tx.get(db.collection('inventory').doc(sku)))
      );
      const skuMap = new Map<string, any>();
      skuDocs.forEach((doc, idx) => {
        if (doc.exists) {
          skuMap.set(allSkus[idx], doc.data());
        }
      });

      // Fallback query if any legacy inventory doc had an auto-generated ID != item_number
      for (const sku of allSkus) {
        if (!skuMap.has(sku)) {
          const snap = await tx.get(
            db.collection('inventory').where('item_number', '==', sku).limit(1)
          );
          if (!snap.empty) {
            skuMap.set(sku, snap.docs[0].data());
          }
        }
      }

      const categoryIds = new Set<string>();
      for (const vItem of skuMap.values()) {
        for (const comp of vItem?.kit_components || []) {
          if (comp?.category_id) categoryIds.add(String(comp.category_id));
        }
      }

      const catIdList = Array.from(categoryIds);
      const catDocs = await Promise.all(
        catIdList.map((cid) => tx.get(db.collection('categories').doc(cid)))
      );
      const catMap = new Map<string, any>();
      catDocs.forEach((doc, idx) => {
        if (doc.exists) {
          catMap.set(catIdList[idx], doc.data());
        }
      });

      const computeYields = (items: any[]): Map<string, number> => {
        const yields = new Map<string, number>();
        for (const li of items) {
          const vItem = skuMap.get(String(li.item_number || '').trim());
          if (!vItem) continue;
          const qty = Math.max(0, Number(li.quantity) || 0);
          const packSize = Number(vItem.pack_size) || 1;
          for (const comp of vItem.kit_components || []) {
            if (!comp?.category_id) continue;
            const cid = String(comp.category_id);
            const added = qty * packSize * (Number(comp.yield_multiplier) || 1);
            yields.set(cid, (yields.get(cid) || 0) + added);
          }
        }
        return yields;
      };

      const oldYields = wasActive ? computeYields(oldLineItems) : new Map<string, number>();
      const newYields = willBeActive ? computeYields(rawNewLineItems) : new Map<string, number>();

      // Enrich line items so ProcurementHistoryView displays names & categories cleanly
      const enrichedLineItems = rawNewLineItems.map((li) => {
        const sku = String(li.item_number || '').trim();
        const vItem = skuMap.get(sku);
        const mappedCategories = (vItem?.kit_components || [])
          .map((c: any) => catMap.get(String(c.category_id))?.name)
          .filter(Boolean)
          .join(', ');

        return {
          item_number: sku,
          item_name: vItem?.name || li.item_name || sku,
          vendor: vItem?.vendor || li.vendor || '',
          category_name: mappedCategories || li.category_name || '-',
          quantity: Math.max(1, Number(li.quantity) || 1),
          price: Math.max(0, Number(li.price) || 0),
        };
      });

      // Execute writes after all reads are complete
      for (const cid of catIdList) {
        if (!catMap.has(cid)) continue;
        const delta = (newYields.get(cid) || 0) - (oldYields.get(cid) || 0);
        if (delta !== 0) {
          tx.update(db.collection('categories').doc(cid), {
            current_count: FieldValue.increment(delta),
            total_procured: FieldValue.increment(delta),
          });
        }
      }

      if (mode === 'create' || mode === 'update') {
        const docData = {
          order_number: orderNumber,
          order_name: payload.order_name || '',
          date_ordered: payload.date_ordered || new Date().toISOString().split('T')[0],
          date_delivered: payload.date_delivered || '',
          subtotal: Number(payload.subtotal) || 0,
          shipping: Number(payload.shipping) || 0,
          tax: Number(payload.tax) || 0,
          total: Number(payload.total) || 0,
          procurement_method: payload.procurement_method || 'Credit Card',
          logged_by: payload.logged_by || existingOrder?.logged_by || '',
          receipt_url:
            payload.receipt_url !== undefined
              ? payload.receipt_url
              : existingOrder?.receipt_url || null,
          line_items: enrichedLineItems,
          is_deleted: false,
        };
        tx.set(orderRef, docData, { merge: true });
      } else if (mode === 'delete') {
        tx.update(orderRef, { is_deleted: true });
      } else if (mode === 'restore') {
        tx.update(orderRef, { is_deleted: false });
      }
    });
  }

  // --- RESTORE ROUTES (Super Admin Only) ---
  app.put(
    '/api/restore/requests/:id',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const lowStockAlerts: LowStockAlert[] = [];

      try {
        await db.runTransaction(async (tx) => {
          const reqRef = db.collection('requests').doc(id);
          const reqDoc = await tx.get(reqRef);
          if (!reqDoc.exists) throw new HttpError(404, 'Request not found');

          const reqData = reqDoc.data() as any;
          if (reqData.is_deleted !== true) return;

          const catIds = Array.from(
            new Set(
              (reqData.line_items || [])
                .map((li: any) => String(li.category_id || ''))
                .filter(Boolean)
            )
          ) as string[];

          const catDocs = await Promise.all(
            catIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
          );
          const catTypeMap = new Map<string, CategoryItemType>();
          const catDataMap = new Map<string, any>();

          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              catDataMap.set(catIds[idx], d);
              catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          const newFp = buildFootprintMap(
            reqData.line_items || [],
            reqData.status || 'Awaiting',
            false,
            catTypeMap
          );

          for (const [cid, fp] of newFp.entries()) {
            const catData = catDataMap.get(cid);
            if (!catData) continue;
            if (fp.stockDelta !== 0 || fp.deployedDelta !== 0 || fp.lifetimeDelta !== 0) {
              tx.update(db.collection('categories').doc(cid), {
                current_count: FieldValue.increment(fp.stockDelta),
                currently_deployed: FieldValue.increment(fp.deployedDelta),
                total_checked_out: FieldValue.increment(fp.lifetimeDelta),
              });
              const resultingStock = (catData.current_count || 0) + fp.stockDelta;
              const threshold = catData.low_stock_threshold ?? 100;
              if (fp.stockDelta < 0 && resultingStock < threshold) {
                lowStockAlerts.push({
                  categoryName: catData.name,
                  newCount: resultingStock,
                  threshold,
                });
              }
            }
          }

          tx.update(reqRef, { is_deleted: false });
        });

        await logAudit(req.user?.username, 'RESTORED_REQUEST', `Restored request ${id}`, {
          request_id: id,
        });
        await dispatchLowStockAlerts(lowStockAlerts);
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.put(
    '/api/restore/items/:item_number',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        await db.collection('inventory').doc(req.params.item_number).update({ is_deleted: false });
        await logAudit(
          req.user?.username,
          'RESTORED_ITEM',
          `Restored catalog item ${req.params.item_number}`,
          { item_number: req.params.item_number }
        );
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.put(
    '/api/restore/orders/:order_number',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { order_number } = req.params;
      try {
        await executeOrderTransaction({ orderNumber: order_number, mode: 'restore' });
        await logAudit(
          req.user?.username,
          'RESTORED_ORDER',
          `Restored order ${order_number} and re-applied BOM math`,
          { order_number }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  // --- EXPORTS & TEMPLATES ---
  app.get('/api/export/analytics', requireApiKey, async (_req, res) => {
    try {
      const [catSnap, invSnap, reqSnap, ordSnap] = await Promise.all([
        db.collection('categories').get(),
        db.collection('inventory').get(),
        db.collection('requests').get(),
        db.collection('orders').get(),
      ]);
      res.json({
        categories: catSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        inventory: invSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        requests: reqSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        orders: ordSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/export/template/inventory', authenticateToken, requireAdmin, (_req, res) => {
    const template =
      'item_number,vendor,type,name,price,pack_size,reorder_url,kit_components\nSKU-123,Amazon,Reusable,Metal Fork,12.99,50,https://amazon.com/example,[]';
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);
  });

  // --- BULK UPLOADS ---
  app.post(
    '/api/bulk-upload/inventory',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      try {
        const validItems = items.filter((i: any) => i && String(i.item_number || '').trim() !== '');
        for (let i = 0; i < validItems.length; i += 450) {
          const batch = db.batch();
          for (const item of validItems.slice(i, i + 450)) {
            const sku = String(item.item_number).trim();
            const ref = db.collection('inventory').doc(sku);
            let parsedKits: any[] = [];
            try {
              parsedKits =
                typeof item.kit_components === 'string'
                  ? JSON.parse(item.kit_components)
                  : item.kit_components || [];
            } catch {
              parsedKits = [];
            }
            batch.set(
              ref,
              {
                item_number: sku,
                vendor: item.vendor || '',
                type: item.type || 'Compostable',
                name: item.name || '',
                price: Math.max(0, parseFloat(item.price) || 0),
                pack_size: Math.max(1, parseInt(item.pack_size, 10) || 1),
                reorder_url: item.reorder_url || '',
                image_url: item.image_url || '',
                current_count: Number(item.current_count) || 0,
                total_procured: Number(item.total_procured) || 0,
                total_checked_out: Number(item.total_checked_out) || 0,
                is_deleted: false,
                kit_components: parsedKits,
              },
              { merge: true }
            );
          }
          await batch.commit();
        }
        await logAudit(
          req.user?.username,
          'BULK_UPLOAD',
          `Uploaded ${validItems.length} catalog items via CSV`,
          { count: validItems.length, target: 'inventory' }
        );
        res.json({ success: true, count: validItems.length });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.post(
    '/api/bulk-upload/orders',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      try {
        let count = 0;
        for (const item of items) {
          if (!item?.order_number) continue;
          let parsedLineItems: any[] = [];
          try {
            parsedLineItems =
              typeof item.line_items === 'string'
                ? JSON.parse(item.line_items)
                : item.line_items || [];
          } catch {
            parsedLineItems = [];
          }
          await executeOrderTransaction({
            orderNumber: String(item.order_number).trim(),
            mode: 'update',
            payload: { ...item, line_items: parsedLineItems },
          }).catch(async (err) => {
            if (err.statusCode === 404) {
              await executeOrderTransaction({
                orderNumber: String(item.order_number).trim(),
                mode: 'create',
                payload: { ...item, line_items: parsedLineItems },
              });
            } else {
              throw err;
            }
          });
          count++;
        }
        await logAudit(req.user?.username, 'BULK_UPLOAD', `Uploaded ${count} orders via CSV`, {
          count,
          target: 'orders',
        });
        res.json({ success: true, count });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.post(
    '/api/bulk-upload/requests',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
        'reuse plates': 'reusable plates',
        'compost plates': 'compostable plates',
        cups: 'reusable cups',
        forks: 'compostable forks',
        knifes: 'compostable knives',
        knives: 'compostable knives',
        spoons: 'compostable spoons',
        'water jugs': 'reusable water jugs',
        napkins: 'compostable napkins',
        chopsticks: 'compostable chopsticks',
      };

      try {
        let importedCount = 0;

        // Process in chunks of 100 to stay comfortably under Firestore's 500-doc transaction limit
        for (let offset = 0; offset < items.length; offset += 100) {
          const chunk = items.slice(offset, offset + 100);
          let chunkImported = 0;

          await db.runTransaction(async (tx) => {
            chunkImported = 0;
            const catSnap = await tx.get(db.collection('categories'));
            const catById = new Map<string, any>();
            const catIdByLowerName = new Map<string, string>();
            const catTypeMap = new Map<string, CategoryItemType>();

            catSnap.forEach((doc) => {
              const d = doc.data();
              catById.set(doc.id, d);
              const lower = String(d.name || '').trim().toLowerCase();
              if (lower) catIdByLowerName.set(lower, doc.id);
              catTypeMap.set(doc.id, inferCategoryItemType(d.name, d.item_type));
            });

            const docRefs = chunk.map((raw: any) =>
              raw?.id
                ? db.collection('requests').doc(String(raw.id).trim())
                : db.collection('requests').doc()
            );
            const existingDocs = await Promise.all(docRefs.map((ref) => tx.get(ref)));

            const netStockDelta = new Map<string, number>();
            const netDeployedDelta = new Map<string, number>();
            const netLifetimeDelta = new Map<string, number>();

            const accumulateDelta = (
              cid: string,
              stockDiff: number,
              depDiff: number,
              lifeDiff: number
            ) => {
              if (stockDiff !== 0) {
                netStockDelta.set(cid, (netStockDelta.get(cid) || 0) + stockDiff);
              }
              if (depDiff !== 0) {
                netDeployedDelta.set(cid, (netDeployedDelta.get(cid) || 0) + depDiff);
              }
              if (lifeDiff !== 0) {
                netLifetimeDelta.set(cid, (netLifetimeDelta.get(cid) || 0) + lifeDiff);
              }
            };

            chunk.forEach((raw: any, idx: number) => {
              const ref = docRefs[idx];
              const existingSnap = existingDocs[idx];
              const existingData = existingSnap.exists ? (existingSnap.data() as any) : null;

              let parsedLineItems: any[] = [];
              try {
                parsedLineItems =
                  typeof raw.line_items === 'string'
                    ? JSON.parse(raw.line_items)
                    : Array.isArray(raw.line_items)
                    ? raw.line_items
                    : [];
              } catch {
                parsedLineItems = [];
              }

              const resolvedItems = parsedLineItems
                .map((li: any) => {
                  const rawCatId = String(li?.category_id || '').trim();
                  const rawCatName = String(li?.category_name || '').trim();
                  const lowerName = rawCatName.toLowerCase();
                  const aliasedName = LEGACY_CATEGORY_ALIASES[lowerName] || lowerName;

                  const matchedId =
                    (rawCatId && catById.has(rawCatId) ? rawCatId : undefined) ||
                    catIdByLowerName.get(aliasedName);

                  if (!matchedId) return null;
                  const canonicalCat = catById.get(matchedId);
                  const qty = Math.floor(Number(li?.quantity) || 0);
                  if (qty <= 0) return null;

                  return {
                    category_id: matchedId,
                    category_name: canonicalCat?.name || rawCatName,
                    quantity: qty,
                    ...(li?.pack_hint ? { pack_hint: String(li.pack_hint) } : {}),
                  };
                })
                .filter(Boolean) as any[];

              const nextStatus = String(raw.status || 'Awaiting').trim();
              const nextDeleted = raw.is_deleted === true || raw.is_deleted === 'true';

              const oldFpMap = existingData
                ? buildFootprintMap(
                    existingData.line_items || [],
                    existingData.status || 'Awaiting',
                    Boolean(existingData.is_deleted),
                    catTypeMap
                  )
                : new Map<string, CategoryFootprint>();

              const newFpMap = buildFootprintMap(
                resolvedItems,
                nextStatus,
                nextDeleted,
                catTypeMap
              );

              const affectedCats = new Set<string>([
                ...oldFpMap.keys(),
                ...newFpMap.keys(),
              ]);

              for (const cid of affectedCats) {
                const oldFp = oldFpMap.get(cid) || {
                  stockDelta: 0,
                  deployedDelta: 0,
                  lifetimeDelta: 0,
                };
                const newFp = newFpMap.get(cid) || {
                  stockDelta: 0,
                  deployedDelta: 0,
                  lifetimeDelta: 0,
                };
                accumulateDelta(
                  cid,
                  newFp.stockDelta - oldFp.stockDelta,
                  newFp.deployedDelta - oldFp.deployedDelta,
                  newFp.lifetimeDelta - oldFp.lifetimeDelta
                );
              }

              tx.set(
                ref,
                {
                  requester_name: String(raw.requester_name || 'Unknown').trim(),
                  requester_email: String(raw.requester_email || '').trim(),
                  requester_phone: String(raw.requester_phone || '').trim(),
                  department: String(raw.department || 'Other').trim(),
                  event_name: String(raw.event_name || 'Legacy Event').trim(),
                  check_out_date: String(raw.check_out_date || '').trim(),
                  check_in_date: String(raw.check_in_date || '').trim(),
                  status: nextStatus,
                  handled_by: String(raw.handled_by || req.user?.username || 'Legacy Import').trim(),
                  created_at:
                    raw.created_at || existingData?.created_at || new Date().toISOString(),
                  ...(raw.legacy_id !== undefined && raw.legacy_id !== ''
                    ? { request_id: Number(raw.legacy_id) || raw.legacy_id }
                    : {}),
                  ...(raw.notes !== undefined
                    ? { notes: String(raw.notes).slice(0, 5000).trim() }
                    : {}),
                  is_deleted: nextDeleted,
                  line_items: resolvedItems,
                },
                { merge: true }
              );
              chunkImported++;
            });

            const allUpdatedCatIds = new Set<string>([
              ...netStockDelta.keys(),
              ...netDeployedDelta.keys(),
              ...netLifetimeDelta.keys(),
            ]);

            for (const cid of allUpdatedCatIds) {
              if (!catById.has(cid)) continue;
              const sDiff = netStockDelta.get(cid) || 0;
              const dDiff = netDeployedDelta.get(cid) || 0;
              const lDiff = netLifetimeDelta.get(cid) || 0;
              if (sDiff !== 0 || dDiff !== 0 || lDiff !== 0) {
                tx.update(db.collection('categories').doc(cid), {
                  current_count: FieldValue.increment(sDiff),
                  currently_deployed: FieldValue.increment(dDiff),
                  total_checked_out: FieldValue.increment(lDiff),
                });
              }
            }
          });

          importedCount += chunkImported;
        }

        await logAudit(
          req.user?.username,
          'BULK_UPLOAD',
          `Imported and reconciled ${importedCount} requests via CSV`,
          { count: importedCount, target: 'requests' }
        );
        res.json({ success: true, count: importedCount });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  // --- GCS FILE UPLOADS & STREAMING PROXIES ---
  app.post(
    '/api/upload-receipt',
    authenticateToken,
    requireAdmin,
    upload.single('receipt'),
    async (req: AuthenticatedRequest, res) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
      if (!ALLOWED_RECEIPT_MIME_TYPES.has(req.file.mimetype)) {
        return res.status(400).json({ error: 'Only PDF and image receipt files are allowed.' });
      }
      try {
        const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFileName = `${Date.now()}-${sanitizedName}`;
        const gcsFileName = `receipts/${storedFileName}`;
        const blob = bucket.file(gcsFileName);

        const blobStream = blob.createWriteStream({
          metadata: { contentType: req.file.mimetype },
        });

        blobStream.on('error', (err) => {
          console.error('Receipt Upload Error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Upload failed: ' + err.message });
          }
        });

        blobStream.on('finish', async () => {
          const protectedUrl = `/api/receipts/${encodeURIComponent(storedFileName)}`;
          await logAudit(req.user?.username, 'UPLOADED_RECEIPT', 'Uploaded procurement receipt', {
            filename: req.file?.originalname,
            url: protectedUrl,
          });
          res.json({ success: true, url: protectedUrl });
        });

        blobStream.end(req.file.buffer);
      } catch (error) {
        console.error('Upload handler error:', error);
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.get('/api/receipts/:filename', authenticateToken, async (req, res) => {
    const safeName = path.basename(req.params.filename);
    const gcsFile = bucket.file(`receipts/${safeName}`);
    try {
      const [exists] = await gcsFile.exists();
      if (!exists) return res.status(404).json({ error: 'Receipt not found' });

      const [metadata] = await gcsFile.getMetadata();
      res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      gcsFile
        .createReadStream()
        .on('error', (err) => {
          console.error('Receipt stream error:', err);
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    '/api/upload',
    authenticateToken,
    requireAdmin,
    upload.single('image'),
    async (req: AuthenticatedRequest, res) => {
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
      if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
        return res
          .status(400)
          .json({ error: 'Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.' });
      }
      try {
        const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFileName = `${Date.now()}-${sanitizedName}`;
        const gcsFileName = `category-images/${storedFileName}`;
        const file = bucket.file(gcsFileName);

        const stream = file.createWriteStream({
          metadata: { contentType: req.file.mimetype },
        });

        stream.on('error', (err) => {
          console.error('GCS Upload Error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Upload failed: ' + err.message });
          }
        });

        stream.on('finish', () => {
          res.json({ url: `/api/images/${encodeURIComponent(storedFileName)}` });
        });

        stream.end(req.file.buffer);
      } catch (error) {
        console.error('Upload handler error:', error);
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.get('/api/images/:filename', async (req, res) => {
    const safeName = path.basename(req.params.filename);
    const gcsFile = bucket.file(`category-images/${safeName}`);
    try {
      const [exists] = await gcsFile.exists();
      if (!exists) return res.status(404).send('Not found');

      const [metadata] = await gcsFile.getMetadata();
      res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      gcsFile
        .createReadStream()
        .on('error', () => {
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
    } catch {
      res.status(500).send('Failed to load image');
    }
  });

  // --- SETTINGS & AUDIT ---
  app.get('/api/settings', authenticateToken, requireSuperAdmin, async (_req, res) => {
    try {
      const doc = await db.collection('settings').doc('email_config').get();
      const transportMode = process.env['EMAIL_WEBHOOK_URL']
        ? 'webhook'
        : process.env['SMTP_USER'] && process.env['SMTP_PASS']
        ? 'smtp'
        : 'unconfigured';
      res.json({ ...(doc.data() || {}), transport_mode: transportMode });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.put(
    '/api/settings',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const reqEmails = parseEmailList(req.body.request_notification_email);
        const lowEmails = parseEmailList(req.body.low_inventory_email);

        if (reqEmails.length === 0 || lowEmails.length === 0) {
          return res.status(400).json({
            error: 'At least one valid email address is required for both notification lists.',
          });
        }

        const sanitized = {
          request_notification_email: reqEmails.join(', '),
          low_inventory_email: lowEmails.join(', '),
          allowed_domains: Array.isArray(req.body.allowed_domains)
            ? req.body.allowed_domains
                .map((d: unknown) => String(d).trim().toLowerCase())
                .filter((d: string) => d.startsWith('@') && d.length > 2)
            : DEFAULT_ALLOWED_DOMAINS,
        };
        await db.collection('settings').doc('email_config').set(sanitized, { merge: true });
        await logAudit(
          req.user?.username,
          'UPDATED_SETTINGS',
          'Updated email & domain config',
          sanitized
        );
        res.json({ success: true, settings: sanitized });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.post(
    '/api/settings/test-email',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const doc = await db.collection('settings').doc('email_config').get();
        const settings = doc.data() || {};
        const target =
          req.body?.to ||
          settings.request_notification_email ||
          process.env['NOTIFICATION_EMAIL'];

        const result = await sendSystemEmail({
          to: target,
          subject: 'OSCER Reduced Waste Library \u2014 Test Notification',
          text: `Aloha,\n\nThis is a live test notification triggered by ${req.user?.username} from the Reduced Waste Library Staff Dashboard.\n\nDelivery transport: ${
            process.env['EMAIL_WEBHOOK_URL'] ? 'Webhook' : 'SMTP'
          }\nTimestamp: ${new Date().toISOString()}`,
        });

        if (!result.sent) {
          return res.status(400).json({
            error:
              'Email transport is not configured on this server. Set SMTP_USER + SMTP_PASS (16-char Google App Password) or EMAIL_WEBHOOK_URL in AI Studio Secrets and republish.',
          });
        }

        await logAudit(req.user?.username, 'SENT_TEST_EMAIL', 'Sent test notification email', {
          mode: result.mode,
          recipients: result.recipients,
        });
        res.json({ success: true, mode: result.mode, recipients: result.recipients });
      } catch (error: any) {
        console.error('Test email failed:', error);
        res.status(500).json({ error: `Email delivery failed: ${error.message || String(error)}` });
      }
    }
  );

  const getAuditLogsHandler = async (_req: express.Request, res: express.Response) => {
    try {
      const snapshot = await db.collection('audit_logs').get();
      const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
      logs.sort(
        (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
      );
      res.json(logs.slice(0, 500));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  };

  app.get('/api/audit_logs', authenticateToken, requireAuditOrSuperAdmin, getAuditLogsHandler);
  app.get('/api/logs', authenticateToken, requireAuditOrSuperAdmin, getAuditLogsHandler);

  // --- USERS (Super Admin Only — prevents privilege escalation & hash exposure) ---
  app.get('/api/users', authenticateToken, requireSuperAdmin, async (_req, res) => {
    try {
      const snapshot = await db.collection('users').get();
      const safeUsers = snapshot.docs.map((doc) => {
        const { username, full_name, role } = doc.data();
        return { id: doc.id, username, full_name, role: role || 'user' };
      });
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    '/api/users',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      const username = String(req.body.username || '').trim();
      const full_name = String(req.body.full_name || '').trim();
      const password = String(req.body.password || '');
      const role: UserRole = VALID_ROLES.has(req.body.role) ? req.body.role : 'user';

      if (!username || !full_name || password.length < 8) {
        return res
          .status(400)
          .json({ error: 'Username, full name, and a password of at least 8 characters are required.' });
      }

      try {
        const existing = await db.collection('users').where('username', '==', username).limit(1).get();
        if (!existing.empty) {
          return res.status(409).json({ error: `Username "${username}" already exists.` });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').add({ username, password: hashedPassword, full_name, role });
        await logAudit(req.user?.username, 'CREATED_USER', `Created user ${username}`, { role });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.put(
    '/api/users/:id',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const username = String(req.body.username || '').trim();
      const full_name = String(req.body.full_name || '').trim();
      const password = String(req.body.password || '');
      const role: UserRole = VALID_ROLES.has(req.body.role) ? req.body.role : 'user';

      if (!username || !full_name) {
        return res.status(400).json({ error: 'Username and full name are required.' });
      }
      if (password && password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      }

      try {
        const updateData: Record<string, unknown> = { username, full_name, role };
        if (password) {
          updateData.password = await bcrypt.hash(password, 10);
        }
        await db.collection('users').doc(id).update(updateData);
        await logAudit(req.user?.username, 'UPDATED_USER', `Updated user ${username}`, {
          target_user_id: id,
          new_role: role,
        });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.delete(
    '/api/users/:id',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      if (id === req.user?.id) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }
      try {
        await db.collection('users').doc(id).delete();
        await logAudit(req.user?.username, 'DELETED_USER', 'Deleted user record', {
          target_user_id: id,
        });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.post('/api/login', loginLimiter, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    try {
      const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
      if (snapshot.empty) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const userDoc = snapshot.docs[0];
      const user = userDoc.data();
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: userDoc.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '8h' }
      );
      res.json({
        token,
        user: {
          id: userDoc.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- REQUESTS (Public + Authenticated Staff Historical Creation) ---
  app.get('/api/allowed-domains', async (_req, res) => {
    try {
      const doc = await db.collection('settings').doc('email_config').get();
      const data = doc.data();
      res.json({ allowed_domains: data?.allowed_domains || DEFAULT_ALLOWED_DOMAINS });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/requests', requestSubmitLimiter, async (req, res) => {
    const staffUser = extractOptionalUser(req);
    if (staffUser?.role === 'audit') {
      return res.status(403).json({ error: 'Forbidden: Read-only audit role cannot create requests' });
    }

    const isStaffEntry = Boolean(staffUser);
    const {
      requester_name,
      requester_email,
      requester_phone,
      department,
      event_name,
      check_out_date,
      check_in_date,
      line_items,
      status: requestedStatus,
      handled_by,
      notes,
    } = req.body;

    const cleanItems = (Array.isArray(line_items) ? line_items : [])
      .map((item: any) => ({
        category_id: String(item.category_id || ''),
        category_name: String(item.category_name || 'Unknown Item'),
        quantity: Math.floor(Number(item.quantity) || 0),
        ...(item.pack_hint ? { pack_hint: String(item.pack_hint) } : {}),
      }))
      .filter((item) => item.category_id && item.quantity > 0);

    if (!requester_name || !department || !event_name || cleanItems.length === 0) {
      return res
        .status(400)
        .json({ error: 'Requester name, department, event name, and at least one item are required.' });
    }

    if (check_out_date && check_in_date && check_in_date < check_out_date) {
      return res
        .status(400)
        .json({ error: 'Check-in date cannot be earlier than check-out date.' });
    }

    const targetStatus = isStaffEntry && requestedStatus ? String(requestedStatus) : 'Awaiting';
    const cleanNotes = isStaffEntry ? String(notes || '').slice(0, 5000).trim() : '';
    const lowStockAlerts: LowStockAlert[] = [];

    try {
      const settingsDoc = await db.collection('settings').doc('email_config').get();
      const settings = settingsDoc.data() || {};

      if (!isStaffEntry) {
        const allowedDomains: string[] = settings.allowed_domains || DEFAULT_ALLOWED_DOMAINS;
        const emailLower = String(requester_email || '').trim().toLowerCase();
        const isAllowed = allowedDomains.some((domain) =>
          emailLower.endsWith(domain.toLowerCase())
        );
        if (!isAllowed) {
          return res.status(403).json({
            error: 'Invalid email domain. Please use an approved county email address.',
          });
        }
      }

      let createdRequestId = '';

      await db.runTransaction(async (tx) => {
        const catIds = Array.from(new Set(cleanItems.map((i) => i.category_id)));
        const catDocs = await Promise.all(
          catIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
        );

        let activeReservationDocs: any[] = [];
        if (!isStaffEntry) {
          const activeSnap = await tx.get(
            db.collection('requests').where('status', 'in', RESERVATION_STATUSES)
          );
          activeReservationDocs = activeSnap.docs.map((d) => d.data());
        }

        const reservedCounts = new Map<string, number>();
        for (const r of activeReservationDocs) {
          if (r.is_deleted === true) continue;
          for (const li of r.line_items || []) {
            if (!li?.category_id) continue;
            const cid = String(li.category_id);
            reservedCounts.set(cid, (reservedCounts.get(cid) || 0) + (Number(li.quantity) || 0));
          }
        }

        const catDataMap = new Map<string, any>();
        const catTypeMap = new Map<string, CategoryItemType>();

        catDocs.forEach((doc, idx) => {
          if (!doc.exists) {
            throw new HttpError(400, `Invalid item category (${catIds[idx]}).`);
          }
          const d = doc.data()!;
          catDataMap.set(catIds[idx], d);
          catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
        });

        if (!isStaffEntry) {
          const exceeded: string[] = [];
          for (const item of cleanItems) {
            const cat = catDataMap.get(item.category_id)!;
            if (cat.is_deleted === true || cat.is_requestable !== 1) {
              exceeded.push(cat.name || item.category_name);
              continue;
            }
            const atp = Math.max(
              0,
              (cat.current_count || 0) - (reservedCounts.get(item.category_id) || 0)
            );
            if (item.quantity > atp) {
              exceeded.push(cat.name || item.category_name);
            }
          }
          if (exceeded.length > 0) {
            throw new HttpError(
              409,
              `Requested quantity exceeds available inventory for: ${exceeded.join(', ')}`
            );
          }
        }

        const fpMap = buildFootprintMap(cleanItems, targetStatus, false, catTypeMap);
        for (const [cid, fp] of fpMap.entries()) {
          const catData = catDataMap.get(cid)!;
          if (fp.stockDelta !== 0 || fp.deployedDelta !== 0 || fp.lifetimeDelta !== 0) {
            tx.update(db.collection('categories').doc(cid), {
              current_count: FieldValue.increment(fp.stockDelta),
              currently_deployed: FieldValue.increment(fp.deployedDelta),
              total_checked_out: FieldValue.increment(fp.lifetimeDelta),
            });
            const resultingStock = (catData.current_count || 0) + fp.stockDelta;
            const threshold = catData.low_stock_threshold ?? 100;
            if (fp.stockDelta < 0 && resultingStock < threshold) {
              lowStockAlerts.push({
                categoryName: catData.name,
                newCount: resultingStock,
                threshold,
              });
            }
          }
        }

        const newReqRef = db.collection('requests').doc();
        createdRequestId = newReqRef.id;
        tx.set(newReqRef, {
          requester_name: String(requester_name).trim(),
          requester_email: String(requester_email || '').trim(),
          requester_phone: String(requester_phone || '').trim(),
          department: String(department).trim(),
          event_name: String(event_name).trim(),
          check_out_date: check_out_date || '',
          check_in_date: check_in_date || '',
          status: targetStatus,
          handled_by: handled_by || staffUser?.username || '',
          notes: cleanNotes,
          is_deleted: false,
          created_at: new Date().toISOString(),
          line_items: cleanItems,
        });
      });

      await logAudit(
        staffUser?.username || requester_name,
        'CREATED_REQUEST',
        `Submitted request for ${event_name} (${targetStatus})`,
        { request_id: createdRequestId, department, is_staff_entry: isStaffEntry }
      );

      await dispatchLowStockAlerts(lowStockAlerts);

      if (!isStaffEntry) {
        const staffRecipient =
          settings.request_notification_email || process.env['NOTIFICATION_EMAIL'];
        if (staffRecipient) {
          sendSystemEmail({
            to: staffRecipient,
            subject: `New RWL Request: ${event_name}`,
            text: `A new request has been submitted.\n\nRequester: ${requester_name}\nEmail: ${requester_email}\nDepartment: ${department}\nEvent: ${event_name}\nDates: ${check_out_date} to ${check_in_date}\n\nPlease check the Staff Dashboard.`,
          }).catch((err) => console.error('Staff notification email failed:', err));
        }
        if (requester_email) {
          sendSystemEmail({
            to: requester_email,
            subject: 'OSCER Request Received',
            text: `Aloha ${requester_name},\n\nWe received your Reduced Waste Library request for "${event_name}". Our team will confirm within 2 business days.\n\nMahalo,\nThe OSCER Team`,
          }).catch((err) => console.error('Requester receipt email failed:', err));
        }
      }

      res.json({ success: true, id: createdRequestId });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || String(error) });
    }
  });

  app.put(
    '/api/requests/:id/status',
    authenticateToken,
    requireOperator,
    async (req: AuthenticatedRequest, res) => {
      const { status: newStatus, handled_by } = req.body;
      const { id } = req.params;
      if (!newStatus) return res.status(400).json({ error: 'Status is required' });

      let oldStatus = '';
      let requesterEmail = '';
      let eventName = '';
      const lowStockAlerts: LowStockAlert[] = [];

      try {
        await db.runTransaction(async (tx) => {
          const reqRef = db.collection('requests').doc(id);
          const reqDoc = await tx.get(reqRef);
          if (!reqDoc.exists) throw new HttpError(404, 'Request not found');

          const requestData = reqDoc.data() as any;
          oldStatus = requestData.status || 'Awaiting';
          requesterEmail = requestData.requester_email || '';
          eventName = requestData.event_name || '';

          const isDeleted = Boolean(requestData.is_deleted);
          const lineItems = requestData.line_items || [];
          const catIds = Array.from(
            new Set(lineItems.map((li: any) => String(li.category_id || '')).filter(Boolean))
          ) as string[];

          const catDocs = await Promise.all(
            catIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
          );
          const catDataMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();

          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              catDataMap.set(catIds[idx], d);
              catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          const oldFpMap = buildFootprintMap(lineItems, oldStatus, isDeleted, catTypeMap);
          const newFpMap = buildFootprintMap(lineItems, newStatus, isDeleted, catTypeMap);

          for (const cid of catIds) {
            const catData = catDataMap.get(cid);
            if (!catData) continue;
            const oldFp = oldFpMap.get(cid) || { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };
            const newFp = newFpMap.get(cid) || { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };

            const stockDiff = newFp.stockDelta - oldFp.stockDelta;
            const deployedDiff = newFp.deployedDelta - oldFp.deployedDelta;
            const lifetimeDiff = newFp.lifetimeDelta - oldFp.lifetimeDelta;

            if (stockDiff !== 0 || deployedDiff !== 0 || lifetimeDiff !== 0) {
              tx.update(db.collection('categories').doc(cid), {
                current_count: FieldValue.increment(stockDiff),
                currently_deployed: FieldValue.increment(deployedDiff),
                total_checked_out: FieldValue.increment(lifetimeDiff),
              });
              const resultingStock = (catData.current_count || 0) + stockDiff;
              const threshold = catData.low_stock_threshold ?? 100;
              if (stockDiff < 0 && resultingStock < threshold) {
                lowStockAlerts.push({
                  categoryName: catData.name,
                  newCount: resultingStock,
                  threshold,
                });
              }
            }
          }

          tx.update(reqRef, {
            status: newStatus,
            handled_by: handled_by || req.user?.username || '',
          });
        });

        if (oldStatus !== newStatus && newStatus === 'Approved' && requesterEmail) {
          sendSystemEmail({
            to: requesterEmail,
            subject: 'OSCER Request Approved',
            text: `Aloha,\n\nYour Reduced Waste Library request for "${eventName}" has been approved! Please coordinate pickup with the OSCER team.`,
          }).catch((e) => console.error('Approval email failed:', e));
        }

        await dispatchLowStockAlerts(lowStockAlerts);
        await logAudit(
          handled_by || req.user?.username,
          'UPDATED_REQUEST_STATUS',
          `Changed request ${id} from ${oldStatus} to ${newStatus}`,
          { request_id: id, old_status: oldStatus, new_status: newStatus }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.put(
    '/api/requests/:id',
    authenticateToken,
    requireOperator,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const {
        requester_name,
        requester_email,
        requester_phone,
        department,
        event_name,
        check_out_date,
        check_in_date,
        status,
        line_items,
        handled_by,
        notes,
      } = req.body;

      const lowStockAlerts: LowStockAlert[] = [];

      try {
        await db.runTransaction(async (tx) => {
          const reqRef = db.collection('requests').doc(id);
          const reqDoc = await tx.get(reqRef);
          if (!reqDoc.exists) throw new HttpError(404, 'Request not found');

          const existing = reqDoc.data() as any;
          const isDeleted = Boolean(existing.is_deleted);
          const oldItems = existing.line_items || [];
          const newItems = (Array.isArray(line_items) ? line_items : []).filter(
            (i: any) => Number(i?.quantity) > 0
          );
          const oldStatus = existing.status || 'Awaiting';
          const nextStatus = status || oldStatus;

          const allCatIds = Array.from(
            new Set(
              [...oldItems, ...newItems]
                .map((li: any) => String(li?.category_id || ''))
                .filter(Boolean)
            )
          ) as string[];

          const catDocs = await Promise.all(
            allCatIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
          );
          const catDataMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();

          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              catDataMap.set(allCatIds[idx], d);
              catTypeMap.set(allCatIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          const oldFpMap = buildFootprintMap(oldItems, oldStatus, isDeleted, catTypeMap);
          const newFpMap = buildFootprintMap(newItems, nextStatus, isDeleted, catTypeMap);

          for (const cid of allCatIds) {
            const catData = catDataMap.get(cid);
            if (!catData) continue;
            const oldFp = oldFpMap.get(cid) || { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };
            const newFp = newFpMap.get(cid) || { stockDelta: 0, deployedDelta: 0, lifetimeDelta: 0 };

            const stockDiff = newFp.stockDelta - oldFp.stockDelta;
            const deployedDiff = newFp.deployedDelta - oldFp.deployedDelta;
            const lifetimeDiff = newFp.lifetimeDelta - oldFp.lifetimeDelta;

            if (stockDiff !== 0 || deployedDiff !== 0 || lifetimeDiff !== 0) {
              tx.update(db.collection('categories').doc(cid), {
                current_count: FieldValue.increment(stockDiff),
                currently_deployed: FieldValue.increment(deployedDiff),
                total_checked_out: FieldValue.increment(lifetimeDiff),
              });
              const resultingStock = (catData.current_count || 0) + stockDiff;
              const threshold = catData.low_stock_threshold ?? 100;
              if (stockDiff < 0 && resultingStock < threshold) {
                lowStockAlerts.push({
                  categoryName: catData.name,
                  newCount: resultingStock,
                  threshold,
                });
              }
            }
          }

          tx.update(reqRef, {
            requester_name,
            requester_email: requester_email || '',
            requester_phone: requester_phone || '',
            department,
            event_name,
            check_out_date,
            check_in_date,
            status: nextStatus,
            line_items: newItems,
            handled_by: handled_by || existing.handled_by || req.user?.username || '',
            notes:
              notes !== undefined
                ? String(notes || '').slice(0, 5000).trim()
                : existing.notes || '',
          });
        });

        await dispatchLowStockAlerts(lowStockAlerts);
        await logAudit(
          req.user?.username,
          'EDITED_REQUEST',
          `Edited request ${id} and reconciled inventory`,
          { request_id: id }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.put(
    '/api/requests/:id/notes',
    authenticateToken,
    requireOperator,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const cleanNotes = String(req.body?.notes || '').slice(0, 5000).trim();

      try {
        const reqRef = db.collection('requests').doc(id);
        const reqDoc = await reqRef.get();
        if (!reqDoc.exists) {
          return res.status(404).json({ error: 'Request not found' });
        }

        await reqRef.update({ notes: cleanNotes });
        await logAudit(
          req.user?.username,
          'UPDATED_REQUEST_NOTES',
          `Updated staff notes on request ${id}`,
          { request_id: id, has_notes: Boolean(cleanNotes) }
        );
        res.json({ success: true, notes: cleanNotes });
      } catch (error: any) {
        res.status(500).json({ error: error.message || String(error) });
      }
    }
  );

  app.delete(
    '/api/requests/:id',
    authenticateToken,
    requireOperator,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      try {
        await db.runTransaction(async (tx) => {
          const reqRef = db.collection('requests').doc(id);
          const reqDoc = await tx.get(reqRef);
          if (!reqDoc.exists) throw new HttpError(404, 'Request not found');

          const existing = reqDoc.data() as any;
          if (existing.is_deleted === true) return;

          const lineItems = existing.line_items || [];
          const catIds = Array.from(
            new Set(lineItems.map((li: any) => String(li?.category_id || '')).filter(Boolean))
          ) as string[];

          const catDocs = await Promise.all(
            catIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
          );
          const catTypeMap = new Map<string, CategoryItemType>();
          const existingCats = new Set<string>();

          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              existingCats.add(catIds[idx]);
              catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          // Soft-deleting zeroes out the request's inventory footprint
          const oldFpMap = buildFootprintMap(
            lineItems,
            existing.status || 'Awaiting',
            false,
            catTypeMap
          );

          for (const [cid, oldFp] of oldFpMap.entries()) {
            if (!existingCats.has(cid)) continue;
            if (oldFp.stockDelta !== 0 || oldFp.deployedDelta !== 0 || oldFp.lifetimeDelta !== 0) {
              tx.update(db.collection('categories').doc(cid), {
                current_count: FieldValue.increment(-oldFp.stockDelta),
                currently_deployed: FieldValue.increment(-oldFp.deployedDelta),
                total_checked_out: FieldValue.increment(-oldFp.lifetimeDelta),
              });
            }
          }

          tx.update(reqRef, { is_deleted: true });
        });

        await logAudit(req.user?.username, 'DELETED_REQUEST', `Soft deleted request ${id}`, {
          request_id: id,
        });
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  // --- ORDERS (Admin Only, Atomic BOM Reconciliation) ---
  app.post(
    '/api/orders',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const orderNumber = String(req.body.order_number || '').trim();
      if (!orderNumber) return res.status(400).json({ error: 'Order number is required' });

      try {
        await executeOrderTransaction({
          orderNumber,
          mode: 'create',
          payload: req.body,
        });
        await logAudit(req.user?.username, 'CREATED_ORDER', `Logged procurement ${orderNumber}`, {
          order_number: orderNumber,
          item_count: req.body.line_items?.length || 0,
        });
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.put(
    '/api/orders/:order_number',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const orderNumber = String(req.params.order_number || '').trim();
      try {
        await executeOrderTransaction({
          orderNumber,
          mode: 'update',
          payload: req.body,
        });
        await logAudit(
          req.user?.username,
          'UPDATED_ORDER',
          `Edited procurement order ${orderNumber} and reconciled BOM deltas`,
          { order_number: orderNumber }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.get('/api/orders', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const [ordSnap, invSnap, catSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('inventory').get(),
        db.collection('categories').get(),
      ]);

      const skuMap = new Map<string, any>();
      invSnap.forEach((d) => {
        const data = d.data();
        skuMap.set(d.id, data);
        if (data.item_number) skuMap.set(String(data.item_number), data);
      });

      const catMap = new Map<string, string>();
      catSnap.forEach((d) => catMap.set(d.id, d.data().name || ''));

      let orders = ordSnap.docs.map((doc) => {
        const o = doc.data() as any;
        const enrichedItems = (o.line_items || []).map((li: any, idx: number) => {
          const vItem = skuMap.get(String(li.item_number || ''));
          const catNames = (vItem?.kit_components || [])
            .map((c: any) => catMap.get(String(c.category_id)))
            .filter(Boolean)
            .join(', ');
          return {
            id: li.id ?? `${doc.id}-${idx}`,
            ...li,
            item_name: li.item_name || vItem?.name || li.item_number,
            vendor: li.vendor || vItem?.vendor || '',
            category_name: li.category_name || catNames || '-',
          };
        });
        return { id: doc.id, ...o, line_items: enrichedItems };
      });

      if (req.user?.role !== 'super_admin') {
        orders = orders.filter((order) => order.is_deleted !== true);
      }
      orders.sort(
        (a, b) => new Date(b.date_ordered || 0).getTime() - new Date(a.date_ordered || 0).getTime()
      );
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete(
    '/api/orders/:order_number',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { order_number } = req.params;
      try {
        await executeOrderTransaction({ orderNumber: order_number, mode: 'delete' });
        await logAudit(
          req.user?.username,
          'DELETED_ORDER',
          `Soft deleted order ${order_number} and reversed BOM math`,
          { order_number }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  // --- INVENTORY CATALOG & CATEGORIES ---
  app.post(
    '/api/items',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const sku = String(req.body.item_number || '').trim();
      if (!sku) return res.status(400).json({ error: 'Item number (SKU) is required' });
      try {
        await db.collection('inventory').doc(sku).set({
          item_number: sku,
          vendor: req.body.vendor || '',
          type: req.body.type || 'Compostable',
          name: req.body.name || '',
          price: Math.max(0, Number(req.body.price) || 0),
          pack_size: Math.max(1, parseInt(req.body.pack_size, 10) || 1),
          reorder_url: req.body.reorder_url || '',
          image_url: req.body.image_url || '',
          kit_components: Array.isArray(req.body.kit_components) ? req.body.kit_components : [],
          is_deleted: false,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
        });
        await logAudit(req.user?.username, 'CREATED_ITEM', `Added item ${sku}`, {
          item_number: sku,
          vendor: req.body.vendor,
        });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.put(
    '/api/items/:item_number',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { item_number } = req.params;
      const { vendor, type, name, price, pack_size, kit_components, reorder_url, image_url } =
        req.body;
      try {
        const updatePayload: Record<string, unknown> = {
          vendor: vendor || '',
          type: type || 'Compostable',
          name: name || '',
          price: Math.max(0, Number(price) || 0),
          pack_size: Math.max(1, parseInt(pack_size, 10) || 1),
          reorder_url: reorder_url || '',
          kit_components: Array.isArray(kit_components) ? kit_components : [],
        };
        if (image_url !== undefined) {
          updatePayload.image_url = image_url || '';
        }
        await db.collection('inventory').doc(item_number).update(updatePayload);
        await logAudit(req.user?.username, 'EDITED_ITEM', `Edited catalog item ${item_number}`, {
          item_number,
        });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.delete(
    '/api/items/:item_number',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        await db.collection('inventory').doc(req.params.item_number).update({ is_deleted: true });
        await logAudit(
          req.user?.username,
          'DELETED_ITEM',
          `Soft deleted catalog item ${req.params.item_number}`,
          { item_number: req.params.item_number }
        );
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.get('/api/items', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      let items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
      if (req.user?.role !== 'super_admin') {
        items = items.filter((item) => item.is_deleted !== true);
      }
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/inventory/current', authenticateToken, async (_req, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      res.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  const buildCategoriesResponse = async (staffUser?: JwtUserPayload) => {
    const [requestsSnapshot, categoriesSnapshot] = await Promise.all([
      db.collection('requests').where('status', 'in', RESERVATION_STATUSES).get(),
      db.collection('categories').get(),
    ]);

    const reservedCounts: Record<string, number> = {};
    for (const doc of requestsSnapshot.docs) {
      const r = doc.data() as any;
      if (r.is_deleted === true) continue;
      for (const item of r.line_items || []) {
        if (item?.category_id) {
          const catId = String(item.category_id);
          reservedCounts[catId] = (reservedCounts[catId] || 0) + (Number(item.quantity) || 0);
        }
      }
    }

    const categories = categoriesSnapshot.docs.map((doc) => {
      const cat = doc.data() as any;
      const reserved_count = reservedCounts[doc.id] || 0;
      const available_to_promise = Math.max(0, (cat.current_count || 0) - reserved_count);
      return {
        id: doc.id,
        ...cat,
        item_type: inferCategoryItemType(cat.name, cat.item_type),
        currently_deployed: cat.currently_deployed || 0,
        image_url: cat.image_url || '',
        reserved_count,
        available_to_promise,
      };
    });

    if (!staffUser) {
      return categories.filter((cat) => cat.is_deleted !== true && cat.is_requestable === 1);
    }
    if (staffUser.role === 'super_admin') {
      return categories;
    }
    return categories.filter((cat) => cat.is_deleted !== true);
  };

  // Single unified /api/categories endpoint + explicit /api/admin/categories route:
  // Unauthenticated public requests only receive public requestable categories;
  // authenticated staff requests receive internal categories as well.
  app.get('/api/categories', async (req, res) => {
    try {
      const staffUser = extractOptionalUser(req);
      const categories = await buildCategoriesResponse(staffUser);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/admin/categories', authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const categories = await buildCategoriesResponse(req.user);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Recomputes all category counters deterministically from Orders, Requests, and Stationed Hubs
  app.post(
    '/api/admin/reconcile-inventory',
    authenticateToken,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const summary: Array<{
          name: string;
          total_procured: number;
          current_count: number;
          currently_deployed: number;
          total_checked_out: number;
        }> = [];

        await db.runTransaction(async (tx) => {
          summary.length = 0;
          const [catSnap, invSnap, ordSnap, reqSnap, tplSnap] = await Promise.all([
            tx.get(db.collection('categories')),
            tx.get(db.collection('inventory')),
            tx.get(db.collection('orders')),
            tx.get(db.collection('requests')),
            tx.get(db.collection('recurring_templates')),
          ]);

          const catMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();
          catSnap.forEach((doc) => {
            const d = doc.data();
            catMap.set(doc.id, d);
            catTypeMap.set(doc.id, inferCategoryItemType(d.name, d.item_type));
          });

          const skuMap = new Map<string, any>();
          invSnap.forEach((doc) => {
            const d = doc.data();
            skuMap.set(doc.id, d);
            if (d.item_number) skuMap.set(String(d.item_number).trim(), d);
          });

          const procuredByCat = new Map<string, number>();
          ordSnap.forEach((doc) => {
            const order = doc.data();
            if (order.is_deleted === true) return;
            for (const li of order.line_items || []) {
              const vItem = skuMap.get(String(li.item_number || '').trim());
              if (!vItem) continue;
              const qty = Math.max(0, Number(li.quantity) || 0);
              const packSize = Number(vItem.pack_size) || 1;
              for (const comp of vItem.kit_components || []) {
                if (!comp?.category_id) continue;
                const cid = String(comp.category_id);
                const added = qty * packSize * (Number(comp.yield_multiplier) || 1);
                procuredByCat.set(cid, (procuredByCat.get(cid) || 0) + added);
              }
            }
          });

          const stockDeltaByCat = new Map<string, number>();
          const deployedByCat = new Map<string, number>();
          const lifetimeByCat = new Map<string, number>();

          reqSnap.forEach((doc) => {
            const r = doc.data();
            if (r.is_deleted === true) return;
            const fpMap = buildFootprintMap(
              r.line_items || [],
              r.status || 'Awaiting',
              false,
              catTypeMap
            );
            for (const [cid, fp] of fpMap.entries()) {
              stockDeltaByCat.set(cid, (stockDeltaByCat.get(cid) || 0) + fp.stockDelta);
              deployedByCat.set(cid, (deployedByCat.get(cid) || 0) + fp.deployedDelta);
              lifetimeByCat.set(cid, (lifetimeByCat.get(cid) || 0) + fp.lifetimeDelta);
            }
          });

          tplSnap.forEach((doc) => {
            const tpl = doc.data();
            if (tpl.is_deleted === true || !tpl.is_stationed) return;
            for (const li of tpl.line_items || []) {
              const cid = String(li?.category_id || '');
              if (catTypeMap.get(cid) === 'reusable') {
                const qty = Math.max(0, Number(li?.quantity) || 0);
                stockDeltaByCat.set(cid, (stockDeltaByCat.get(cid) || 0) - qty);
                deployedByCat.set(cid, (deployedByCat.get(cid) || 0) + qty);
              }
            }
          });

          catSnap.forEach((doc) => {
            const cid = doc.id;
            const d = doc.data();
            const total_procured = procuredByCat.get(cid) || 0;
            const current_count = total_procured + (stockDeltaByCat.get(cid) || 0);
            const currently_deployed = Math.max(0, deployedByCat.get(cid) || 0);
            const total_checked_out = Math.max(0, lifetimeByCat.get(cid) || 0);

            tx.update(doc.ref, {
              total_procured,
              current_count,
              currently_deployed,
              total_checked_out,
            });

            summary.push({
              name: d.name,
              total_procured,
              current_count,
              currently_deployed,
              total_checked_out,
            });
          });
        });

        await logAudit(
          req.user?.username,
          'RECONCILED_INVENTORY',
          'Recomputed all category inventory counters from underlying ledger',
          { categories_updated: summary.length }
        );

        res.json({ success: true, summary });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.post(
    '/api/categories',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const {
        name,
        item_type,
        is_requestable,
        low_stock_threshold,
        image_url,
        kit_yield,
        bulk_unit_label,
        bulk_unit_size,
      } = req.body;

      try {
        const cleanName = String(name || '').trim();
        if (!cleanName) return res.status(400).json({ error: 'Category name is required' });

        const categoryData = {
          name: cleanName,
          item_type: inferCategoryItemType(cleanName, item_type),
          is_requestable: is_requestable === undefined ? 1 : Number(is_requestable) ? 1 : 0,
          low_stock_threshold: Math.max(0, Number(low_stock_threshold) || 0),
          image_url: image_url || '',
          kit_yield: Math.max(0, Number(kit_yield) || 0),
          bulk_unit_label: String(bulk_unit_label || '').trim(),
          bulk_unit_size: Math.max(0, parseInt(bulk_unit_size, 10) || 0),
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          currently_deployed: 0,
          is_deleted: false,
        };

        const docRef = await db.collection('categories').add(categoryData);
        await logAudit(req.user?.username, 'CREATED_CATEGORY', `Created category ${cleanName}`, {
          id: docRef.id,
          ...categoryData,
        });
        res.json({ success: true, id: docRef.id });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  app.put(
    '/api/categories/:id',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const {
        name,
        item_type,
        low_stock_threshold,
        kit_yield,
        is_requestable,
        image_url,
        bulk_unit_label,
        bulk_unit_size,
      } = req.body;

      try {
        const catRef = db.collection('categories').doc(id);
        const existingDoc = await catRef.get();
        if (!existingDoc.exists) return res.status(404).json({ error: 'Category not found' });

        const existing = existingDoc.data()!;
        const cleanName = String(name ?? existing.name ?? '').trim();

        const updateData: Record<string, unknown> = {
          name: cleanName,
          item_type: item_type
            ? inferCategoryItemType(cleanName, item_type)
            : existing.item_type || inferCategoryItemType(cleanName),
          low_stock_threshold: Math.max(0, parseInt(low_stock_threshold, 10) || 0),
          kit_yield: Math.max(0, parseInt(kit_yield, 10) || 0),
          is_requestable: parseInt(is_requestable, 10) ? 1 : 0,
          image_url: image_url ?? existing.image_url ?? '',
        };

        if (bulk_unit_label !== undefined) {
          updateData.bulk_unit_label = String(bulk_unit_label).trim();
        }
        if (bulk_unit_size !== undefined) {
          updateData.bulk_unit_size = Math.max(0, parseInt(bulk_unit_size, 10) || 0);
        }

        await catRef.update(updateData);
        await logAudit(
          req.user?.username,
          'UPDATED_CATEGORY',
          `Updated category ${cleanName || id}`,
          { category_id: id, ...updateData }
        );
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    }
  );

  // --- OPPORTUNISTIC + CRON RECURRING SPAWNER ENGINE ---
  let spawnerInFlight = false;
  let lastOpportunisticSpawnMs = 0;
  const SPAWNER_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

  async function runRecurringSpawner(force: boolean = false): Promise<number> {
    const nowMs = Date.now();
    if (!force && nowMs - lastOpportunisticSpawnMs < SPAWNER_THROTTLE_MS) {
      return 0;
    }
    if (spawnerInFlight) {
      return 0;
    }

    spawnerInFlight = true;
    lastOpportunisticSpawnMs = nowMs;
    let totalProcessed = 0;

    try {
      const targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() + 30);
      const targetDateStr = targetDate.toISOString();

      const snapshot = await db.collection('recurring_templates').get();
      const candidateIds = snapshot.docs
        .filter((doc) => {
          const d = doc.data() as any;
          return (
            d.is_deleted !== true &&
            d.frequency !== 'on_demand' &&
            Boolean(d.next_run_date) &&
            d.next_run_date <= targetDateStr
          );
        })
        .map((doc) => doc.id);

      for (const tplId of candidateIds) {
        let auditMeta: Record<string, unknown> | null = null;

        await db.runTransaction(async (tx) => {
          const tplRef = db.collection('recurring_templates').doc(tplId);
          const tplDoc = await tx.get(tplRef);
          if (!tplDoc.exists) return;

          const temp = tplDoc.data() as any;
          if (
            temp.is_deleted === true ||
            temp.frequency === 'on_demand' ||
            !temp.next_run_date ||
            temp.next_run_date > targetDateStr
          ) {
            return;
          }

          const rawItems: any[] = Array.isArray(temp.line_items) ? temp.line_items : [];
          const catIds = Array.from(
            new Set(rawItems.map((li) => String(li?.category_id || '')).filter(Boolean))
          );

          const [settingsDoc, ...catDocs] = await Promise.all([
            tx.get(db.collection('settings').doc('email_config')),
            ...catIds.map((cid) => tx.get(db.collection('categories').doc(cid))),
          ]);

          const settings = settingsDoc.data() || {};
          const catDataMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();
          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              catDataMap.set(catIds[idx], d);
              catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          const isBulkMode = Boolean(temp.is_bulk_refill);
          const formattedAllItems = rawItems.map((li) =>
            attachBulkPackHint(li, catDataMap.get(String(li.category_id)), isBulkMode)
          );

          const notifyEmail =
            parseEmailList(settings.request_notification_email)[0] || 'oscer@hawaiicounty.gov';
          const spawnedIds: string[] = [];
          const totalLifetimeIncrements = new Map<string, number>();

          let cursorIso: string = temp.next_run_date;
          let cyclesSpawned = 0;
          const MAX_CATCHUP_CYCLES = 6;

          while (cursorIso <= targetDateStr && cyclesSpawned < MAX_CATCHUP_CYCLES) {
            const runDate = new Date(cursorIso);
            const checkOutStr = runDate.toISOString().split('T')[0];
            const checkInDate = new Date(runDate.getTime() + 2 * 24 * 60 * 60 * 1000);
            const checkInStr = checkInDate.toISOString().split('T')[0];

            if (!temp.is_stationed) {
              const reqRef = db.collection('requests').doc();
              spawnedIds.push(reqRef.id);
              tx.set(reqRef, {
                requester_name: `Recurring - ${temp.department}`,
                requester_email: notifyEmail,
                requester_phone: '808-854-3129',
                department: temp.department || 'Other',
                event_name: `Recurring: ${temp.event_name}`,
                check_out_date: checkOutStr,
                check_in_date: checkInStr,
                status: 'Approved',
                is_deleted: false,
                is_recurring_instance: true,
                recurring_template_id: tplId,
                created_at: new Date().toISOString(),
                line_items: formattedAllItems,
              });
            } else {
              const reusableItems = rawItems.filter(
                (li) => catTypeMap.get(String(li.category_id)) === 'reusable'
              );
              const consumableItems = formattedAllItems.filter(
                (li) => catTypeMap.get(String(li.category_id)) !== 'reusable'
              );
              const consumableMode = temp.consumable_mode || 'per_cycle';

              if (reusableItems.length > 0) {
                const usageRef = db.collection('requests').doc();
                spawnedIds.push(usageRef.id);
                tx.set(usageRef, {
                  requester_name: `Stationed Hub - ${temp.department}`,
                  requester_email: notifyEmail,
                  requester_phone: '808-854-3129',
                  department: temp.department || 'Other',
                  event_name: `Stationed Hub Usage: ${temp.event_name}`,
                  check_out_date: checkOutStr,
                  check_in_date: checkInStr,
                  status: 'Stationed Usage',
                  is_deleted: false,
                  is_recurring_instance: true,
                  recurring_template_id: tplId,
                  created_at: new Date().toISOString(),
                  line_items: reusableItems,
                });

                for (const li of reusableItems) {
                  const cid = String(li.category_id);
                  totalLifetimeIncrements.set(
                    cid,
                    (totalLifetimeIncrements.get(cid) || 0) + (Math.max(0, Number(li.quantity)) || 0)
                  );
                }
              }

              if (consumableItems.length > 0 && consumableMode === 'per_cycle') {
                const refillRef = db.collection('requests').doc();
                spawnedIds.push(refillRef.id);
                tx.set(refillRef, {
                  requester_name: `Hub Refill - ${temp.department}`,
                  requester_email: notifyEmail,
                  requester_phone: '808-854-3129',
                  department: temp.department || 'Other',
                  event_name: `Hub Consumable Refill: ${temp.event_name}`,
                  check_out_date: checkOutStr,
                  check_in_date: checkInStr,
                  status: 'Approved',
                  is_deleted: false,
                  is_recurring_instance: true,
                  recurring_template_id: tplId,
                  created_at: new Date().toISOString(),
                  line_items: consumableItems,
                });
              }
            }

            const nextRun = calculateNextRecurringRunDate(
              cursorIso,
              temp.frequency,
              temp.weekday,
              temp.ordinal
            );
            cursorIso = nextRun.toISOString();
            cyclesSpawned++;
          }

          for (const [cid, qty] of totalLifetimeIncrements.entries()) {
            if (qty > 0 && catTypeMap.has(cid)) {
              tx.update(db.collection('categories').doc(cid), {
                total_checked_out: FieldValue.increment(qty),
              });
            }
          }

          tx.update(tplRef, {
            next_run_date: cursorIso,
          });

          totalProcessed += cyclesSpawned;
          auditMeta = {
            template_id: tplId,
            cycles_spawned: cyclesSpawned,
            spawned_request_ids: spawnedIds,
            department: temp.department,
            event_name: temp.event_name,
            next_run_date: cursorIso,
          };
        });

        if (auditMeta) {
          await logAudit(
            'System',
            'SPAWNED_RECURRING',
            `Spawned ${(auditMeta as any).cycles_spawned} cycle(s) for ${(auditMeta as any).department} (${(auditMeta as any).event_name})`,
            auditMeta
          );
        }
      }

      return totalProcessed;
    } catch (error) {
      console.error('Recurring spawner error:', error);
      return totalProcessed;
    } finally {
      spawnerInFlight = false;
    }
  }

  app.get('/api/requests', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const role = req.user?.role;
    try {
      await runRecurringSpawner(false);
      const snapshot = await db.collection('requests').get();
      let requests = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
      if (role !== 'super_admin') {
        requests = requests.filter((r) => r.is_deleted !== true);
      }
      requests.sort(
        (a, b) =>
          new Date(a.check_out_date || 0).getTime() - new Date(b.check_out_date || 0).getTime()
      );
      res.json(requests);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Public read-only endpoint for QR-code breakroom & stationed-hub pull refills
  app.get('/api/public/refill/:id', async (req, res) => {
    try {
      const tplDoc = await db.collection('recurring_templates').doc(req.params.id).get();
      if (!tplDoc.exists || tplDoc.data()?.is_deleted === true) {
        return res.status(404).json({ error: 'Refill template not found or inactive.' });
      }
      const tpl = tplDoc.data() as any;

      const catIds = Array.from(
        new Set(
          (tpl.line_items || []).map((li: any) => String(li?.category_id || '')).filter(Boolean)
        )
      ) as string[];
      const catDocs = await Promise.all(
        catIds.map((cid) => db.collection('categories').doc(cid).get())
      );
      const catTypeMap = new Map<string, CategoryItemType>();
      catDocs.forEach((doc, idx) => {
        if (doc.exists) {
          const d = doc.data()!;
          catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
        }
      });

      const refillItems = (tpl.line_items || []).filter((li: any) => {
        if (!tpl.is_stationed) return true;
        return catTypeMap.get(String(li.category_id)) !== 'reusable';
      });

      res.json({
        id: tplDoc.id,
        department: tpl.department || '',
        event_name: tpl.event_name || '',
        is_stationed: Boolean(tpl.is_stationed),
        is_bulk_refill: Boolean(tpl.is_bulk_refill),
        line_items: refillItems,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- RECURRING ORDERS (Templates & Stationed Hub Allocation) ---
  app.get('/api/recurring', authenticateToken, requireAdmin, async (_req, res) => {
    try {
      const snapshot = await db.collection('recurring_templates').get();
      const templates = snapshot.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        .filter((temp) => temp.is_deleted !== true);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post(
    '/api/recurring',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const {
        department,
        event_name,
        frequency,
        next_run_date,
        line_items,
        is_stationed,
        is_bulk_refill,
        consumable_mode,
        spawn_initial_stash,
        ordinal,
        weekday,
      } = req.body;

      const cleanItems = (Array.isArray(line_items) ? line_items : [])
        .map((li: any) => ({
          category_id: String(li.category_id || ''),
          category_name: String(li.category_name || 'Unknown'),
          quantity: Math.max(1, parseInt(li.quantity, 10) || 1),
        }))
        .filter((li) => li.category_id);

      if (!department || !event_name || cleanItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'Department, event name, and at least one line item are required.' });
      }

      const freq = frequency || 'monthly_exact';
      const stationed = Boolean(is_stationed);
      const bulkMode = Boolean(is_bulk_refill);
      const effectiveConsumableMode =
        freq === 'on_demand' ? 'on_demand' : consumable_mode || 'per_cycle';

      try {
        let newId = '';
        const templateData = {
          department: String(department).trim(),
          event_name: String(event_name).trim(),
          frequency: freq,
          next_run_date:
            freq === 'on_demand' ? null : next_run_date || new Date().toISOString(),
          line_items: cleanItems,
          is_stationed: stationed,
          is_bulk_refill: bulkMode,
          stationed_schema_v2: true,
          consumable_mode: effectiveConsumableMode,
          ordinal: ordinal || 'first',
          weekday: weekday || '1',
          is_deleted: false,
          created_at: new Date().toISOString(),
        };

        await db.runTransaction(async (tx) => {
          const catIds = Array.from(new Set(cleanItems.map((li) => li.category_id)));
          const [settingsDoc, ...catDocs] = await Promise.all([
            tx.get(db.collection('settings').doc('email_config')),
            ...catIds.map((cid) => tx.get(db.collection('categories').doc(cid))),
          ]);

          const settings = settingsDoc.data() || {};
          const catDataMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();

          catDocs.forEach((doc, idx) => {
            if (!doc.exists) throw new HttpError(400, `Category ${catIds[idx]} not found.`);
            const d = doc.data()!;
            catDataMap.set(catIds[idx], d);
            catTypeMap.set(catIds[idx], inferCategoryItemType(d.name, d.item_type));
          });

          if (stationed) {
            const stationedReusables = new Map<string, number>();
            for (const li of cleanItems) {
              if (catTypeMap.get(li.category_id) === 'reusable') {
                stationedReusables.set(
                  li.category_id,
                  (stationedReusables.get(li.category_id) || 0) + li.quantity
                );
              }
            }

            for (const [cid, qty] of stationedReusables.entries()) {
              const catData = catDataMap.get(cid)!;
              if ((catData.current_count || 0) < qty) {
                throw new HttpError(
                  409,
                  `Insufficient on-shelf stock for ${catData.name} (${catData.current_count || 0} available, tried to station ${qty}).`
                );
              }
              tx.update(db.collection('categories').doc(cid), {
                current_count: FieldValue.increment(-qty),
                currently_deployed: FieldValue.increment(qty),
              });
            }
          }

          const consumableItems = cleanItems
            .filter((li) => catTypeMap.get(li.category_id) !== 'reusable')
            .map((li) => attachBulkPackHint(li, catDataMap.get(li.category_id), bulkMode));

          if (
            (stationed || freq === 'on_demand') &&
            effectiveConsumableMode === 'on_demand' &&
            Boolean(spawn_initial_stash) &&
            consumableItems.length > 0
          ) {
            const todayStr = new Date().toISOString().split('T')[0];
            const starterRef = db.collection('requests').doc();
            tx.set(starterRef, {
              requester_name: `Initial Stash - ${templateData.department}`,
              requester_email:
                parseEmailList(settings.request_notification_email)[0] || 'oscer@hawaiicounty.gov',
              requester_phone: '808-854-3129',
              department: templateData.department,
              event_name: `Initial Consumable Stash: ${templateData.event_name}`,
              check_out_date: todayStr,
              check_in_date: todayStr,
              status: 'Approved',
              is_deleted: false,
              is_recurring_instance: true,
              created_at: new Date().toISOString(),
              line_items: consumableItems,
            });
          }

          const docRef = db.collection('recurring_templates').doc();
          newId = docRef.id;
          tx.set(docRef, templateData);
        });

        await logAudit(
          req.user?.username,
          'CREATED_RECURRING_TEMPLATE',
          `Created recurring template for ${templateData.department} (${templateData.event_name})`,
          { id: newId, ...templateData }
        );

        if (freq !== 'on_demand') {
          await runRecurringSpawner(true);
        }

        res.json({ success: true, id: newId });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.put(
    '/api/recurring/:id',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      const {
        department,
        event_name,
        frequency,
        next_run_date,
        line_items,
        is_stationed,
        is_bulk_refill,
        consumable_mode,
        ordinal,
        weekday,
      } = req.body;

      const cleanItems = (Array.isArray(line_items) ? line_items : [])
        .map((li: any) => ({
          category_id: String(li.category_id || ''),
          category_name: String(li.category_name || 'Unknown'),
          quantity: Math.max(1, parseInt(li.quantity, 10) || 1),
        }))
        .filter((li) => li.category_id);

      if (!department || !event_name || cleanItems.length === 0) {
        return res
          .status(400)
          .json({ error: 'Department, event name, and at least one line item are required.' });
      }

      try {
        await db.runTransaction(async (tx) => {
          const tplRef = db.collection('recurring_templates').doc(id);
          const tplDoc = await tx.get(tplRef);
          if (!tplDoc.exists) throw new HttpError(404, 'Recurring template not found.');

          const existing = tplDoc.data() as any;
          const isLegacyV1 =
            Boolean(existing.is_stationed && !existing.is_deleted) &&
            existing.stationed_schema_v2 !== true;

          const oldItems: any[] = existing.line_items || [];
          const allCatIds = Array.from(
            new Set(
              [...oldItems, ...cleanItems]
                .map((li) => String(li?.category_id || ''))
                .filter(Boolean)
            )
          );

          const catDocs = await Promise.all(
            allCatIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
          );
          const catDataMap = new Map<string, any>();
          const catTypeMap = new Map<string, CategoryItemType>();

          catDocs.forEach((doc, idx) => {
            if (doc.exists) {
              const d = doc.data()!;
              catDataMap.set(allCatIds[idx], d);
              catTypeMap.set(allCatIds[idx], inferCategoryItemType(d.name, d.item_type));
            }
          });

          const buildReusableMap = (items: any[], activeStationed: boolean) => {
            const map = new Map<string, number>();
            if (!activeStationed) return map;
            for (const li of items) {
              const cid = String(li.category_id);
              if (catTypeMap.get(cid) === 'reusable') {
                map.set(cid, (map.get(cid) || 0) + (Math.max(0, Number(li.quantity)) || 0));
              }
            }
            return map;
          };

          const oldReusableMap = buildReusableMap(
            oldItems,
            Boolean(existing.is_stationed && !existing.is_deleted)
          );
          const newStationed = Boolean(is_stationed);
          const newReusableMap = buildReusableMap(cleanItems, newStationed);

          for (const cid of allCatIds) {
            const catData = catDataMap.get(cid);
            if (!catData) continue;

            if (catTypeMap.get(cid) === 'reusable') {
              const delta = (newReusableMap.get(cid) || 0) - (oldReusableMap.get(cid) || 0);
              if (delta > 0 && (catData.current_count || 0) < delta) {
                throw new HttpError(
                  409,
                  `Insufficient on-shelf stock for ${catData.name} to station ${delta} additional unit(s).`
                );
              }
              if (delta !== 0) {
                tx.update(db.collection('categories').doc(cid), {
                  current_count: FieldValue.increment(-delta),
                  currently_deployed: FieldValue.increment(delta),
                });
              }
            } else if (isLegacyV1) {
              const legacyDeducted = oldItems
                .filter((li) => String(li.category_id) === cid)
                .reduce((sum, li) => sum + (Math.max(0, Number(li.quantity)) || 0), 0);
              if (legacyDeducted > 0) {
                tx.update(db.collection('categories').doc(cid), {
                  current_count: FieldValue.increment(legacyDeducted),
                });
              }
            }
          }

          const freq = frequency || existing.frequency || 'monthly_exact';
          tx.update(tplRef, {
            department: String(department).trim(),
            event_name: String(event_name).trim(),
            frequency: freq,
            next_run_date:
              freq === 'on_demand' ? null : next_run_date || existing.next_run_date,
            line_items: cleanItems,
            is_stationed: newStationed,
            is_bulk_refill: Boolean(is_bulk_refill),
            stationed_schema_v2: true,
            consumable_mode:
              freq === 'on_demand' ? 'on_demand' : consumable_mode || 'per_cycle',
            ordinal: ordinal || 'first',
            weekday: weekday || '1',
          });
        });

        await logAudit(
          req.user?.username,
          'UPDATED_RECURRING_TEMPLATE',
          `Updated recurring template ${id} (${event_name})`,
          { id }
        );
        await runRecurringSpawner(true);
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.delete(
    '/api/recurring/:id',
    authenticateToken,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      const { id } = req.params;
      try {
        await db.runTransaction(async (tx) => {
          const tplRef = db.collection('recurring_templates').doc(id);
          const tplDoc = await tx.get(tplRef);
          if (!tplDoc.exists) throw new HttpError(404, 'Recurring template not found');

          const tplData = tplDoc.data() as any;
          if (tplData.is_deleted === true) return;

          if (tplData.is_stationed) {
            const isLegacyV1 = tplData.stationed_schema_v2 !== true;
            const catIds = Array.from(
              new Set(
                (tplData.line_items || [])
                  .map((li: any) => String(li?.category_id || ''))
                  .filter(Boolean)
              )
            ) as string[];

            const catDocs = await Promise.all(
              catIds.map((cid) => tx.get(db.collection('categories').doc(cid)))
            );
            const existingCatMap = new Map<string, any>();
            catDocs.forEach((doc, idx) => {
              if (doc.exists) existingCatMap.set(catIds[idx], doc.data());
            });

            const reusableReturnMap = new Map<string, number>();
            const legacyConsumableReturnMap = new Map<string, number>();

            for (const li of tplData.line_items || []) {
              const cid = String(li?.category_id || '');
              const catData = existingCatMap.get(cid);
              if (!catData) continue;
              const qty = Math.max(0, Number(li?.quantity)) || 0;
              if (inferCategoryItemType(catData.name, catData.item_type) === 'reusable') {
                reusableReturnMap.set(cid, (reusableReturnMap.get(cid) || 0) + qty);
              } else if (isLegacyV1) {
                legacyConsumableReturnMap.set(
                  cid,
                  (legacyConsumableReturnMap.get(cid) || 0) + qty
                );
              }
            }

            for (const [cid, qty] of reusableReturnMap.entries()) {
              if (qty > 0) {
                const currentDep = Math.max(
                  0,
                  Number(existingCatMap.get(cid)?.currently_deployed) || 0
                );
                tx.update(db.collection('categories').doc(cid), {
                  current_count: FieldValue.increment(qty),
                  currently_deployed: Math.max(0, currentDep - qty),
                });
              }
            }

            for (const [cid, qty] of legacyConsumableReturnMap.entries()) {
              if (qty > 0) {
                tx.update(db.collection('categories').doc(cid), {
                  current_count: FieldValue.increment(qty),
                });
              }
            }
          }

          tx.update(tplRef, { is_deleted: true });
        });

        await logAudit(
          req.user?.username,
          'DELETED_RECURRING_TEMPLATE',
          `Archived recurring template ${id} and reclaimed stationed stock`,
          { id }
        );
        res.json({ success: true });
      } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message || String(error) });
      }
    }
  );

  app.post('/api/cron/process-recurring', async (req, res) => {
    if (!safeCompareSecret(req.headers['x-cron-secret'], process.env['CRON_SECRET'])) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const processed = await runRecurringSpawner(true);
      res.json({ success: true, processed });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
    }
  );

  if (process.env['NODE_ENV'] !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

startServer();
