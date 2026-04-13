import { Firestore, FieldValue } from '@google-cloud/firestore';
import bcrypt from 'bcrypt';

export const db = new Firestore();
export { FieldValue };

export async function initDb() {
  const usersSnapshot = await db.collection('users').limit(1).get();
  
  if (usersSnapshot.empty) {
    const saltRounds = 10;
    const users = [
      { username: 'dyoung', password: 'OSCER2026', full_name: 'Dylan Young', role: 'super_admin' },
      { username: 'kobermaier', password: 'OSCER2026', full_name: 'Kobermaier', role: 'admin' },
      { username: 'cnguyen', password: 'OSCER2026', full_name: 'Christine Nguyen', role: 'audit' },
      { username: 'Jrosas', password: 'OSCER2026', full_name: 'Jrosas', role: 'user' },
      { username: 'oscer', password: 'OSCER2026', full_name: 'OSCER', role: 'user' }
    ];
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, saltRounds);
      await db.collection('users').add({ ...user, password: hashedPassword });
    }
  }

  const settingsSnapshot = await db.collection('settings').doc('email_config').get();
  if (!settingsSnapshot.exists) {
    await db.collection('settings').doc('email_config').set({
      request_notification_email: 'dylanyoung3244@gmail.com',
      low_inventory_email: 'dylanyoung3244@gmail.com'
    });
  }

  const categoriesSnapshot = await db.collection('categories').limit(1).get();
  if (categoriesSnapshot.empty) {
    const defaultCategories = ["Reusable Plates", "Compostable Plates", "Reusable Cups", "Compostable Forks", "Compostable Knives", "Compostable Spoons", "Compostable Napkins", "Compostable Chopsticks", "Reusable Water Jugs"];
    for (const name of defaultCategories) {
      await db.collection('categories').add({ 
        name, is_requestable: 1, current_count: 0, total_procured: 0, total_checked_out: 0, low_stock_threshold: 100, is_deleted: false
      });
    }
  }

  const allCategoriesSnapshot = await db.collection('categories').get();
  const categoryMap: Record<string, string> = {};
  allCategoriesSnapshot.forEach(doc => { categoryMap[doc.data().name] = doc.id; });

  const inventorySnapshot = await db.collection('inventory').limit(1).get();
  if (inventorySnapshot.empty) {
    const items = [
      { item_number: 'sbl_dpx_dining-dinner-plates_B09KLY73YR_0', vendor: 'Amazon', type: 'Reusable', name: 'Stainless Steel Dining Plate', price: 17.99, pack_size: 10, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.amazon.com/dp/B09KLY73YR', is_deleted: false, kit_components: [{ category_id: categoryMap['Reusable Plates'], yield_multiplier: 1 }] },
      { item_number: 'GUSTO 10', vendor: 'Walmart', type: 'Compostable', name: 'Compostable Paper Plate', price: 29.49, pack_size: 125, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.walmart.com/search?q=GUSTO+10+Compostable+Plates', is_deleted: false, kit_components: [{ category_id: categoryMap['Compostable Plates'], yield_multiplier: 1 }] },
      { item_number: 'cm_sw_r_cp_ud_dp_80RH047CCY6K598Y1EQ7', vendor: 'Amazon', type: 'Reusable', name: 'Aluminum Cup', price: 259.99, pack_size: 600, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.amazon.com/dp/80RH047CCY', is_deleted: false, kit_components: [{ category_id: categoryMap['Reusable Cups'], yield_multiplier: 1 }] },
      { item_number: 'Wooden-Utensils-Ecovita', vendor: 'Walmart', type: 'Compostable', name: 'Eco Cuterly Combo', price: 59.00, pack_size: 1, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.walmart.com/search?q=Ecovita+Compostable+Cutlery', is_deleted: false, kit_components: [{ category_id: categoryMap['Compostable Forks'], yield_multiplier: 140 }, { category_id: categoryMap['Compostable Knives'], yield_multiplier: 120 }, { category_id: categoryMap['Compostable Spoons'], yield_multiplier: 120 }] },
      { item_number: 'ECO SOUL', vendor: 'Walmart', type: 'Compostable', name: 'Bamboo Paper Napkin', price: 59.95, pack_size: 4000, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.walmart.com/search?q=ECO+SOUL+Bamboo+Napkins', is_deleted: false, kit_components: [{ category_id: categoryMap['Compostable Napkins'], yield_multiplier: 1 }] },
      { item_number: 'Bmbo-chpstk', vendor: 'Walmart', type: 'Compostable', name: 'Bamboo Chopstick', price: 15.99, pack_size: 200, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.walmart.com/search?q=Bamboo+Chopsticks', is_deleted: false, kit_components: [{ category_id: categoryMap['Compostable Chopsticks'], yield_multiplier: 1 }] },
      { item_number: '180657001848', vendor: 'Amazon', type: 'Reusable', name: 'Gallon Long Term Water Storage Container', price: 185.95, pack_size: 6, current_count: 0, total_procured: 0, total_checked_out: 0, reorder_url: 'https://www.amazon.com/s?k=Gallon+Long+Term+Water+Storage', is_deleted: false, kit_components: [{ category_id: categoryMap['Reusable Water Jugs'], yield_multiplier: 1 }] }
    ];
    for (const item of items) {
      if (item.kit_components.every(comp => comp.category_id)) await db.collection('inventory').doc(item.item_number).set(item);
    }
  }

  const ordersSnapshot = await db.collection('orders').limit(1).get();
  if (ordersSnapshot.empty) {
    const initialOrders = [
      { order_number: "Walmart-001", order_name: "Walmart Initial", date_ordered: "2025-03-11", date_delivered: "2025-03-12", subtotal: 1108.54, shipping: 0, tax: 0, total: 1108.54, procurement_method: "Credit Card", logged_by: "Dylan Young", is_deleted: false, line_items: [{ item_number: "GUSTO 10", quantity: 16, price: 29.49 }, { item_number: "Wooden-Utensils-Ecovita", quantity: 3, price: 59 }, { item_number: "ECO SOUL", quantity: 1, price: 59.95 }, { item_number: "Bmbo-chpstk", quantity: 25, price: 15.99 }] },
      { order_number: "Amazon-001", order_name: "Amazon Initial", date_ordered: "2025-03-11", date_delivered: "2025-03-12", subtotal: 991.69, shipping: 0, tax: 0, total: 991.69, procurement_method: "Credit Card", logged_by: "Dylan Young", is_deleted: false, line_items: [{ item_number: "180657001848", quantity: 2, price: 185.95 }, { item_number: "sbl_dpx_dining-dinner-plates_B09KLY73YR_0", quantity: 20, price: 17.99 }, { item_number: "cm_sw_r_cp_ud_dp_80RH047CCY6K598Y1EQ7", quantity: 1, price: 259.99 }] }
    ];
    for (const order of initialOrders) {
      await db.collection('orders').doc(order.order_number).set(order);
      for (const line_item of order.line_items) {
        const invSnapshot = await db.collection('inventory').where('item_number', '==', line_item.item_number).limit(1).get();
        if (!invSnapshot.empty) {
          const vendorItem = invSnapshot.docs[0].data();
          const packSize = vendorItem.pack_size || 1;
          for (const component of vendorItem.kit_components || []) {
            const totalAdded = line_item.quantity * packSize * (component.yield_multiplier || 1);
            await db.collection('categories').doc(String(component.category_id)).update({ current_count: FieldValue.increment(totalAdded), total_procured: FieldValue.increment(totalAdded) });
          }
        }
      }
    }
  }
}