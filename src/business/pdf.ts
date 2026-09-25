import type { Invoice } from "./BusinessService";
import { stateName } from "./BusinessService";

/**
 * A small PDF writer: text in Helvetica, lines and filled boxes on A4. That is
 * all an invoice needs, and it keeps a PDF library out of the app. Measures
 * come from the standard Helvetica metrics so right-aligned figures line up.
 * The built-in fonts have no rupee sign, so amounts are written "Rs.".
 */

const W = 595.28;
const H = 841.89;

// Advance widths (1/1000 em) for characters 32..126, from the Adobe AFM files.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

type Rgb = [number, number, number];

function clean(text: string) {
  // Latin-1 only: the rupee sign and anything outside it become plain text.
  return text.replace(/₹\s?/g, "Rs. ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\xff]/g, "?");
}

export function textWidth(text: string, size: number, bold = false) {
  const table = bold ? HELV_BOLD : HELV;
  let units = 0;
  for (const ch of clean(text)) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (units * size) / 1000;
}

const esc = (text: string) => clean(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = ([r, g, b]: Rgb) => `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;

export class PdfDoc {
  private pages: string[][] = [[]];

  private get ops() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
  }

  /** y is measured from the top of the page, like a screen. */
  text(x: number, y: number, text: string, opts: { size?: number; bold?: boolean; align?: "left" | "right" | "center"; color?: Rgb } = {}) {
    const size = opts.size ?? 10;
    const width = textWidth(text, size, opts.bold);
    const left = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.ops.push(`BT /${opts.bold ? "F2" : "F1"} ${n(size)} Tf ${rgb(opts.color ?? [17, 24, 39])} rg ${n(left)} ${n(H - y)} Td (${esc(text)}) Tj ET`);
  }

  /** Words wrapped to a width; returns the y below the last line. */
  para(x: number, y: number, text: string, width: number, opts: { size?: number; bold?: boolean; color?: Rgb; leading?: number } = {}) {
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.35;
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, opts.bold) > width) {
        this.text(x, y, line, opts);
        y += leading;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) {
      this.text(x, y, line, opts);
      y += leading;
    }
    return y;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, color: Rgb = [209, 213, 219]) {
    this.ops.push(`${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(H - y1)} m ${n(x2)} ${n(H - y2)} l S`);
  }

  box(x: number, y: number, w: number, h: number, fill: Rgb) {
    this.ops.push(`${rgb(fill)} rg ${n(x)} ${n(H - y - h)} ${n(w)} ${n(h)} re f`);
  }

  bytes(): Uint8Array {
    const objects: string[] = [];
    const pageIds: number[] = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    let id = 5;
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const contentId = id++;
      const pageId = id++;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
      pageIds.push(pageId);
    }
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

/* ------------------------------------------------------------------ amounts */

const money = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(v: number) {
  return v < 20 ? ONES[v] : `${TENS[Math.floor(v / 10)]}${v % 10 ? ` ${ONES[v % 10]}` : ""}`;
}
function below1000(v: number) {
  const h = Math.floor(v / 100);
  const rest = v % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
}

/** Indian numbering: crore, lakh, thousand. */
export function inWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1e3);
  const rest = rupees % 1e3;
  if (crore) parts.push(`${inWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

function amountInWords(paise: number) {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${inWords(rupees)}${p ? ` and ${below100(p)} Paise` : ""} Only`;
}

/* ------------------------------------------------------------------ the invoice */

const INDIGO: Rgb = [49, 46, 129];
const MUTED: Rgb = [107, 114, 128];
const TINT: Rgb = [238, 242, 255];

export function invoicePdf(inv: Invoice): Uint8Array {
  const doc = new PdfDoc();
  const L = 48;
  const R = W - 48;
  const gst = inv.taxMode === "gst";
  const issued = new Date(inv.issuedAt);
  const period = new Date(`${inv.period}T00:00:00`);

  // Header band.
  doc.box(0, 0, W, 96, INDIGO);
  doc.text(L, 44, "Waggle Business", { size: 20, bold: true, color: [255, 255, 255] });
  doc.text(L, 66, inv.supplier.name, { size: 10, color: [224, 231, 255] });
  doc.text(R, 44, gst ? "TAX INVOICE" : "BILL OF SUPPLY", { size: 16, bold: true, align: "right", color: [255, 255, 255] });
  doc.text(R, 66, inv.number, { size: 11, align: "right", color: [224, 231, 255] });

  // Who and when.
  let y = 130;
  doc.text(L, y, "FROM", { size: 8, bold: true, color: MUTED });
  doc.text(W / 2 + 10, y, "BILLED TO", { size: 8, bold: true, color: MUTED });
  y += 16;
  let yl = doc.para(L, y, inv.supplier.name, W / 2 - 70, { bold: true });
  yl = doc.para(L, yl, inv.supplier.address, W / 2 - 70, { size: 9, color: MUTED });
  if (inv.supplier.gstin) yl = doc.para(L, yl, `GSTIN ${inv.supplier.gstin}`, W / 2 - 70, { size: 9 });
  if (inv.supplier.pan) yl = doc.para(L, yl, `PAN ${inv.supplier.pan}`, W / 2 - 70, { size: 9 });
  if (inv.supplier.email) yl = doc.para(L, yl, inv.supplier.email, W / 2 - 70, { size: 9, color: MUTED });

  let yr = doc.para(W / 2 + 10, y, inv.recipient.name, R - W / 2 - 10, { bold: true });
  if (inv.recipient.owner) yr = doc.para(W / 2 + 10, yr, inv.recipient.owner, R - W / 2 - 10, { size: 9 });
  yr = doc.para(W / 2 + 10, yr, inv.recipient.address, R - W / 2 - 10, { size: 9, color: MUTED });
  if (inv.recipient.gstin) yr = doc.para(W / 2 + 10, yr, `GSTIN ${inv.recipient.gstin}`, R - W / 2 - 10, { size: 9 });
  else if (inv.recipient.pan) yr = doc.para(W / 2 + 10, yr, `PAN ${inv.recipient.pan}`, R - W / 2 - 10, { size: 9 });

  y = Math.max(yl, yr) + 14;
  doc.box(L, y, R - L, 44, TINT);
  const facts: [string, string][] = [
    ["Invoice date", issued.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })],
    ["For the month of", period.toLocaleDateString("en-IN", { month: "long", year: "numeric" })],
    ["Place of supply", inv.recipient.state_code ? `${stateName(inv.recipient.state_code)} (${inv.recipient.state_code})` : "-"],
    ["Status", inv.status === "paid" ? "Paid" : "Due"],
  ];
  const col = (R - L) / facts.length;
  facts.forEach(([k, v], i) => {
    doc.text(L + 12 + i * col, y + 17, k, { size: 8, color: MUTED });
    doc.text(L + 12 + i * col, y + 32, v, { size: 10, bold: true });
  });

  // Lines.
  y += 72;
  const cQty = R - 190;
  const cRate = R - 100;
  doc.text(L, y, "Description", { size: 9, bold: true, color: MUTED });
  doc.text(L + 270, y, "SAC", { size: 9, bold: true, color: MUTED });
  doc.text(cQty, y, "Qty", { size: 9, bold: true, color: MUTED, align: "right" });
  doc.text(cRate, y, "Rate", { size: 9, bold: true, color: MUTED, align: "right" });
  doc.text(R, y, "Amount", { size: 9, bold: true, color: MUTED, align: "right" });
  y += 8;
  doc.line(L, y, R, y, 0.8, [156, 163, 175]);
  y += 18;
  for (const line of inv.lines) {
    if (y > H - 220) {
      doc.newPage();
      y = 60;
    }
    const below = doc.para(L, y, line.description, 260, { size: 10 });
    doc.text(L + 270, y, inv.supplier.sac, { size: 10, color: MUTED });
    doc.text(cQty, y, String(line.quantity), { size: 10, align: "right" });
    doc.text(cRate, y, money(line.rate_paise), { size: 10, align: "right" });
    doc.text(R, y, money(line.amount_paise), { size: 10, align: "right" });
    y = Math.max(below, y + 14) + 4;
    doc.line(L, y - 8, R, y - 8);
  }

  // Totals.
  y += 10;
  const totals: [string, number, boolean?][] = gst
    ? [
        ["Taxable value", inv.taxablePaise],
        ...(inv.igstPaise
          ? ([["IGST @ 18%", inv.igstPaise]] as [string, number][])
          : ([["CGST @ 9%", inv.cgstPaise], ["SGST @ 9%", inv.sgstPaise]] as [string, number][])),
        ["Total", inv.totalPaise, true],
      ]
    : [["Total", inv.totalPaise, true]];
  for (const [label, paise, strong] of totals) {
    if (strong) {
      doc.box(R - 230, y - 14, 230, 26, INDIGO);
      doc.text(R - 218, y + 3, label, { size: 11, bold: true, color: [255, 255, 255] });
      doc.text(R - 12, y + 3, money(paise), { size: 11, bold: true, align: "right", color: [255, 255, 255] });
      y += 30;
    } else {
      doc.text(R - 218, y, label, { size: 10, color: MUTED });
      doc.text(R - 12, y, money(paise), { size: 10, align: "right" });
      y += 18;
    }
  }
  y = doc.para(L, y + 6, amountInWords(inv.totalPaise), R - L, { size: 9, bold: true });

  // Notes.
  y += 10;
  const notes = [
    gst ? "Prices include GST. Tax is shown separately as the law requires." : `${inv.supplier.name} is not yet registered for GST, so no GST is charged on this bill.`,
    "Pay by UPI from the Billing page of Waggle Business and enter the UTR, or ask Gigzen for a payment request.",
    "This is a computer-generated document and needs no signature.",
  ];
  for (const note of notes) y = doc.para(L, y, note, R - L, { size: 8.5, color: MUTED });
  doc.line(L, H - 50, R, H - 50);
  doc.text(L, H - 34, "Waggle Business by Gigzen", { size: 8, color: MUTED });
  doc.text(R, H - 34, inv.number, { size: 8, color: MUTED, align: "right" });
  return doc.bytes();
}
