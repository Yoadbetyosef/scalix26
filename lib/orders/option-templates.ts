// Starter sets for the order dropdowns, offered once when a tenant has no lists yet.
//
// A template is only ever applied because someone picked it — nothing is seeded automatically. That
// matters for two reasons: a locksmith enabling Orders must not silently acquire diamond clarity grades,
// and a tenant who deletes a list must find it stays deleted.
//
// Adding a trade = adding an entry here. Nothing in the schema, the API or the UI knows what a diamond is.

import { PRODUCT_TYPE_OPTIONS } from './product-types'

export interface OptionTemplateList { key: string; label: string; options: string[] }
export interface OptionTemplate { id: string; name: string; description: string; lists: OptionTemplateList[] }

// Keys used by the jewelry line-item fields (components/orders/line-item-fields.tsx). They only mean
// anything to that form — any other list a tenant creates is theirs to name freely.
export const JEWELRY_LIST_KEYS = [
  'product_type', 'length',
  'stone_quality', 'stone_color', 'stone_origin', 'stone_type',
  'center_stone_shape', 'side_stone_shape', 'metal_karat',
  'certificate_lab', 'ring_size',
] as const

const SHAPES = ['Round', 'Oval', 'Princess', 'Cushion', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Asscher', 'Heart', 'Trillion', 'Baguette']

// US ring sizes 3 through 12 in quarter steps. Whole sizes print bare ("4"), quarters keep two decimals
// ("4.25", "4.50") so the open dropdown reads as one column instead of a ragged mix.
const RING_SIZES = Array.from({ length: 37 }, (_, i) => 3 + i * 0.25)
  .map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(2)))

export const OPTION_TEMPLATES: OptionTemplate[] = [
  {
    id: 'jewelry',
    name: 'Jewelry',
    description: 'Stone quality and colour, natural vs lab grown, stone types, shapes, and gold karats.',
    lists: [
      // WHAT THE PIECE IS, first, because it decides which of the rest are even asked for. The list is
      // hers from the moment it is created: she adds "Anklet" in Settings and it appears on the form,
      // showing every field until somebody describes what an anklet needs.
      { key: 'product_type', label: 'Piece type', options: [...PRODUCT_TYPE_OPTIONS] },
      // Necklace and bracelet lengths. TG had already built this list herself and named it after a
      // product ("Timeless Dreams Riviera Diamond Necklace") — the right instinct with nowhere to go,
      // because the form only rendered the keys it knew. Now it is one of them.
      { key: 'length', label: 'Length', options: ["14''", "16''", "17''", "18''", "20''", "22''", "24''", "6.5''", "7''", "7.5''", "8''"] },
      { key: 'stone_quality', label: 'Stone quality', options: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'] },
      { key: 'stone_color', label: 'Stone colour', options: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'Fancy Yellow', 'Fancy Pink', 'Fancy Blue'] },
      { key: 'stone_origin', label: 'Natural or Lab Grown', options: ['Natural', 'Lab Grown'] },
      { key: 'stone_type', label: 'Stone type', options: ['Diamond', 'Ruby', 'Sapphire', 'Emerald', 'Moissanite', 'Aquamarine', 'Tanzanite', 'Morganite', 'Amethyst', 'Topaz', 'Garnet', 'Peridot', 'Tourmaline', 'Opal', 'Pearl'] },
      { key: 'center_stone_shape', label: 'Center stone shape', options: SHAPES },
      { key: 'side_stone_shape', label: 'Side stone shape', options: [...SHAPES, 'Tapered Baguette'] },
      { key: 'metal_karat', label: 'Gold karat / metal', options: ['10K Yellow Gold', '10K White Gold', '10K Rose Gold', '14K Yellow Gold', '14K White Gold', '14K Rose Gold', '18K Yellow Gold', '18K White Gold', '18K Rose Gold', 'Platinum', 'Sterling Silver'] },
      { key: 'certificate_lab', label: 'Certificate lab', options: ['GIA', 'HRD', 'IGI', 'EGL'] },
      { key: 'ring_size', label: 'Ring size', options: RING_SIZES },
    ],
  },
  {
    // Deliberately shallow. Filling this with invented specifics for a trade nobody has described yet
    // would be guesswork the tenant then has to undo — better to hand over three obvious lists and let
    // them build the rest, which the manager screen supports directly.
    id: 'general',
    name: 'General trade',
    description: 'Three common lists — material, finish and size — as a starting point to edit and build on.',
    lists: [
      { key: 'material', label: 'Material', options: ['Steel', 'Stainless steel', 'Brass', 'Aluminium', 'Wood', 'Plastic', 'Glass'] },
      { key: 'finish', label: 'Finish', options: ['Polished', 'Brushed', 'Matte', 'Powder-coated', 'Painted', 'Anodised'] },
      { key: 'size', label: 'Size', options: ['Small', 'Medium', 'Large', 'Custom'] },
    ],
  },
]

export const templateById = (id: string): OptionTemplate | undefined => OPTION_TEMPLATES.find((t) => t.id === id)

// A machine key derived from a tenant-typed list name, e.g. "Handle type" → "handle_type". Uniqueness is
// enforced by the DB (tenant_id, key); the caller disambiguates on conflict.
export const keyFromLabel = (label: string): string =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'list'
