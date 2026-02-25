import { Firestore, FieldValue } from '@google-cloud/firestore';

export const db = new Firestore();
export { FieldValue };

export async function initDb() {
  // Check if users collection is empty
  const usersSnapshot = await db.collection('users').limit(1).get();
  
  if (usersSnapshot.empty) {
    // Seed users
    const users = [
      { username: 'dyoung', password: 'OSCER2026', full_name: 'Dylan Young' },
      { username: 'kobermaier', password: 'OSCER2026', full_name: 'Kobermaier' },
      { username: 'Jrosas', password: 'OSCER2026', full_name: 'Jrosas' },
      { username: 'oscer', password: 'OSCER2026', full_name: 'OSCER' }
    ];
    
    for (const user of users) {
      await db.collection('users').add(user);
    }
  }

  // Check if categories collection is empty
  const categoriesSnapshot = await db.collection('categories').limit(1).get();
  if (categoriesSnapshot.empty) {
    const defaultCategories = [
      "Reusable Plates",
      "Compostable Plates",
      "Reusable Cups",
      "Compostable Forks",
      "Compostable Knives",
      "Compostable Spoons",
      "Compostable Napkins",
      "Compostable Chopsticks",
      "Reusable Water Jugs"
    ];
    for (const name of defaultCategories) {
      await db.collection('categories').add({ 
        name, 
        is_requestable: 1,
        current_count: 0,
        total_procured: 0,
        total_checked_out: 0
      });
    }
  }

  // Fetch all categories to map names to IDs
  const allCategoriesSnapshot = await db.collection('categories').get();
  const categoryMap: Record<string, string> = {};
  allCategoriesSnapshot.forEach(doc => {
    categoryMap[doc.data().name] = doc.id;
  });

  // Check if inventory collection is empty
  const inventorySnapshot = await db.collection('inventory').limit(1).get();
  if (inventorySnapshot.empty) {
    const inventoryItems = [
      {
        item_number: 'sbl_dpx_dining-dinner-plates_B09KLY73YR_0',
        vendor: 'Amazon',
        type: 'Reusable',
        name: 'Stainless Steel Dining Plate',
        price: 17.99,
        pack_size: 1,
        kit_components: [
          { category_id: categoryMap['Reusable Plates'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: 'GUSTO 10',
        vendor: 'Walmart',
        type: 'Compostable',
        name: 'Compostable Paper Plate',
        price: 29.49,
        pack_size: 125,
        kit_components: [
          { category_id: categoryMap['Compostable Plates'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: 'cm_sw_r_cp_ud_dp_80RH047CCY6K598Y1EQ7',
        vendor: 'Amazon',
        type: 'Reusable',
        name: 'Aluminum Cup',
        price: 259.99,
        pack_size: 1,
        kit_components: [
          { category_id: categoryMap['Reusable Cups'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: 'Wooden-Utensils-Ecovita',
        vendor: 'Walmart',
        type: 'Compostable',
        name: 'Eco Cutlery Combo',
        price: 59.00,
        pack_size: 380,
        kit_components: [
          { category_id: categoryMap['Compostable Forks'], yield_multiplier: 1 },
          { category_id: categoryMap['Compostable Knives'], yield_multiplier: 1 },
          { category_id: categoryMap['Compostable Spoons'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: 'ECO SOUL',
        vendor: 'Walmart',
        type: 'Compostable',
        name: 'Bamboo Paper Napkin',
        price: 59.95,
        pack_size: 4000,
        kit_components: [
          { category_id: categoryMap['Compostable Napkins'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: 'Bmbo-chpstk',
        vendor: 'Walmart',
        type: 'Compostable',
        name: 'Bamboo Chopstick',
        price: 15.99,
        pack_size: 200,
        kit_components: [
          { category_id: categoryMap['Compostable Chopsticks'], yield_multiplier: 1 }
        ]
      },
      {
        item_number: '180657001848',
        vendor: 'Amazon',
        type: 'Reusable',
        name: 'Gallon Water Jug',
        price: 185.95,
        pack_size: 1,
        kit_components: [
          { category_id: categoryMap['Reusable Water Jugs'], yield_multiplier: 1 }
        ]
      }
    ];

    for (const item of inventoryItems) {
      await db.collection('inventory').doc(item.item_number).set(item);
    }
  }
}
