import { unitPrice, type PublicItem, type Selection } from "../business/BusinessService";

/**
 * A basket line: one item with one set of choices. A full dosa with ghee and a
 * half dosa are two lines. Prices here are for showing only; the database
 * prices every line again when the order is placed.
 */
export interface CartLine {
  key: string;
  itemId: string;
  qty: number;
  selection: Selection;
}

const sorted = (sel: Selection) => [...sel].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

export const lineKey = (itemId: string, sel: Selection) => `${itemId}|${sorted(sel).map(([g, c]) => `${g}.${c}`).join(",")}`;

export function addToCart(lines: CartLine[], itemId: string, selection: Selection, by: number): CartLine[] {
  const key = lineKey(itemId, selection);
  const found = lines.find((l) => l.key === key);
  if (!found) return by > 0 ? [...lines, { key, itemId, qty: Math.min(20, by), selection: sorted(selection) }] : lines;
  const qty = Math.max(0, Math.min(20, found.qty + by));
  return qty ? lines.map((l) => (l.key === key ? { ...l, qty } : l)) : lines.filter((l) => l.key !== key);
}

/** Take one away from the most recently added line of an item. */
export function removeOne(lines: CartLine[], itemId: string): CartLine[] {
  const last = [...lines].reverse().find((l) => l.itemId === itemId);
  return last ? addToCart(lines, itemId, last.selection, -1) : lines;
}

export const countOf = (lines: CartLine[], itemId: string) => lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);

export const linePrice = (item: PublicItem, sel: Selection) => unitPrice(Math.round(item.priceRupees * 100), item.options, sel) / 100;

export const optionLabels = (item: PublicItem, sel: Selection) =>
  sel.map(([g, c]) => item.options?.[g]?.choices[c]?.name).filter(Boolean).join(", ");

export const hasOptions = (item: PublicItem) => Boolean(item.options?.length);
