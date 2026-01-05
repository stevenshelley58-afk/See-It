// Test products - replace image URLs with real BHM product images
// For testing, you can use any product PNG with transparent background
export const TEST_PRODUCTS = [
  {
    id: 'floor-mirror-1',
    title: 'Reclaimed Teak Floor Mirror',
    description: 'Hand-carved reclaimed teak frame with natural grain variations. Floor-standing design leans against wall. Artisan-crafted in Rajasthan.',
    type: 'mirror',
    placementHint: 'Floor-standing, leans against wall',
    // Replace with actual product image URL (PNG with transparent background works best)
    image: 'https://cdn.shopify.com/s/files/1/0557/8088/5287/files/floor-mirror-sample.png',
  },
  {
    id: 'console-table-1', 
    title: 'Teak Console Table',
    description: 'Solid reclaimed teak console table with hand-forged iron base. Natural wood finish showcases unique grain patterns.',
    type: 'table',
    placementHint: 'Against wall, typically in entryway or hallway',
    image: 'https://cdn.shopify.com/s/files/1/0557/8088/5287/files/console-table-sample.jpg',
  },
  {
    id: 'dining-table-1',
    title: 'Farmhouse Dining Table',
    description: 'Large reclaimed teak dining table seats 6-8. Rustic finish with natural imperfections. Solid wood construction.',
    type: 'table',
    placementHint: 'Center of dining area, needs clearance for chairs',
    image: 'https://cdn.shopify.com/s/files/1/0557/8088/5287/files/dining-table-sample.jpg',
  },
  {
    id: 'accent-chair-1',
    title: 'Rattan Accent Chair',
    description: 'Hand-woven rattan chair with solid teak frame. Natural finish. Comfortable lounge seating.',
    type: 'chair',
    placementHint: 'Corner placement or beside sofa',
    image: 'https://cdn.shopify.com/s/files/1/0557/8088/5287/files/accent-chair-sample.jpg',
  },
];

// Placement variants for parallel generation
export const PLACEMENT_VARIANTS = [
  {
    id: 'centered',
    hint: 'Place naturally, centered in the most open floor space',
  },
  {
    id: 'wall',
    hint: 'Place against the main wall, slightly off-center for visual interest',
  },
  {
    id: 'natural-light',
    hint: 'Place near the window or brightest area to catch natural light',
  },
  {
    id: 'corner',
    hint: 'Place in the emptiest corner area of the room',
  },
];
