import { db } from '../db'
import { normalizeItemSearchText } from './itemMatch'

export interface CatalogPriceEntry {
  name: string
  variant: string
  category: string
  cost: number | null
  sell: number | null
}

// Mattresses are deliberately excluded here -- this shop's mattress
// variants already use its own naming ("Star Special", etc.) that doesn't
// map cleanly onto this generic list's grade vocabulary (Simple/Special/
// Elegance/Premium), so an automated match would risk creating confusing
// duplicate variants instead of filling the real ones. Fill those by hand
// via Stock -> Fill Missing Costs.
export const CATALOG_PRICE_FILL: CatalogPriceEntry[] = [
  { name: 'Zinc', variant: '14G', category: 'Roofing', cost: 48, sell: null },
  { name: 'Zinc', variant: '32G', category: 'Roofing', cost: 72, sell: null },
  { name: 'Zinc', variant: '28G', category: 'Roofing', cost: 105, sell: null },
  { name: 'Zinc', variant: 'Gutter', category: 'Roofing', cost: 125, sell: null },
  { name: 'Carboline', variant: '', category: 'Roofing', cost: null, sell: 10 },

  { name: 'Wire — Grey Chinese', variant: '1.5mm #14', category: 'Wire', cost: 15, sell: null },
  { name: 'Wire — Grey Chinese', variant: '2.5mm #12', category: 'Wire', cost: 6, sell: null },
  { name: 'Wire — Grey Chinese', variant: '4mm #10', category: 'Wire', cost: 22, sell: null },
  { name: 'Wire — Havells Copper', variant: '1.5mm #14', category: 'Wire', cost: 30, sell: null },
  { name: 'Wire — Havells Copper', variant: '2.5mm #12', category: 'Wire', cost: 40, sell: null },
  { name: 'Wire — Havells Copper', variant: '4mm #10', category: 'Wire', cost: 60, sell: null },
  { name: 'Wire — Havells Copper', variant: '10mm² #8', category: 'Wire', cost: 140, sell: null },
  { name: 'Fence Wire', variant: '2.5mm', category: 'Wire', cost: 70, sell: null },
  { name: 'Tie Wire', variant: '', category: 'Wire', cost: 4, sell: null },
  { name: 'Wire Clip', variant: '#12', category: 'Wire', cost: 1, sell: null },
  { name: 'Wire Clip', variant: '#10', category: 'Wire', cost: 2, sell: null },

  { name: 'Solar', variant: 'Battery 220A', category: 'Solar & Power', cost: 200, sell: 325 },
  { name: 'Solar', variant: 'Plate 620W', category: 'Solar & Power', cost: 100, sell: null },
  { name: 'Solar', variant: 'Wire', category: 'Solar & Power', cost: null, sell: null },
  { name: 'Solar', variant: 'Charge Controller 30A', category: 'Solar & Power', cost: null, sell: null },
  { name: 'Solar', variant: 'Full Set — 2 Bat 2 Plate', category: 'Solar & Power', cost: null, sell: 1650 },
  { name: 'Inverter', variant: '2000W', category: 'Solar & Power', cost: null, sell: null },
  { name: 'Generator Total', variant: '3.0KVA', category: 'Solar & Power', cost: 290, sell: null },
  { name: 'Generator Total', variant: '3.5KVA', category: 'Solar & Power', cost: 320, sell: null },
  { name: 'Stabilizer', variant: '500W', category: 'Solar & Power', cost: 15, sell: null },

  { name: 'TV', variant: '32" Regular Amaz', category: 'TV & Audio', cost: 75, sell: null },
  { name: 'TV', variant: '32" Smart Vombat', category: 'TV & Audio', cost: 105, sell: null },
  { name: 'TV', variant: '43" Regular H20', category: 'TV & Audio', cost: 150, sell: null },
  { name: 'TV', variant: '43" Smart Amaz', category: 'TV & Audio', cost: 175, sell: null },
  { name: 'TV', variant: '55" Smart Masa', category: 'TV & Audio', cost: 300, sell: null },
  { name: 'TV', variant: '65" Smart Icona', category: 'TV & Audio', cost: 420, sell: null },
  { name: 'Speaker', variant: 'Roch 3.1', category: 'TV & Audio', cost: 30, sell: null },
  { name: 'Speaker', variant: 'Roch 5.1', category: 'TV & Audio', cost: 90, sell: null },
  { name: 'Speaker', variant: 'EV', category: 'TV & Audio', cost: 180, sell: null },
  { name: 'Mixer', variant: '4 channel', category: 'TV & Audio', cost: 100, sell: null },
  { name: 'Microphone', variant: '', category: 'TV & Audio', cost: 30, sell: null },
  { name: 'DVD Desk', variant: 'Icona', category: 'TV & Audio', cost: null, sell: 30 },

  { name: 'Freezer', variant: '120L (S)', category: 'Cooling', cost: 150, sell: null },
  { name: 'Freezer', variant: '180L Vombat', category: 'Cooling', cost: 180, sell: null },
  { name: 'Freezer', variant: 'Vombat medium', category: 'Cooling', cost: 190, sell: null },
  { name: 'Freezer', variant: '200L', category: 'Cooling', cost: 220, sell: null },
  { name: 'Freezer', variant: '250L Roch', category: 'Cooling', cost: 250, sell: null },
  { name: 'Freezer', variant: 'Nexon 310L', category: 'Cooling', cost: 220, sell: null },
  { name: 'Freezer', variant: 'Icona 285L', category: 'Cooling', cost: null, sell: null },
  { name: 'Freezer', variant: 'Double Door Icona 500L', category: 'Cooling', cost: 430, sell: null },
  { name: 'Freezer', variant: 'Double Door Iceman', category: 'Cooling', cost: 520, sell: null },
  { name: 'Refrigerator', variant: 'Single Door Icona', category: 'Cooling', cost: 105, sell: null },
  { name: 'Refrigerator', variant: 'Double Door Icona 100L', category: 'Cooling', cost: 130, sell: null },
  { name: 'Refrigerator', variant: 'Double Door Roch 230L', category: 'Cooling', cost: 240, sell: null },

  { name: 'Washing Machine', variant: '', category: 'Appliance', cost: 150, sell: null },
  { name: 'Microwave', variant: '', category: 'Appliance', cost: 50, sell: null },
  { name: 'Popcorn Machine', variant: '', category: 'Appliance', cost: 105, sell: null },
  { name: 'Blender', variant: 'Bosstech multi purpose', category: 'Appliance', cost: 22, sell: null },
  { name: 'Standing Fan', variant: 'JPL', category: 'Appliance', cost: 20, sell: null },
  { name: 'Hot Plate Stove', variant: 'Electric', category: 'Appliance', cost: null, sell: 15 },
  { name: 'Pressing Iron', variant: 'Electric', category: 'Appliance', cost: 8, sell: null },
  { name: 'Kettle', variant: 'Whistling', category: 'Appliance', cost: 15, sell: null },
  { name: 'Pregulator', variant: 'Simple', category: 'Appliance', cost: 5, sell: null },
  { name: 'Pregulator', variant: 'Tea kettle', category: 'Appliance', cost: 6, sell: null },
  { name: 'Pregulator', variant: 'Long', category: 'Appliance', cost: 10, sell: null },
  { name: 'Flask Exco', variant: 'Small', category: 'Appliance', cost: 5, sell: null },
  { name: 'Flask Exco', variant: 'Medium', category: 'Appliance', cost: 7.5, sell: null },
  { name: 'Flask Exco', variant: 'Big', category: 'Appliance', cost: 9, sell: null },
  { name: 'Standing Mirror', variant: 'Small', category: 'Appliance', cost: 20, sell: null },

  { name: 'Chair', variant: 'Design Armless', category: 'Furniture', cost: 6.75, sell: null },
  { name: 'Chair', variant: 'Armless', category: 'Furniture', cost: 6.75, sell: null },
  { name: 'Chair', variant: 'LD', category: 'Furniture', cost: 6.5, sell: null },
  { name: 'Chair', variant: 'HD', category: 'Furniture', cost: 10.75, sell: null },
  { name: 'Chair', variant: 'Box', category: 'Furniture', cost: 8, sell: null },
  { name: 'Chair', variant: 'Sponge', category: 'Furniture', cost: 13, sell: null },
  { name: 'Chair Set', variant: '4 Design Armless + Table', category: 'Furniture', cost: null, sell: 80 },
  { name: 'Wardrobe Stand', variant: '', category: 'Furniture', cost: 15, sell: null },

  { name: 'Lock — Iron Door', variant: '2 Turn Mecco', category: 'Locks', cost: 2.5, sell: null },
  { name: 'Lock — Iron Door', variant: '3 Turn Mecco', category: 'Locks', cost: 2.5, sell: null },
  { name: 'Lock — Iron Door', variant: '3 Turn CK', category: 'Locks', cost: 4, sell: null },
  { name: 'Lock — Iron Door', variant: '6 Turn Hi-tech', category: 'Locks', cost: 8, sell: null },
  { name: 'Lock — Iron Door', variant: '6 Turn Solex HD', category: 'Locks', cost: 25, sell: null },
  { name: 'Lock — Iron Door', variant: '6 Turn Yale HD', category: 'Locks', cost: 45, sell: null },
  { name: 'Lock — Panel Door', variant: 'GJS', category: 'Locks', cost: 8, sell: 25 },
  { name: 'Lock — Panel Door', variant: 'Liney', category: 'Locks', cost: 8, sell: 25 },
  { name: 'Lock — Panel Door', variant: 'Wista', category: 'Locks', cost: 10, sell: 25 },
  { name: 'Lock — Plywood Door', variant: 'GJS', category: 'Locks', cost: 6, sell: null },
  { name: 'Padlock', variant: 'Cica 70mm', category: 'Locks', cost: 4, sell: null },

  { name: 'Bulb', variant: '5W', category: 'Electrical', cost: 0.5, sell: null },
  { name: 'Bulb', variant: '15W', category: 'Electrical', cost: 0.8, sell: null },
  { name: 'Bulb', variant: '18W Peace', category: 'Electrical', cost: 1, sell: null },
  { name: 'Bulb', variant: 'Rechargeable', category: 'Electrical', cost: 2, sell: null },
  { name: 'Switch', variant: 'Single', category: 'Electrical', cost: 1, sell: null },
  { name: 'Switch', variant: 'Double', category: 'Electrical', cost: 1, sell: null },
  { name: 'Receptacle', variant: '', category: 'Electrical', cost: 1, sell: null },
  { name: 'Socket', variant: '', category: 'Electrical', cost: 0.5, sell: null },
  { name: 'Utility Cup', variant: '', category: 'Electrical', cost: 0.5, sell: null },
  { name: 'Panel Box', variant: '2 Breaker', category: 'Electrical', cost: 20, sell: null },
  { name: 'Panel Box', variant: '4 Breaker', category: 'Electrical', cost: 45, sell: null },
  { name: 'Panel Box', variant: '6 Breaker', category: 'Electrical', cost: 65, sell: null },
  { name: 'Panel Box', variant: '8 Breaker', category: 'Electrical', cost: 85, sell: null },
  { name: 'Panel Box', variant: '12 Breaker', category: 'Electrical', cost: 120, sell: null },
  { name: 'Lightning Rod', variant: '', category: 'Electrical', cost: 8, sell: null },

  { name: 'Paint', variant: 'White wash', category: 'Paint', cost: 8.5, sell: null },
  { name: 'Paint', variant: 'Water — colour', category: 'Paint', cost: 30, sell: null },
  { name: 'Paint', variant: 'Water — white', category: 'Paint', cost: 27, sell: null },
  { name: 'Paint', variant: 'Oil', category: 'Paint', cost: 58, sell: null },
  { name: 'Colouring', variant: '12 pcs', category: 'Paint', cost: 7.5, sell: null },

  { name: 'Tiles', variant: '8x12 (16 pcs)', category: 'Tiles & Wallpaper', cost: 4.5, sell: null },
  { name: 'Tiles', variant: '12x12 (11 pcs)', category: 'Tiles & Wallpaper', cost: 5.5, sell: null },
  { name: 'Tiles', variant: '12x18 (6 pcs)', category: 'Tiles & Wallpaper', cost: 6.5, sell: null },
  { name: 'Tiles', variant: '12x24 (5 pcs)', category: 'Tiles & Wallpaper', cost: 7.5, sell: null },
  { name: 'Tiles', variant: '16x16 (6 pcs)', category: 'Tiles & Wallpaper', cost: 6.5, sell: null },
  { name: 'Tiles', variant: '24x24 (4 pcs)', category: 'Tiles & Wallpaper', cost: 13, sell: null },
  { name: 'Wallpaper', variant: 'Roll 10 ft', category: 'Tiles & Wallpaper', cost: 15, sell: null },
  { name: 'Wallpaper', variant: 'Roll 3 ft', category: 'Tiles & Wallpaper', cost: 12, sell: null },
  { name: 'Floor Matt', variant: 'LD', category: 'Tiles & Wallpaper', cost: 20, sell: null },

  { name: 'Wheelbarrow', variant: 'Euro', category: 'Tools', cost: 25, sell: null },
  { name: 'Wheelbarrow', variant: 'Nafa', category: 'Tools', cost: 40, sell: null },
  { name: 'Wheelbarrow', variant: 'Grey Crocodile', category: 'Tools', cost: 36, sell: null },
  { name: 'Wheelbarrow', variant: 'Grey Boroko', category: 'Tools', cost: 40, sell: null },
  { name: 'Wheelbarrow', variant: 'Total', category: 'Tools', cost: 36, sell: null },
  { name: 'Barrow Tire', variant: 'Nigerian', category: 'Tools', cost: 13, sell: null },
  { name: 'Barrow Tire', variant: 'Rim LD', category: 'Tools', cost: 8, sell: null },
  { name: 'Barrow Tire', variant: 'HD', category: 'Tools', cost: 12, sell: null },
  { name: 'Screw with Washer', variant: 'A', category: 'Tools', cost: 1, sell: null },
  { name: 'Screw with Washer', variant: 'B', category: 'Tools', cost: 2, sell: null },
  { name: 'Glue', variant: 'Type 99 Elephant Red', category: 'Tools', cost: 10, sell: null },
  { name: 'Glue', variant: 'Euroflex', category: 'Tools', cost: 15, sell: null },
  { name: 'Hose Pipe', variant: 'Red 1" 50 m', category: 'Tools', cost: 1, sell: null },
  { name: 'Engine Oil Hi-Tech', variant: 'SAE 50 — 5L', category: 'Tools', cost: 11, sell: null },
  { name: 'Raincoat', variant: '', category: 'Tools', cost: 7, sell: null },
]

export interface CatalogFillResult {
  filled: number
  created: number
  alreadyHadValues: number
}

// Exact-normalized-name matching only -- deliberately conservative. Never
// overwrites a cost/sell that's already non-zero; only ever fills a blank.
// Anything not found among existing products gets created (product +
// variant) since the caller listed it as something they sell.
export async function fillCatalogPrices(): Promise<CatalogFillResult> {
  let filled = 0
  let created = 0
  let alreadyHadValues = 0

  await db.transaction('rw', db.products, db.variants, async () => {
    const products = await db.products.toArray()
    const now = Date.now()

    for (const entry of CATALOG_PRICE_FILL) {
      const normName = normalizeItemSearchText(entry.name)
      let product = products.find((p) => !p.archived && normalizeItemSearchText(p.name) === normName)

      if (!product) {
        const productId = (await db.products.add({
          name: entry.name,
          category: entry.category,
          description: '',
          images: [],
          options: [],
          archived: false,
          createdAt: now,
          updatedAt: now,
        })) as number
        product = { id: productId, name: entry.name, category: entry.category, description: '', images: [], options: [], archived: false, createdAt: now, updatedAt: now }
        products.push(product)
      }

      const variantLabel = entry.variant.trim() || 'Standard'
      const normVariant = normalizeItemSearchText(variantLabel)
      const existingVariants = await db.variants.where('productId').equals(product.id!).toArray()
      const variant = existingVariants.find((v) => normalizeItemSearchText(v.label) === normVariant)

      if (!variant) {
        await db.variants.add({
          productId: product.id!,
          label: variantLabel,
          optionValues: [],
          costPrice: entry.cost ?? 0,
          costUnknown: entry.cost == null,
          sellPrice: entry.sell ?? 0,
          currency: 'USD',
          stockMyShop: 0,
          stockVishalShop: 0,
          lowStockThreshold: 3,
          order: existingVariants.length,
          createdAt: now,
          updatedAt: now,
        })
        created++
        continue
      }

      const patch: Partial<{ costPrice: number; costUnknown: boolean; sellPrice: number }> = {}
      if (entry.cost != null && (variant.costUnknown || !variant.costPrice)) {
        patch.costPrice = entry.cost
        patch.costUnknown = false
      }
      if (entry.sell != null && !variant.sellPrice) {
        patch.sellPrice = entry.sell
      }
      if (Object.keys(patch).length > 0) {
        await db.variants.update(variant.id!, { ...patch, updatedAt: now })
        filled++
      } else {
        alreadyHadValues++
      }
    }
  })

  return { filled, created, alreadyHadValues }
}
