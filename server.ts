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
import { db, initDb, FieldValue } from './src/db.js';

import crypto from 'crypto';

dotenv.config();

const JWT_SECRET = process.env['JWT_SECRET'] || 'super-secret-key-change-me-in-production';
const BUCKET_NAME = process.env['VITE_FIREBASE_STORAGE_BUCKET'] || 'rwlib-staging.firebasestorage.app';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Configure Rate Limiter for Public Requests (50 requests per IP per hour to account for shared building WANs)
const requestSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 50, 
  message: { error: 'Too many requests submitted from this network. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3001');

  // Trust the Google Cloud Run Proxy so the rate limiter reads the correct client IP
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50mb' }));
  initDb();

  const authenticateToken = (req: any, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied: No token provided' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Invalid or expired token' });
      req.user = user;
      next();
    });
  };

  const requireSuperAdmin = (req: any, res: express.Response, next: express.NextFunction) => {
    if (req.user?.role !== 'super_admin') return res.status(403).json({ error: 'Super Admin required' });
    next();
  };
  
  const requireAdmin = (req: any, res: express.Response, next: express.NextFunction) => {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'super_admin') return res.status(403).json({ error: 'Admin required' });
    next();
  };

  const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env['POWERBI_API_KEY']) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
  };

  async function logAudit(user: string, action: string, details: string, metadata: any = {}) {
    try {
      await db.collection('audit_logs').add({ 
        timestamp: new Date().toISOString(), user: user || 'System', action, details, metadata 
      });
    } catch (e) { console.error("Audit log failed", e); }
  }

  // --- RESTORE ROUTES (Super Admin Only) ---
  app.put('/api/restore/requests/:id', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
      await db.collection('requests').doc(req.params.id).update({ is_deleted: false });
      await logAudit(req.user?.username, 'RESTORED_REQUEST', `Restored request ${req.params.id}`, { request_id: req.params.id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/restore/items/:item_number', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
      await db.collection('inventory').doc(req.params.item_number).update({ is_deleted: false });
      await logAudit(req.user?.username, 'RESTORED_ITEM', `Restored catalog item ${req.params.item_number}`, { item_number: req.params.item_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/restore/orders/:order_number', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    const { order_number } = req.params;
    try {
      const orderRef = db.collection('orders').doc(order_number);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) return res.status(404).json({ error: 'Not found' });
      const orderData = orderDoc.data() as any;

      for (const line_item of orderData.line_items || []) {
        const invSnap = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
        if (!invSnap.empty) {
          const vItem = invSnap.docs[0].data();
          for (const comp of vItem.kit_components || []) {
            const added = line_item.quantity * (vItem.pack_size || 1) * (comp.yield_multiplier || 1);
            await db.collection('categories').doc(String(comp.category_id)).update({ 
              current_count: FieldValue.increment(added), 
              total_procured: FieldValue.increment(added) 
            });
          }
        }
      }
      await orderRef.update({ is_deleted: false });
      await logAudit(req.user?.username, 'RESTORED_ORDER', `Restored order ${order_number} and re-applied math`, { order_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- EXPORTS & TEMPLATES ---
  app.get('/api/export/analytics', requireApiKey, async (req, res) => {
    try {
      const [invSnap, reqSnap, ordSnap] = await Promise.all([
        db.collection('inventory').get(),
        db.collection('requests').get(),
        db.collection('orders').get()
      ]);
      res.json({
        inventory: invSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        requests: reqSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        orders: ordSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        timestamp: new Date().toISOString()
      });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/export/template/inventory', authenticateToken, requireAdmin, (req, res) => {
    const template = "item_number,vendor,type,name,price,pack_size,reorder_url,kit_components\nSKU-123,Amazon,Reusable,Metal Fork,12.99,50,https://amazon.com/example,[]";
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);
  });

  // --- BULK UPLOADS ---
  app.post('/api/bulk-upload/inventory', authenticateToken, requireAdmin, async (req: any, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });

    const batch = db.batch();
    try {
      items.forEach((item: any) => {
        if (!item.item_number) return;
        const ref = db.collection('inventory').doc(item.item_number);
        let parsedKits = [];
        try { parsedKits = typeof item.kit_components === 'string' ? JSON.parse(item.kit_components) : (item.kit_components || []); } catch(e){}
        batch.set(ref, {
          item_number: item.item_number, vendor: item.vendor || '', type: item.type || '', name: item.name || '',
          price: parseFloat(item.price) || 0, pack_size: parseInt(item.pack_size) || 1, reorder_url: item.reorder_url || '',
          current_count: item.current_count || 0, total_procured: item.total_procured || 0, total_checked_out: item.total_checked_out || 0, 
          is_deleted: false, kit_components: parsedKits
        }, { merge: true });
      });
      await batch.commit();
      await logAudit(req.user?.username, 'BULK_UPLOAD', `Uploaded ${items.length} catalog items via CSV`, { count: items.length, target: 'inventory' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/bulk-upload/orders', authenticateToken, requireAdmin, async (req: any, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });

    const batch = db.batch();
    try {
      items.forEach((item: any) => {
        if (!item.order_number) return;
        const ref = db.collection('orders').doc(item.order_number);
        let parsedLineItems = [];
        try { parsedLineItems = typeof item.line_items === 'string' ? JSON.parse(item.line_items) : (item.line_items || []); } catch(e){}
        batch.set(ref, { ...item, line_items: parsedLineItems, is_deleted: false }, { merge: true });
      });
      await batch.commit();
      await logAudit(req.user?.username, 'BULK_UPLOAD', `Uploaded ${items.length} orders via CSV`, { count: items.length, target: 'orders' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/bulk-upload/requests', authenticateToken, requireAdmin, async (req: any, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });

    const batch = db.batch();
    try {
      items.forEach((item: any) => {
        const ref = item.id ? db.collection('requests').doc(item.id) : db.collection('requests').doc();
        let parsedLineItems = [];
        try { parsedLineItems = typeof item.line_items === 'string' ? JSON.parse(item.line_items) : (item.line_items || []); } catch(e){}
        batch.set(ref, { ...item, line_items: parsedLineItems, is_deleted: false, status: item.status || 'Awaiting' }, { merge: true });
      });
      await batch.commit();
      await logAudit(req.user?.username, 'BULK_UPLOAD', `Uploaded ${items.length} requests via CSV`, { count: items.length, target: 'requests' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/upload-receipt', authenticateToken, requireAdmin, upload.single('receipt'), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
      const blob = bucket.file(`receipts/${Date.now()}-${req.file.originalname}`);
      const blobStream = blob.createWriteStream({ resumable: false, contentType: req.file.mimetype });
      blobStream.on('error', (err) => res.status(500).json({ error: err.message }));
      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${blob.name}`;
        await logAudit(req.user?.username, 'UPLOADED_RECEIPT', `Uploaded receipt file`, { filename: req.file?.originalname, url: publicUrl });
        res.json({ success: true, url: publicUrl });
      });
      blobStream.end(req.file.buffer);
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- SETTINGS & AUDIT ---
  app.get('/api/settings', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const doc = await db.collection('settings').doc('email_config').get();
      res.json(doc.data());
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/settings', authenticateToken, requireSuperAdmin, async (req: any, res) => {
    try {
      await db.collection('settings').doc('email_config').update(req.body);
      await logAudit(req.user?.username, 'UPDATED_SETTINGS', `Updated email config`, req.body);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/audit_logs', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const snapshot = await db.collection('audit_logs').orderBy('timestamp', 'desc').limit(500).get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- USERS ---
  app.get('/api/users', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const snapshot = await db.collection('users').get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/users', authenticateToken, requireAdmin, async (req: any, res) => {
    const { username, password, full_name, role } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.collection('users').add({ username, password: hashedPassword, full_name, role: role || 'staff' });
      await logAudit(req.user?.username, 'CREATED_USER', `Created user ${username}`, { role: role || 'staff' });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/users/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { username, full_name, password, role } = req.body;
    try {
      const updateData: any = { username, full_name, role };
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }
      await db.collection('users').doc(id).update(updateData);
      await logAudit(req.user?.username, 'UPDATED_USER', `Updated user ${username}`, { target_user_id: id, new_role: role });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    try {
      await db.collection('users').doc(id).delete();
      await logAudit(req.user?.username, 'DELETED_USER', `Deleted user record`, { target_user_id: id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
      if (!snapshot.empty) {
        const userDoc = snapshot.docs[0];
        const user = userDoc.data();
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (isPasswordValid) {
          const token = jwt.sign(
            { id: userDoc.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
          );
          res.json({ token, user: { username: user.username, full_name: user.full_name, role: user.role } });
        } else {
          res.status(401).json({ error: 'Invalid credentials' });
        }
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- REQUESTS (With Security Whitelist & Rate Limiter) ---
  app.get('/api/allowed-domains', async (req, res) => {
    try {
      const doc = await db.collection('settings').doc('email_config').get();
      const data = doc.data();
      res.json({ allowed_domains: data?.allowed_domains || ['@hawaiicounty.gov', '@hawaii.gov', '@hawaiipolice.gov', '@hawaiiprosecutors.gov'] });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/requests', requestSubmitLimiter, async (req, res) => {
    const { requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, line_items } = req.body;
    
    try {
      // Domain Whitelist Security Check
      const settingsDoc = await db.collection('settings').doc('email_config').get();
      const settings = settingsDoc.data() || {};
      const allowedDomains = settings.allowed_domains || ['@hawaiicounty.gov', '@hawaii.gov', '@hawaiipolice.gov', '@hawaiiprosecutors.gov'];
      const isAllowed = allowedDomains.some((domain: string) => requester_email?.toLowerCase().endsWith(domain));
      
      if (!isAllowed) {
        return res.status(403).json({ error: 'Invalid email domain. Please use an approved county email address.' });
      }

      const docRef = await db.collection('requests').add({
        requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status: 'Awaiting', is_deleted: false, line_items: line_items.filter((item: any) => item.quantity > 0)
      });
      await logAudit(requester_name, 'CREATED_REQUEST', `Submitted request for ${event_name}`, { request_id: docRef.id, department });
      
      if (process.env['SMTP_USER'] && process.env['SMTP_PASS']) {
        const transporter = nodemailer.createTransport({ host: process.env['SMTP_HOST'] || 'smtp.gmail.com', port: parseInt(process.env['SMTP_PORT'] || '587'), secure: process.env['SMTP_SECURE'] === 'true', auth: { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] } });
        
        const mailOptions = { from: process.env['SMTP_USER'], to: settings.request_notification_email || process.env['NOTIFICATION_EMAIL'], subject: 'New Request Submitted', text: `A new request has been submitted.\n\nRequester: ${requester_name}\nEmail: ${requester_email}\nDepartment: ${department}\nEvent: ${event_name}\n\nPlease check the dashboard.` };
        transporter.sendMail(mailOptions).catch(err => console.error(err));

        if (requester_email) {
          const receiptOptions = { from: process.env['SMTP_USER'], to: requester_email, subject: 'OSCER Request Received', text: `Aloha ${requester_name},\n\nWe received your request for ${event_name}.\n\nMahalo,\nThe OSCER Team` };
          transporter.sendMail(receiptOptions).catch(err => console.error(err));
        }
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/requests', authenticateToken, async (req: any, res) => {
    const role = req.user?.role;
    const limit = parseInt(req.query.limit as string) || 50;
    const startAfterId = req.query.startAfter as string;

    try {
      let query: any = db.collection('requests');
      if (role !== 'super_admin') query = query.where('is_deleted', '==', false);
      query = query.orderBy('check_out_date', 'asc');

      if (startAfterId) {
        const startAfterDoc = await db.collection('requests').doc(startAfterId).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.limit(limit).get();
      res.json(snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/requests/:id/status', authenticateToken, async (req: any, res) => {
    const { status: newStatus, handled_by } = req.body;
    const { id } = req.params;
    try {
      const reqDoc = await db.collection('requests').doc(id).get();
      if (!reqDoc.exists) return res.status(404).json({ error: 'Request not found' });
      
      const requestData = reqDoc.data() as any;
      const oldStatus = requestData.status;
      const settingsDoc = await db.collection('settings').doc('email_config').get();
      const settings = settingsDoc.data() || {};
      
      let transporter: any = null;
      if (process.env['SMTP_USER'] && process.env['SMTP_PASS']) {
        transporter = nodemailer.createTransport({ host: process.env['SMTP_HOST'] || 'smtp.gmail.com', port: parseInt(process.env['SMTP_PORT'] || '587'), secure: process.env['SMTP_SECURE'] === 'true', auth: { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] } });
      }

      if (oldStatus !== newStatus) {
        if (newStatus === 'Approved' && transporter && requestData.requester_email) {
            transporter.sendMail({ from: process.env['SMTP_USER'], to: requestData.requester_email, subject: 'OSCER Request Approved', text: `Aloha,\n\nYour request for ${requestData.event_name} is approved and ready for pickup!` }).catch((e:any) => console.error(e));
        }
        for (const item of requestData.line_items || []) {
          if (!item.category_id) continue;
          const catRef = db.collection('categories').doc(String(item.category_id));
          const catDoc = await catRef.get();
          if (!catDoc.exists) continue;
          const catData = catDoc.data() as any;
          const qty = item.quantity;

          if (newStatus === 'Checked-out' && oldStatus !== 'Checked-out') {
            await catRef.update({ current_count: FieldValue.increment(-qty), total_checked_out: FieldValue.increment(qty) });
            const newCount = (catData.current_count || 0) - qty;
            const threshold = catData.low_stock_threshold || 100;
            if (newCount < threshold && transporter) {
              transporter.sendMail({ from: process.env['SMTP_USER'], to: settings.low_inventory_email || process.env['NOTIFICATION_EMAIL'], subject: `Low Inventory: ${catData.name}`, text: `Warning: ${catData.name} has fallen to ${newCount}. Threshold is ${threshold}.` }).catch((e:any) => console.error(e));
            }
          }
          if (oldStatus === 'Checked-out' && newStatus !== 'Checked-out') {
            await catRef.update({ total_checked_out: FieldValue.increment(-qty) });
            if (newStatus === 'Checked-in' && catData.name?.toLowerCase().includes('reusable')) await catRef.update({ current_count: FieldValue.increment(qty) });
            else if (['Denied', 'Awaiting', 'Approved'].includes(newStatus)) await catRef.update({ current_count: FieldValue.increment(qty) });
          }
        }
      }
      await db.collection('requests').doc(id).update({ status: newStatus, handled_by });
      await logAudit(handled_by || req.user?.username, 'UPDATED_REQUEST_STATUS', `Changed request ${id} to ${newStatus}`, { request_id: id, old_status: oldStatus, new_status: newStatus });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/requests/:id', authenticateToken, async (req: any, res) => {
    try {
      await db.collection('requests').doc(req.params.id).update({ is_deleted: true });
      await logAudit(req.user?.username, 'DELETED_REQUEST', `Soft deleted request ${req.params.id}`, { request_id: req.params.id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/requests/:id', authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    const { requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status, line_items } = req.body;
    try {
      await db.collection('requests').doc(id).update({
        requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status, line_items: line_items || []
      });
      await logAudit(req.user?.username, 'EDITED_REQUEST', `Edited raw request data for ${id}`, { request_id: id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- ORDERS (Admin Only) ---
  app.post('/api/orders', authenticateToken, requireAdmin, async (req: any, res) => {
    const { order_number, line_items, receipt_url } = req.body;
    try {
      await db.collection('orders').doc(order_number).set({ ...req.body, is_deleted: false, line_items: line_items || [], receipt_url: receipt_url || null });
      for (const line_item of line_items || []) {
        const invSnap = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
        if (!invSnap.empty) {
          const vItem = invSnap.docs[0].data();
          for (const comp of vItem.kit_components || []) {
            const added = line_item.quantity * (vItem.pack_size || 1) * (comp.yield_multiplier || 1);
            await db.collection('categories').doc(String(comp.category_id)).update({ current_count: FieldValue.increment(added), total_procured: FieldValue.increment(added) });
          }
        }
      }
      await logAudit(req.user?.username, 'CREATED_ORDER', `Logged procurement ${order_number}`, { order_number, item_count: line_items?.length || 0 });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/orders', authenticateToken, async (req: any, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const startAfterId = req.query.startAfter as string;

    try {
      let query: any = db.collection('orders');
      if (req.user?.role !== 'super_admin') query = query.where('is_deleted', '==', false);
      query = query.orderBy('date_ordered', 'desc');

      if (startAfterId) {
        const startAfterDoc = await db.collection('orders').doc(startAfterId).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      }

      const snapshot = await query.limit(limit).get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/orders/:order_number', authenticateToken, requireAdmin, async (req: any, res) => {
    const { order_number } = req.params;
    try {
      const orderRef = db.collection('orders').doc(order_number);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) return res.status(404).json({ error: 'Not found' });
      const orderData = orderDoc.data() as any;

      for (const line_item of orderData.line_items || []) {
        const invSnap = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
        if (!invSnap.empty) {
          const vItem = invSnap.docs[0].data();
          for (const comp of vItem.kit_components || []) {
            const removed = line_item.quantity * (vItem.pack_size || 1) * (comp.yield_multiplier || 1);
            await db.collection('categories').doc(String(comp.category_id)).update({ current_count: FieldValue.increment(-removed), total_procured: FieldValue.increment(-removed) });
          }
        }
      }
      await orderRef.update({ is_deleted: true });
      await logAudit(req.user?.username, 'DELETED_ORDER', `Soft deleted order ${order_number} and reversed math`, { order_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- INVENTORY & CATEGORIES ---
  app.post('/api/items', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
      await db.collection('inventory').doc(req.body.item_number).set({ ...req.body, is_deleted: false, current_count: 0, total_procured: 0, total_checked_out: 0 });
      await logAudit(req.user?.username, 'CREATED_ITEM', `Added item ${req.body.item_number}`, { item_number: req.body.item_number, vendor: req.body.vendor });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/items/:item_number', authenticateToken, requireAdmin, async (req: any, res) => {
    const { item_number } = req.params;
    const { vendor, type, name, price, pack_size, kit_components, reorder_url } = req.body;
    try {
      await db.collection('inventory').doc(item_number).update({
        vendor, type, name, price, pack_size, reorder_url: reorder_url || '', kit_components: kit_components || []
      });
      await logAudit(req.user?.username, 'EDITED_ITEM', `Edited catalog item ${item_number}`, { item_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/items/:item_number', authenticateToken, requireAdmin, async (req: any, res) => {
    try {
      await db.collection('inventory').doc(req.params.item_number).update({ is_deleted: true });
      await logAudit(req.user?.username, 'DELETED_ITEM', `Soft deleted catalog item ${req.params.item_number}`, { item_number: req.params.item_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/categories/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { low_stock_threshold } = req.body;
    try {
      await db.collection('categories').doc(id).update({
        low_stock_threshold: parseInt(low_stock_threshold) || 100
      });
      await logAudit(req.user?.username, 'UPDATED_THRESHOLD', `Updated threshold for category ${id}`, { category_id: id, new_threshold: low_stock_threshold });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/categories', async (req, res) => {
    try {
      let query: any = db.collection('categories').where('is_requestable', '==', 1);
      const snapshot = await query.where('is_deleted', '==', false).get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/items', authenticateToken, async (req: any, res) => {
    try {
      let query: any = db.collection('inventory');
      if (req.user?.role !== 'super_admin') query = query.where('is_deleted', '==', false);
      const snapshot = await query.get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/inventory/current', authenticateToken, async (req, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(rows);
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  // --- FILE UPLOAD ---
  app.post('/api/upload', authenticateToken, upload.single('file'), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const gcsFileName = `${Date.now()}-${crypto.randomUUID()}-${req.file.originalname}`;
      const file = bucket.file(gcsFileName);

      const stream = file.createWriteStream({
        metadata: { contentType: req.file.mimetype },
        resumable: false
      });

      stream.on('error', (err) => {
        console.error('GCS Upload Error:', err);
        res.status(500).json({ error: 'Failed to upload to storage' });
      });

      stream.on('finish', async () => {
        try {
          await file.makePublic();
          const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;
          res.json({ url: publicUrl });
        } catch (err) {
          console.error('Make Public Error:', err);
          res.status(500).json({ error: 'Failed to make file public' });
        }
      });

      stream.end(req.file.buffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  // --- CATEGORIES ---
  app.put('/api/categories/:id', authenticateToken, requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { low_stock_threshold, image_url, kit_yield, name, is_requestable } = req.body;
    try {
      const updateData = {
        name,
        low_stock_threshold: Number(low_stock_threshold) || 0,
        kit_yield: Number(kit_yield) || 0,
        is_requestable: Number(is_requestable) || 0,
        image_url: image_url || ''
      };

      await db.collection('categories').doc(id).update(updateData);
      await logAudit(req.user?.username, 'UPDATED_CATEGORY', `Updated category ${name || id} (Full Sync)`, updateData);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/categories', authenticateToken, requireAdmin, async (req: any, res) => {
    const { name, is_requestable, low_stock_threshold, image_url, kit_yield } = req.body;
    try {
      const categoryData = {
        name: name || '',
        is_requestable: Number(is_requestable) || 0,
        low_stock_threshold: Number(low_stock_threshold) || 100,
        image_url: image_url || '',
        kit_yield: Number(kit_yield) || 0,
        current_count: 0,
        total_procured: 0,
        total_checked_out: 0,
        is_deleted: false
      };
      
      const docRef = await db.collection('categories').add(categoryData);
      await logAudit(req.user?.username, 'CREATED_CATEGORY', `Created category ${name}`, { id: docRef.id, ...categoryData });
      res.json({ success: true, id: docRef.id });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/categories', async (req, res) => {
    try {
      const snapshot = await db.collection('categories').where('is_deleted', '==', false).get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

startServer();
