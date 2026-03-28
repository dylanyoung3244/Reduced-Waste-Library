import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import multer from 'multer';
import { Storage } from '@google-cloud/storage';
import { db, initDb, FieldValue } from './src/db.js';

dotenv.config();

const storage = new Storage();
const bucketName = process.env['GCS_BUCKET_NAME'] || 'missing-bucket-name';
const bucket = storage.bucket(bucketName);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3001');

  app.use(express.json({ limit: '50mb' }));
  initDb();

  const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-user-role'] !== 'super_admin') return res.status(403).json({ error: 'Super Admin required' });
    next();
  };
  
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers['x-user-role'];
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

  // --- BULK TEMPLATES ---
  app.get('/api/export/template/inventory', requireAdmin, (req, res) => {
    const template = "item_number,vendor,type,name,price,pack_size,reorder_url,kit_components\nSKU-123,Amazon,Reusable,Metal Fork,12.99,50,https://amazon.com/example,[]";
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);
  });

  app.get('/api/export/template/orders', requireAdmin, (req, res) => {
    const template = "order_number,order_name,date_ordered,date_delivered,subtotal,shipping,tax,total,procurement_method,logged_by,line_items\nWalmart-001,Walmart Bulk,2025-03-11,2025-03-12,100.00,0,0,100.00,Credit Card,Admin,\"[{\\\"item_number\\\":\\\"SKU-123\\\",\\\"quantity\\\":10,\\\"price\\\":10.00}]\"";
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);
  });

  app.get('/api/export/template/requests', requireAdmin, (req, res) => {
    const template = "requester_name,requester_email,requester_phone,department,event_name,check_out_date,check_in_date,status,line_items\nJohn Doe,jdoe@email.com,555-0100,Parks,Luau,2025-04-01,2025-04-05,Approved,\"[{\\\"item_number\\\":\\\"SKU-123\\\",\\\"quantity\\\":50}]\"";
    res.setHeader('Content-Type', 'text/csv');
    res.send(template);
  });

  // --- BULK UPLOADS ---
  app.post('/api/bulk-upload/inventory', requireAdmin, async (req, res) => {
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
      await logAudit(req.headers['x-username'] as string, 'BULK_UPLOAD', `Uploaded ${items.length} catalog items via CSV`, { count: items.length, target: 'inventory' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/bulk-upload/orders', requireAdmin, async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });

    const batch = db.batch();
    try {
      items.forEach((item: any) => {
        if (!item.order_number) return;
        const ref = db.collection('orders').doc(item.order_number);
        let parsedLineItems = [];
        try { parsedLineItems = typeof item.line_items === 'string' ? JSON.parse(item.line_items) : (item.line_items || []); } catch(e){}
        batch.set(ref, {
          ...item, line_items: parsedLineItems, is_deleted: false
        }, { merge: true });
      });
      await batch.commit();
      await logAudit(req.headers['x-username'] as string, 'BULK_UPLOAD', `Uploaded ${items.length} orders via CSV`, { count: items.length, target: 'orders' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/bulk-upload/requests', requireAdmin, async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });

    const batch = db.batch();
    try {
      items.forEach((item: any) => {
        const ref = item.id ? db.collection('requests').doc(item.id) : db.collection('requests').doc();
        let parsedLineItems = [];
        try { parsedLineItems = typeof item.line_items === 'string' ? JSON.parse(item.line_items) : (item.line_items || []); } catch(e){}
        batch.set(ref, {
          ...item, line_items: parsedLineItems, is_deleted: false, status: item.status || 'Awaiting'
        }, { merge: true });
      });
      await batch.commit();
      await logAudit(req.headers['x-username'] as string, 'BULK_UPLOAD', `Uploaded ${items.length} requests via CSV`, { count: items.length, target: 'requests' });
      res.json({ success: true, count: items.length });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/upload-receipt', requireAdmin, upload.single('receipt'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
      const blob = bucket.file(`receipts/${Date.now()}-${req.file.originalname}`);
      const blobStream = blob.createWriteStream({ resumable: false, contentType: req.file.mimetype });
      blobStream.on('error', (err) => res.status(500).json({ error: err.message }));
      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;
        await logAudit(req.headers['x-username'] as string, 'UPLOADED_RECEIPT', `Uploaded receipt file`, { filename: req.file?.originalname, url: publicUrl });
        res.json({ success: true, url: publicUrl });
      });
      blobStream.end(req.file.buffer);
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/settings', requireSuperAdmin, async (req, res) => {
    try {
      const doc = await db.collection('settings').doc('email_config').get();
      res.json(doc.data());
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/settings', requireSuperAdmin, async (req, res) => {
    try {
      await db.collection('settings').doc('email_config').update(req.body);
      await logAudit(req.headers['x-username'] as string, 'UPDATED_SETTINGS', `Updated email config`, req.body);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/audit_logs', requireSuperAdmin, async (req, res) => {
    try {
      const snapshot = await db.collection('audit_logs').orderBy('timestamp', 'desc').limit(500).get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/users', requireSuperAdmin, async (req, res) => {
    try {
      const snapshot = await db.collection('users').get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/users', requireAdmin, async (req, res) => {
    const { username, password, full_name, role } = req.body;
    try {
      await db.collection('users').add({ username, password, full_name, role: role || 'staff' });
      await logAudit(req.headers['x-username'] as string, 'CREATED_USER', `Created user ${username}`, { role: role || 'staff' });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { username, full_name, password, role } = req.body;
    try {
      const updateData: any = { username, full_name, role };
      if (password) updateData.password = password;
      await db.collection('users').doc(id).update(updateData);
      await logAudit(req.headers['x-username'] as string, 'UPDATED_USER', `Updated user ${username}`, { target_user_id: id, new_role: role });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      await db.collection('users').doc(id).delete();
      await logAudit(req.headers['x-username'] as string, 'DELETED_USER', `Deleted user record`, { target_user_id: id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const snapshot = await db.collection('users').where('username', '==', username).where('password', '==', password).limit(1).get();
      if (!snapshot.empty) {
        const user = snapshot.docs[0].data();
        res.json({ token: "authenticated", user: { username: user.username, full_name: user.full_name, role: user.role } });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/requests', async (req, res) => {
    const { requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, line_items } = req.body;
    try {
      const docRef = await db.collection('requests').add({
        requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status: 'Awaiting', is_deleted: false, line_items: line_items.filter((item: any) => item.quantity > 0)
      });
      await logAudit(requester_name, 'CREATED_REQUEST', `Submitted request for ${event_name}`, { request_id: docRef.id, department });
      
      const settingsDoc = await db.collection('settings').doc('email_config').get();
      const settings = settingsDoc.data() || {};
      
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

  app.get('/api/requests', async (req, res) => {
    const role = req.headers['x-user-role'];
    try {
      let query: any = db.collection('requests');
      if (role !== 'super_admin') query = query.where('is_deleted', '==', false);
      const snapshot = await query.orderBy('check_out_date', 'asc').get();
      res.json(snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/requests/:id/status', async (req, res) => {
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
      await logAudit(handled_by || req.headers['x-username'] as string, 'UPDATED_REQUEST_STATUS', `Changed request ${id} to ${newStatus}`, { request_id: id, old_status: oldStatus, new_status: newStatus });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/requests/:id', async (req, res) => {
    try {
      await db.collection('requests').doc(req.params.id).update({ is_deleted: true });
      await logAudit(req.headers['x-username'] as string, 'DELETED_REQUEST', `Soft deleted request ${req.params.id}`, { request_id: req.params.id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/requests/:id', async (req, res) => {
    const { id } = req.params;
    const { requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status, line_items } = req.body;
    try {
      await db.collection('requests').doc(id).update({
        requester_name, requester_email, requester_phone, department, event_name, check_out_date, check_in_date, status, line_items: line_items || []
      });
      await logAudit(req.headers['x-username'] as string, 'EDITED_REQUEST', `Edited raw request data for ${id}`, { request_id: id });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/orders', requireAdmin, async (req, res) => {
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
      await logAudit(req.headers['x-username'] as string, 'CREATED_ORDER', `Logged procurement ${order_number}`, { order_number, item_count: line_items?.length || 0 });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/orders', async (req, res) => {
    try {
      let query: any = db.collection('orders');
      if (req.headers['x-user-role'] !== 'super_admin') query = query.where('is_deleted', '==', false);
      const snapshot = await query.orderBy('date_ordered', 'desc').get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/orders/:order_number', requireAdmin, async (req, res) => {
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
      await logAudit(req.headers['x-username'] as string, 'DELETED_ORDER', `Soft deleted order ${order_number} and reversed math`, { order_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.post('/api/items', requireAdmin, async (req, res) => {
    try {
      await db.collection('inventory').doc(req.body.item_number).set({ ...req.body, is_deleted: false, current_count: 0, total_procured: 0, total_checked_out: 0 });
      await logAudit(req.headers['x-username'] as string, 'CREATED_ITEM', `Added item ${req.body.item_number}`, { item_number: req.body.item_number, vendor: req.body.vendor });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/items/:item_number', requireAdmin, async (req, res) => {
    const { item_number } = req.params;
    const { vendor, type, name, price, pack_size, kit_components, reorder_url } = req.body;
    try {
      await db.collection('inventory').doc(item_number).update({
        vendor, type, name, price, pack_size, reorder_url: reorder_url || '', kit_components: kit_components || []
      });
      await logAudit(req.headers['x-username'] as string, 'EDITED_ITEM', `Edited catalog item ${item_number}`, { item_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.delete('/api/items/:item_number', requireAdmin, async (req, res) => {
    try {
      await db.collection('inventory').doc(req.params.item_number).update({ is_deleted: true });
      await logAudit(req.headers['x-username'] as string, 'DELETED_ITEM', `Soft deleted catalog item ${req.params.item_number}`, { item_number: req.params.item_number });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.put('/api/categories/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { low_stock_threshold } = req.body;
    try {
      await db.collection('categories').doc(id).update({
        low_stock_threshold: parseInt(low_stock_threshold) || 100
      });
      await logAudit(req.headers['x-username'] as string, 'UPDATED_THRESHOLD', `Updated threshold for category ${id}`, { category_id: id, new_threshold: low_stock_threshold });
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/categories', async (req, res) => {
    try {
      let query: any = db.collection('categories').where('is_requestable', '==', 1);
      if (req.headers['x-user-role'] !== 'super_admin') query = query.where('is_deleted', '==', false);
      const snapshot = await query.get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/items', async (req, res) => {
    try {
      let query: any = db.collection('inventory');
      if (req.headers['x-user-role'] !== 'super_admin') query = query.where('is_deleted', '==', false);
      const snapshot = await query.get();
      res.json(snapshot.docs.map((doc:any) => ({ id: doc.id, ...doc.data() })));
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  app.get('/api/inventory/current', async (req, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(rows);
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
