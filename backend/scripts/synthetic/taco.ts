// TACO dataset ingestion + category → CleanCentive label mapping.
//
// TACO (http://tacodataset.org) is a COCO-format litter dataset. We read its
// annotations.json, keep only images whose file is present on disk, and map each
// of the 60 TACO categories onto our seeded object/material label names (every
// name below exists in backend/src/label/seed/labels.json) plus a base weight.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TacoImage {
  fileName: string; // e.g. "batch_1/000006.jpg"
  absPath: string;
  width: number;
  height: number;
  categoryIds: number[];
}

export interface CategoryMapEntry {
  object: string | null; // object label en-name (or null when no good fit)
  material: string | null; // material label en-name
  weightG: number; // typical weight in grams
}

// TACO category id (0–59) → label mapping. object/material names MUST match
// labels.json exactly (resolution is by lower-cased en-name).
export const CATEGORY_MAP: Record<number, CategoryMapEntry> = {
  0: { object: 'Wrapper', material: 'Aluminum', weightG: 3 }, // Aluminium foil
  1: { object: 'Battery', material: 'Metal', weightG: 20 },
  2: { object: 'Blister Pack', material: 'Aluminum', weightG: 3 },
  3: { object: 'Blister Pack', material: 'Plastic', weightG: 5 },
  4: { object: 'Bottle', material: 'Plastic', weightG: 25 },
  5: { object: 'Bottle', material: 'Plastic', weightG: 22 },
  6: { object: 'Bottle', material: 'Glass', weightG: 300 },
  7: { object: 'Bottle Cap', material: 'Plastic', weightG: 3 },
  8: { object: 'Bottle Cap', material: 'Metal', weightG: 3 },
  9: { object: null, material: 'Glass', weightG: 15 }, // Broken glass
  10: { object: 'Can', material: 'Metal', weightG: 60 },
  11: { object: 'Can', material: 'Metal', weightG: 40 }, // Aerosol
  12: { object: 'Can', material: 'Aluminum', weightG: 15 }, // Drink can
  13: { object: 'Carton', material: 'Cardboard', weightG: 6 }, // Toilet tube
  14: { object: 'Carton', material: 'Cardboard', weightG: 20 },
  15: { object: 'Carton', material: 'Cardboard', weightG: 25 }, // Egg carton
  16: { object: 'Carton', material: 'Paperboard', weightG: 30 }, // Drink carton
  17: { object: 'Box', material: 'Cardboard', weightG: 50 }, // Corrugated carton
  18: { object: 'Food Container', material: 'Cardboard', weightG: 30 }, // Meal carton
  19: { object: 'Box', material: 'Cardboard', weightG: 120 }, // Pizza box
  20: { object: 'Cup', material: 'Paper', weightG: 10 },
  21: { object: 'Cup', material: 'Plastic', weightG: 8 },
  22: { object: 'Cup', material: 'Styrofoam', weightG: 5 },
  23: { object: 'Cup', material: 'Glass', weightG: 150 },
  24: { object: 'Cup', material: 'Plastic', weightG: 8 },
  25: { object: null, material: null, weightG: 50 }, // Food waste
  26: { object: 'Food Container', material: 'Glass', weightG: 200 }, // Glass jar
  27: { object: 'Lid', material: 'Plastic', weightG: 3 },
  28: { object: 'Lid', material: 'Metal', weightG: 5 },
  29: { object: null, material: 'Plastic', weightG: 10 }, // Other plastic
  30: { object: null, material: 'Paper', weightG: 30 }, // Magazine paper
  31: { object: 'Tissue', material: 'Paper', weightG: 2 },
  32: { object: 'Wrapper', material: 'Paper', weightG: 5 }, // Wrapping paper
  33: { object: null, material: 'Paper', weightG: 5 }, // Normal paper
  34: { object: 'Bag', material: 'Paper', weightG: 10 },
  35: { object: 'Bag', material: 'Paper', weightG: 12 },
  36: { object: 'Wrapper', material: 'Plastic', weightG: 3 }, // Plastic film
  37: { object: 'Packaging', material: 'Plastic', weightG: 5 }, // Six pack rings
  38: { object: 'Bag', material: 'Plastic', weightG: 25 }, // Garbage bag
  39: { object: 'Wrapper', material: 'Plastic', weightG: 3 },
  40: { object: 'Bag', material: 'Plastic', weightG: 8 },
  41: { object: 'Bag', material: 'Plastic', weightG: 8 },
  42: { object: 'Packet', material: 'Plastic', weightG: 4 }, // Crisp packet
  43: { object: 'Food Container', material: 'Plastic', weightG: 20 }, // Spread tub
  44: { object: 'Food Container', material: 'Plastic', weightG: 80 }, // Tupperware
  45: { object: 'Food Container', material: 'Plastic', weightG: 25 },
  46: { object: 'Food Container', material: 'Styrofoam', weightG: 12 },
  47: { object: 'Food Container', material: 'Plastic', weightG: 20 },
  48: { object: 'Glove', material: 'Latex', weightG: 5 },
  49: { object: 'Utensil', material: 'Plastic', weightG: 5 },
  50: { object: null, material: 'Aluminum', weightG: 1 }, // Pop tab
  51: { object: 'Rope', material: 'Plastic', weightG: 30 },
  52: { object: null, material: 'Metal', weightG: 100 }, // Scrap metal
  53: { object: 'Shoe', material: 'Rubber', weightG: 300 },
  54: { object: 'Packaging', material: 'Plastic', weightG: 30 }, // Squeezable tube
  55: { object: 'Straw', material: 'Plastic', weightG: 1 },
  56: { object: 'Straw', material: 'Paper', weightG: 1 },
  57: { object: null, material: 'Styrofoam', weightG: 3 }, // Styrofoam piece
  58: { object: null, material: null, weightG: 10 }, // Unlabeled litter
  59: { object: 'Cigarette Butt', material: null, weightG: 1 },
};

// Beverage-ish object names that occasionally carry a brand.
export const BRANDABLE_OBJECTS = new Set(['Bottle', 'Can', 'Cup']);

interface TacoAnnotationsFile {
  images: Array<{ id: number; width: number; height: number; file_name: string }>;
  annotations: Array<{ image_id: number; category_id: number }>;
}

// Load TACO images that are actually present on disk (the public dataset ships
// images across many batches; a local checkout may only contain some of them).
export function loadTaco(tacoRoot: string, maxImages?: number): TacoImage[] {
  const dataDir = join(tacoRoot, 'data');
  const annPath = join(dataDir, 'annotations.json');
  if (!existsSync(annPath)) {
    throw new Error(`TACO annotations not found at ${annPath} (set --taco-path to the TACO checkout root)`);
  }
  const ann = JSON.parse(readFileSync(annPath, 'utf8')) as TacoAnnotationsFile;

  const catsByImage = new Map<number, number[]>();
  for (const a of ann.annotations) {
    const arr = catsByImage.get(a.image_id);
    if (arr) arr.push(a.category_id);
    else catsByImage.set(a.image_id, [a.category_id]);
  }

  const images: TacoImage[] = [];
  for (const img of ann.images) {
    const absPath = join(dataDir, img.file_name);
    if (!existsSync(absPath)) continue; // skip images not present locally
    images.push({
      fileName: img.file_name,
      absPath,
      width: img.width,
      height: img.height,
      categoryIds: catsByImage.get(img.id) ?? [],
    });
  }

  // Stable order so selection is deterministic regardless of JSON ordering.
  images.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));

  if (images.length === 0) {
    throw new Error(`No TACO image files found under ${dataDir}. Check the dataset path.`);
  }
  return typeof maxImages === 'number' && maxImages > 0 ? images.slice(0, maxImages) : images;
}
