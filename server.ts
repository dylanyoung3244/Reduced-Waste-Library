import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import nodemailer from 'nodemailer';
import { db, initDb, FieldValue } from './src/db.js';

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3001');

  app.use(express.json());

  // Initialize DB
  initDb();

  // API Routes
  
  // GET /api/users
  app.get('/api/users', async (req, res) => {
    try {
      const snapshot = await db.collection('users').get();
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/users
  app.post('/api/users', async (req, res) => {
    const { username, password, full_name } = req.body;
    try {
      await db.collection('users').add({ username, password, full_name });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/users/:id
  app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, full_name, password } = req.body;
    try {
      const updateData: any = { username, full_name };
      if (password) {
        updateData.password = password;
      }
      await db.collection('users').doc(id).update(updateData);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await db.collection('users').doc(id).delete();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/login
  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const snapshot = await db.collection('users')
        .where('username', '==', username)
        .where('password', '==', password)
        .limit(1)
        .get();
        
      if (!snapshot.empty) {
        const user = snapshot.docs[0].data();
        res.json({ token: "authenticated", user: { username: user.username, full_name: user.full_name } });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/inventory/current
  app.get('/api/inventory/current', async (req, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/requests
  app.post('/api/requests', async (req, res) => {
    const { requester_name, department, event_name, check_out_date, check_in_date, line_items } = req.body;

    try {
      const docRef = await db.collection('requests').add({
        requester_name,
        department,
        event_name,
        check_out_date,
        check_in_date,
        status: 'Awaiting',
        line_items: line_items.filter((item: any) => item.quantity > 0)
      });
      
      const requestId = docRef.id;
      
      if (process.env['SMTP_USER'] && process.env['SMTP_PASS']) {
        const transporter = nodemailer.createTransport({
          host: process.env['SMTP_HOST'] || 'smtp.gmail.com',
          port: parseInt(process.env['SMTP_PORT'] || '587'),
          secure: process.env['SMTP_SECURE'] === 'true',
          auth: {
            user: process.env['SMTP_USER'],
            pass: process.env['SMTP_PASS'],
          },
        });

        const NOTIFICATION_EMAIL = process.env['NOTIFICATION_EMAIL'] || 'your-fallback@email.com';
        const mailOptions = {
          from: process.env['SMTP_USER'] || 'noreply@example.com',
          to: NOTIFICATION_EMAIL,
          subject: 'New Request Submitted',
          text: `A new request has been submitted.\n\nRequester Name: ${requester_name}\nDepartment: ${department}\nEvent Date: ${check_out_date}\n\nPlease check the dashboard for more details.`
        };
        
        transporter.sendMail(mailOptions).catch(err => console.error('Error sending email:', err));
      } else {
        console.warn('SMTP credentials not configured, skipping email notification.');
      }

      res.json({ success: true, request_id: requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/requests
  app.get('/api/requests', async (req, res) => {
    try {
      const snapshot = await db.collection('requests').orderBy('check_out_date', 'asc').get();
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(requests);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/requests/:id/status
  app.put('/api/requests/:id/status', async (req, res) => {
    const { status: newStatus, handled_by } = req.body;
    const { id } = req.params;
    try {
      const reqDoc = await db.collection('requests').doc(id).get();
      if (!reqDoc.exists) return res.status(404).json({ error: 'Request not found' });
      
      const requestData = reqDoc.data() as any;
      const oldStatus = requestData.status;

      if (oldStatus !== newStatus) {
        for (const item of requestData.line_items || []) {
          if (!item.category_id) continue;
          
          // Fetch the category directly to guarantee we know if it's reusable
          const catRef = db.collection('categories').doc(String(item.category_id));
          const catDoc = await catRef.get();
          if (!catDoc.exists) continue;
          
          const catData = catDoc.data() as any;
          const isReusable = catData.name?.toLowerCase().includes('reusable');
          const qty = item.quantity;

          // OUTBOUND: Leaving the warehouse
          if (newStatus === 'Checked-out' && oldStatus !== 'Checked-out') {
            await catRef.update({
              current_count: FieldValue.increment(-qty),
              total_checked_out: FieldValue.increment(qty)
            });
          }
          
          // INBOUND: Returning to the warehouse
          if (oldStatus === 'Checked-out' && newStatus !== 'Checked-out') {
            await catRef.update({
              total_checked_out: FieldValue.increment(-qty)
            });
            
            if (newStatus === 'Checked-in') {
              // Only return reusable items
              if (isReusable) {
                await catRef.update({ current_count: FieldValue.increment(qty) });
              }
            } else if (['Denied', 'Test', 'Awaiting', 'Approved'].includes(newStatus)) {
              // Reversing a mistake: return EVERYTHING back to the shelf
              await catRef.update({ current_count: FieldValue.increment(qty) });
            }
          }
        }
      }

      await db.collection('requests').doc(id).update({ status: newStatus, handled_by });
      res.json({ success: true });
    } catch (error) {
      console.error("Status update error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.delete('/api/requests/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await db.collection('requests').doc(id).delete();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/requests/:id
  app.put('/api/requests/:id', async (req, res) => {
    const { id } = req.params;
    const { requester_name, department, event_name, check_out_date, check_in_date, status, line_items } = req.body;
    try {
      await db.collection('requests').doc(id).update({
        requester_name,
        department,
        event_name,
        check_out_date,
        check_in_date,
        status,
        line_items: line_items || []
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/orders
  app.post('/api/orders', async (req, res) => {
    const { order_number, order_name, date_ordered, date_delivered, subtotal, shipping, tax, total, procurement_method, line_items, logged_by } = req.body;
    
    try {
      await db.collection('orders').doc(order_number).set({
        order_number,
        order_name,
        date_ordered,
        date_delivered,
        subtotal,
        shipping,
        tax,
        total,
        procurement_method,
        logged_by,
        line_items: line_items || []
      });

      // Update category stock based on kit components
      if (line_items && line_items.length > 0) {
        for (const line_item of line_items) {
          const invSnapshot = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
          if (!invSnapshot.empty) {
            const vendorItem = invSnapshot.docs[0].data();
            const packSize = vendorItem.pack_size || 1;
            const kitComponents = vendorItem.kit_components || [];
            
            for (const component of kitComponents) {
              const totalAdded = line_item.quantity * packSize * (component.yield_multiplier || 1);
              await db.collection('categories').doc(String(component.category_id)).update({
                current_count: FieldValue.increment(totalAdded),
                total_procured: FieldValue.increment(totalAdded)
              });
            }
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/orders
  app.get('/api/orders', async (req, res) => {
    try {
      const snapshot = await db.collection('orders').orderBy('date_ordered', 'desc').get();
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/orders/:order_number
  app.put('/api/orders/:order_number', async (req, res) => {
    const { order_number } = req.params;
    const { order_name, date_ordered, date_delivered, subtotal, shipping, tax, total, procurement_method, line_items, logged_by } = req.body;
    
    try {
      const orderRef = db.collection('orders').doc(order_number);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const oldOrderData = orderDoc.data() as any;

      // STEP 1: Reverse the old order's math
      if (oldOrderData.line_items && oldOrderData.line_items.length > 0) {
        for (const line_item of oldOrderData.line_items) {
          const invSnapshot = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
          if (!invSnapshot.empty) {
            const vendorItem = invSnapshot.docs[0].data();
            const packSize = vendorItem.pack_size || 1;
            for (const component of vendorItem.kit_components || []) {
              const totalRemoved = line_item.quantity * packSize * (component.yield_multiplier || 1);
              await db.collection('categories').doc(String(component.category_id)).update({
                current_count: FieldValue.increment(-totalRemoved),
                total_procured: FieldValue.increment(-totalRemoved)
              });
            }
          }
        }
      }

      // STEP 2: Apply the new order's math
      if (line_items && line_items.length > 0) {
        for (const line_item of line_items) {
          const invSnapshot = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
          if (!invSnapshot.empty) {
            const vendorItem = invSnapshot.docs[0].data();
            const packSize = vendorItem.pack_size || 1;
            for (const component of vendorItem.kit_components || []) {
              const totalAdded = line_item.quantity * packSize * (component.yield_multiplier || 1);
              await db.collection('categories').doc(String(component.category_id)).update({
                current_count: FieldValue.increment(totalAdded),
                total_procured: FieldValue.increment(totalAdded)
              });
            }
          }
        }
      }

      // STEP 3: Save the updated order document
      await orderRef.update({
        order_name, date_ordered, date_delivered, subtotal, shipping, tax, total, procurement_method, logged_by, line_items: line_items || []
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Order update error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/orders/:order_number
  app.delete('/api/orders/:order_number', async (req, res) => {
    const { order_number } = req.params;
    try {
      const orderRef = db.collection('orders').doc(order_number);
      const orderDoc = await orderRef.get();
      
      if (!orderDoc.exists) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const orderData = orderDoc.data() as any;

      // Revert the category stock based on the kit components
      if (orderData.line_items && orderData.line_items.length > 0) {
        for (const line_item of orderData.line_items) {
          const invSnapshot = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
          if (!invSnapshot.empty) {
            const vendorItem = invSnapshot.docs[0].data();
            const packSize = vendorItem.pack_size || 1;
            const kitComponents = vendorItem.kit_components || [];
            
            for (const component of kitComponents) {
              const totalRemoved = line_item.quantity * packSize * (component.yield_multiplier || 1);
              await db.collection('categories').doc(String(component.category_id)).update({
                current_count: FieldValue.increment(-totalRemoved),
                total_procured: FieldValue.increment(-totalRemoved)
              });
            }
          }
        }
      }

      // Finally, delete the order document
      await orderRef.delete();
      res.json({ success: true });
    } catch (error) {
      console.error("Order deletion error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/items
  app.post('/api/items', async (req, res) => {
    const { item_number, vendor, type, name, price, pack_size, kit_components } = req.body;
    try {
      await db.collection('inventory').doc(item_number).set({
        item_number, 
        vendor, 
        type, 
        name, 
        price, 
        pack_size, 
        current_count: 0,
        total_procured: 0,
        total_checked_out: 0,
        kit_components: kit_components || []
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/items/:item_number
  app.put('/api/items/:item_number', async (req, res) => {
    const { item_number } = req.params;
    const { vendor, type, name, price, pack_size, kit_components } = req.body;
    try {
      await db.collection('inventory').doc(item_number).update({
        vendor, type, name, price, pack_size, kit_components: kit_components || []
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/items/:item_number
  app.delete('/api/items/:item_number', async (req, res) => {
    const { item_number } = req.params;
    try {
      await db.collection('inventory').doc(item_number).delete();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/categories
  app.get('/api/categories', async (req, res) => {
    try {
      const snapshot = await db.collection('categories').where('is_requestable', '==', 1).get();
      const categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/items
  app.get('/api/items', async (req, res) => {
    try {
      const snapshot = await db.collection('inventory').get();
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // API 404 Handler
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Custom Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  // Explicit Health Check for Cloud Run
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve the static files from the React app build directory
    app.use(express.static(path.join(process.cwd(), 'dist')));

    // Catch-All Route: Send any unknown requests to the React index.html
    app.get('*', (req, res) => {
      const indexPath = path.join(process.cwd(), 'dist', 'index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(500).send('Frontend build not found. Please run "npm run build".');
        }
      });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
