import { Firestore, FieldValue } from '@google-cloud/firestore';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import type { CategoryItemType } from './types.js';

dotenv.config();

const dbConfig: { projectId?: string; databaseId: string } = {
  databaseId: process.env['FIRESTORE_DATABASE_ID'] || '(default)',
};

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.projectId) {
      dbConfig.projectId = config.projectId;
    }
  }
} catch (error) {
  console.error('Failed to load firebase-applet-config.json for server-side Firestore:', error);
}

console.log('Using Firestore config:', dbConfig);
export const db = new Firestore(dbConfig);
export { FieldValue };

export function inferCategoryItemType(name?: string, explicitType?: string): CategoryItemType {
  if (explicitType === 'reusable' || explicitType === 'consumable') {
    return explicitType;
  }
  return (name || '').toLowerCase().includes('reusable') ? 'reusable' : 'consumable';
}

export async function initDb(): Promise<void> {
  try {
    const usersSnapshot = await db.collection('users').limit(1).get();
    if (usersSnapshot.empty) {
      const saltRounds = 10;
      const bootstrapPassword =
        process.env['INITIAL_ADMIN_PASSWORD'] || crypto.randomBytes(12).toString('base64url');

      if (!process.env['INITIAL_ADMIN_PASSWORD']) {
        console.warn(
          `[BOOTSTRAP] Seeded initial staff users with generated password: ${bootstrapPassword} — rotate immediately in Staff Dashboard.`
        );
      }

      const hashedPassword = await bcrypt.hash(bootstrapPassword, saltRounds);
      const users = [
        { username: 'dyoung', full_name: 'Dylan Young', role: 'super_admin' },
        { username: 'kobermaier', full_name: 'Kendra Obermaier', role: 'admin' },
        { username: 'cnguyen', full_name: 'Christine Nguyen', role: 'audit' },
        { username: 'Jrosas', full_name: 'Jaime Rosas', role: 'user' },
        { username: 'oscer', full_name: 'OSCER Staff', role: 'user' },
      ];

      const userBatch = db.batch();
      for (const user of users) {
        const ref = db.collection('users').doc();
        userBatch.set(ref, { ...user, password: hashedPassword });
      }
      await userBatch.commit();
    }

    const settingsRef = db.collection('settings').doc('email_config');
    const settingsDoc = await settingsRef.get();
    const defaultDomains = [
      '@hawaiicounty.gov',
      '@hawaii.gov',
      '@hawaiipolice.gov',
      '@hawaiiprosecutors.gov',
    ];

    if (!settingsDoc.exists) {
      const defaultNotify = process.env['NOTIFICATION_EMAIL'] || 'oscer@hawaiicounty.gov';
      await settingsRef.set({
        request_notification_email: defaultNotify,
        low_inventory_email: defaultNotify,
        allowed_domains: defaultDomains,
      });
    } else {
      const data = settingsDoc.data();
      if (data && !data.allowed_domains) {
        await settingsRef.update({ allowed_domains: defaultDomains });
      }
    }

    const categoriesSnapshot = await db.collection('categories').limit(1).get();
    if (categoriesSnapshot.empty) {
      const defaultCategories: Array<{
        name: string;
        item_type: CategoryItemType;
        kit_yield: number;
      }> = [
        { name: 'Reusable Plates', item_type: 'reusable', kit_yield: 0 },
        { name: 'Compostable Plates', item_type: 'consumable', kit_yield: 25 },
        { name: 'Reusable Cups', item_type: 'reusable', kit_yield: 25 },
        { name: 'Compostable Forks', item_type: 'consumable', kit_yield: 25 },
        { name: 'Compostable Knives', item_type: 'consumable', kit_yield: 25 },
        { name: 'Compostable Spoons', item_type: 'consumable', kit_yield: 25 },
        { name: 'Compostable Napkins', item_type: 'consumable', kit_yield: 50 },
        { name: 'Compostable Chopsticks', item_type: 'consumable', kit_yield: 0 },
        { name: 'Reusable Water Jugs', item_type: 'reusable', kit_yield: 0 },
      ];

      const catBatch = db.batch();
      for (const cat of defaultCategories) {
        const ref = db.collection('categories').doc();
        catBatch.set(ref, {
          name: cat.name,
          item_type: cat.item_type,
          kit_yield: cat.kit_yield,
          is_requestable: 1,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          currently_deployed: 0,
          low_stock_threshold: 100,
          bulk_unit_label: '',
          bulk_unit_size: 0,
          is_deleted: false,
        });
      }
      await catBatch.commit();
    }

    // Idempotent schema migration: backfill item_type & currently_deployed on existing categories
    const allCategoriesSnapshot = await db.collection('categories').get();
    const categoryMap: Record<string, string> = {};
    const migrationBatch = db.batch();
    let migrationCount = 0;

    allCategoriesSnapshot.forEach((doc) => {
      const data = doc.data();
      categoryMap[data.name] = doc.id;
      const updates: Record<string, unknown> = {};

      if (!data.item_type) {
        updates.item_type = inferCategoryItemType(data.name);
      }
      if (typeof data.currently_deployed !== 'number') {
        updates.currently_deployed = 0;
      }
      if (Object.keys(updates).length > 0) {
        migrationBatch.update(doc.ref, updates);
        migrationCount++;
      }
    });

    if (migrationCount > 0) {
      await migrationBatch.commit();
      console.log(`Migrated ${migrationCount} category document(s) with explicit item_type.`);
    }

    const inventorySnapshot = await db.collection('inventory').limit(1).get();
    if (inventorySnapshot.empty) {
      const items = [
        {
          item_number: 'sbl_dpx_dining-dinner-plates_B09KLY73YR_0',
          vendor: 'Amazon',
          type: 'Reusable',
          name: 'Stainless Steel Dining Plate',
          price: 17.99,
          pack_size: 10,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.amazon.com/dp/B09KLY73YR',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Reusable Plates'], yield_multiplier: 1 }],
        },
        {
          item_number: 'GUSTO 10',
          vendor: 'Walmart',
          type: 'Compostable',
          name: 'Compostable Paper Plate',
          price: 29.49,
          pack_size: 125,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.walmart.com/search?q=GUSTO+10+Compostable+Plates',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Compostable Plates'], yield_multiplier: 1 }],
        },
        {
          item_number: 'cm_sw_r_cp_ud_dp_80RH047CCY6K598Y1EQ7',
          vendor: 'Amazon',
          type: 'Reusable',
          name: 'Aluminum Cup',
          price: 259.99,
          pack_size: 600,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.amazon.com/dp/80RH047CCY',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Reusable Cups'], yield_multiplier: 1 }],
        },
        {
          item_number: 'Wooden-Utensils-Ecovita',
          vendor: 'Walmart',
          type: 'Compostable',
          name: 'Eco Cutlery Combo',
          price: 59.0,
          pack_size: 1,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.walmart.com/search?q=Ecovita+Compostable+Cutlery',
          is_deleted: false,
          kit_components: [
            { category_id: categoryMap['Compostable Forks'], yield_multiplier: 140 },
            { category_id: categoryMap['Compostable Knives'], yield_multiplier: 120 },
            { category_id: categoryMap['Compostable Spoons'], yield_multiplier: 120 },
          ],
        },
        {
          item_number: 'ECO SOUL',
          vendor: 'Walmart',
          type: 'Compostable',
          name: 'Bamboo Paper Napkin',
          price: 59.95,
          pack_size: 4000,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.walmart.com/search?q=ECO+SOUL+Bamboo+Napkins',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Compostable Napkins'], yield_multiplier: 1 }],
        },
        {
          item_number: 'Bmbo-chpstk',
          vendor: 'Walmart',
          type: 'Compostable',
          name: 'Bamboo Chopstick',
          price: 15.99,
          pack_size: 200,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.walmart.com/search?q=Bamboo+Chopsticks',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Compostable Chopsticks'], yield_multiplier: 1 }],
        },
        {
          item_number: '180657001848',
          vendor: 'Amazon',
          type: 'Reusable',
          name: 'Gallon Long Term Water Storage Container',
          price: 185.95,
          pack_size: 6,
          current_count: 0,
          total_procured: 0,
          total_checked_out: 0,
          reorder_url: 'https://www.amazon.com/s?k=Gallon+Long+Term+Water+Storage',
          is_deleted: false,
          kit_components: [{ category_id: categoryMap['Reusable Water Jugs'], yield_multiplier: 1 }],
        },
      ];

      for (const item of items) {
        if (item.kit_components.every((comp) => comp.category_id)) {
          await db.collection('inventory').doc(item.item_number).set(item);
        }
      }
    }

    const ordersSnapshot = await db.collection('orders').limit(1).get();
    if (ordersSnapshot.empty) {
      const initialOrders = [
        {
          order_number: 'Walmart-001',
          order_name: 'Walmart Initial',
          date_ordered: '2025-03-11',
          date_delivered: '2025-03-12',
          subtotal: 1108.54,
          shipping: 0,
          tax: 0,
          total: 1108.54,
          procurement_method: 'Credit Card',
          logged_by: 'Dylan Young',
          is_deleted: false,
          line_items: [
            { item_number: 'GUSTO 10', quantity: 16, price: 29.49 },
            { item_number: 'Wooden-Utensils-Ecovita', quantity: 3, price: 59 },
            { item_number: 'ECO SOUL', quantity: 1, price: 59.95 },
            { item_number: 'Bmbo-chpstk', quantity: 25, price: 15.99 },
          ],
        },
        {
          order_number: 'Amazon-001',
          order_name: 'Amazon Initial',
          date_ordered: '2025-03-11',
          date_delivered: '2025-03-12',
          subtotal: 991.69,
          shipping: 0,
          tax: 0,
          total: 991.69,
          procurement_method: 'Credit Card',
          logged_by: 'Dylan Young',
          is_deleted: false,
          line_items: [
            { item_number: '180657001848', quantity: 2, price: 185.95 },
            { item_number: 'sbl_dpx_dining-dinner-plates_B09KLY73YR_0', quantity: 20, price: 17.99 },
            { item_number: 'cm_sw_r_cp_ud_dp_80RH047CCY6K598Y1EQ7', quantity: 1, price: 259.99 },
          ],
        },
      ];

      for (const order of initialOrders) {
        await db.collection('orders').doc(order.order_number).set(order);
        for (const line_item of order.line_items) {
          const invDoc = await db.collection('inventory').doc(line_item.item_number).get();
          if (invDoc.exists) {
            const vendorItem = invDoc.data()!;
            const packSize = vendorItem.pack_size || 1;
            for (const component of vendorItem.kit_components || []) {
              const totalAdded = line_item.quantity * packSize * (component.yield_multiplier || 1);
              await db
                .collection('categories')
                .doc(String(component.category_id))
                .update({
                  current_count: FieldValue.increment(totalAdded),
                  total_procured: FieldValue.increment(totalAdded),
                });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(
      'Database initialization failed (expected if running without permissions in AI Studio preview):',
      error
    );
  }
}
