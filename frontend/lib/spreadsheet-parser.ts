/**
 * spreadsheet-parser.ts
 *
 * Universal spreadsheet parser for Insight AI.
 * Parses .xlsx, .xlsm, .xls, .xlsb, .csv, .ods into a structured
 * SpreadsheetData object that the query agent can reason over.
 *
 * Design decisions:
 *  1. SheetJS (xlsx) Community Edition handles all 6 formats with one API.
 *  2. We extract schema + sample rows (never send full dataset to LLM).
 *  3. Full row data stays in-memory per session; the data-access layer
 *     (getRows / getSchema) is abstracted so Supabase persistence can be
 *     swapped in later without touching the query agent.
 *  4. Large files: SheetJS `read()` with `type: 'buffer'` streams cells
 *     incrementally. For files > ~50 MB on Vercel we rely on client-side
 *     parsing and JSON payload (same path already used for 200 MB+ PDFs).
 *  5. Corrupt / malformed files surface a clear user-facing message —
 *     never a raw stack trace.
 */

import * as XLSX from 'xlsx';
import { detectScientificDataset } from './scientific-dataset-detector';
import { validateScientificData } from './scientific-validator';
import type { ScientificDatasetProfile } from './scientific-dataset-detector';
import type { ValidationReport } from './scientific-validator';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Inferred column data type */
export type ColumnDtype = 'number' | 'string' | 'boolean' | 'date' | 'empty';

/** Per-column schema entry */
export interface ColumnSchema {
  name: string;
  dtype: ColumnDtype;
  /** Count of non-empty cells in the sample window */
  nonNullCount: number;
  /** A few example distinct values (for string/categorical columns) */
  sampleValues: (string | number | boolean)[];
}

/** Schema + data for a single worksheet */
export interface SheetData {
  name: string;
  headers: string[];
  columns: ColumnSchema[];
  /** Total row count (excluding header) */
  rowCount: number;
  /** First N sample rows as plain objects keyed by header */
  sampleRows: Record<string, unknown>[];
  /** ALL rows — kept in-memory for the sandbox to query against */
  rows: Record<string, unknown>[];
  /** Scientific dataset profile (auto-detected after parsing) */
  scientificProfile?: ScientificDatasetProfile;
  /** Data quality validation report */
  validationReport?: ValidationReport;
}

/** Top-level result object returned by the parser */
export interface SpreadsheetData {
  filename: string;
  /** Total size in bytes (informational) */
  fileSize: number;
  sheets: SheetData[];
  /** Human-readable parse warnings (e.g. "Sheet3 was empty and skipped") */
  warnings: string[];
}

/** Error thrown when a file cannot be parsed at all */
export class SpreadsheetParseError extends Error {
  public readonly userMessage: string;
  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'SpreadsheetParseError';
    this.userMessage = userMessage;
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max sample rows sent to the LLM for schema inference */
const SAMPLE_ROW_COUNT = 10;

/** Max distinct sample values per column shown to the LLM */
const SAMPLE_VALUES_COUNT = 8;

/** Supported spreadsheet file extensions */
export const SPREADSHEET_EXTENSIONS = [
  '.xlsx', '.xlsm', '.xls', '.xlsb', '.csv', '.ods',
];

/** Corresponding MIME types */
export const SPREADSHEET_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel.sheet.macroEnabled.12',                    // .xlsm
  'application/vnd.ms-excel',                                          // .xls
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',             // .xlsb
  'text/csv',                                                          // .csv
  'application/vnd.oasis.opendocument.spreadsheet',                    // .ods
];

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Parse a spreadsheet file into structured SpreadsheetData.
 *
 * @param buffer   Raw file bytes
 * @param filename Original filename (used for extension detection + metadata)
 * @param fileSize File size in bytes
 * @returns SpreadsheetData with schema, sample rows, and full row data
 * @throws SpreadsheetParseError with a user-friendly message on failure
 */
export function parseSpreadsheet(
  buffer: Buffer,
  filename: string,
  fileSize: number,
): SpreadsheetData {
  const warnings: string[] = [];

  // --- 1. Read workbook ---------------------------------------------------
  let workbook: XLSX.WorkBook;
  try {
    const ext = getExtension(filename);

    // CSV: force UTF-8 string parsing for better delimiter detection
    if (ext === '.csv') {
      const csvText = buffer.toString('utf-8');
      workbook = XLSX.read(csvText, {
        type: 'string',
        raw: false,
        cellDates: true,
        codepage: 65001, // UTF-8
      });
    } else {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,     // Parse dates as JS Date objects
        cellNF: true,        // Preserve number formats for formatting export
        cellStyles: true,    // Preserve styles for conditional-formatting export
        raw: false,          // Apply number formats
        WTF: false,          // Don't throw on minor issues
      });
    }
  } catch (err) {
    throw new SpreadsheetParseError(
      `Could not open "${filename}". The file may be corrupted, password-protected, or in an unsupported format.`,
      err,
    );
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new SpreadsheetParseError(
      `"${filename}" contains no worksheets. Please upload a file with at least one sheet of data.`,
    );
  }

  // --- 2. Process each sheet -----------------------------------------------
  const sheets: SheetData[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) {
      warnings.push(`Sheet "${sheetName}" could not be read and was skipped.`);
      continue;
    }

    try {
      const sheetData = processSheet(ws, sheetName, warnings);
      if (sheetData) {
        // Auto-detect scientific dataset type and validate data quality
        try {
          sheetData.scientificProfile = detectScientificDataset(sheetData);
          sheetData.validationReport = validateScientificData(sheetData, sheetData.scientificProfile);
        } catch {
          // Non-fatal: scientific detection is optional
        }
        sheets.push(sheetData);
      }
    } catch (err) {
      warnings.push(
        `Sheet "${sheetName}" failed to parse: ${err instanceof Error ? err.message : 'unknown error'}. Skipped.`,
      );
    }
  }

  if (sheets.length === 0) {
    throw new SpreadsheetParseError(
      `No readable data found in "${filename}". All sheets were empty or unreadable.`,
    );
  }

  return {
    filename,
    fileSize,
    sheets,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Sheet Processing
// ---------------------------------------------------------------------------

function processSheet(
  ws: XLSX.WorkSheet,
  sheetName: string,
  warnings: string[],
): SheetData | null {
  // Convert sheet → array-of-arrays (raw cell values)
  const rawAoA: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    rawNumbers: true,
  });

  if (rawAoA.length === 0) {
    warnings.push(`Sheet "${sheetName}" is empty and was skipped.`);
    return null;
  }

  // --- Headers ---
  const rawHeaders = (rawAoA[0] || []).map((h, i) =>
    h != null && String(h).trim() !== '' ? String(h).trim() : `Column_${i + 1}`,
  );

  // Deduplicate headers (Excel allows duplicate column names)
  const headerCounts = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const count = headerCounts.get(h) || 0;
    headerCounts.set(h, count + 1);
    return count > 0 ? `${h}_${count}` : h;
  });

  // --- Row data ---
  const dataRows = rawAoA.slice(1);
  const rows: Record<string, unknown>[] = dataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const val = c < row.length ? row[c] : null;
      obj[headers[c]] = val;
    }
    return obj;
  });

  const rowCount = rows.length;

  if (rowCount === 0) {
    warnings.push(`Sheet "${sheetName}" has headers but no data rows. Skipped.`);
    return null;
  }

  // --- Column schemas ---
  const columns: ColumnSchema[] = headers.map((name, colIdx) => {
    return inferColumnSchema(name, colIdx, dataRows);
  });

  // --- Sample rows (first N) ---
  const sampleRows = rows.slice(0, SAMPLE_ROW_COUNT);

  return {
    name: sheetName,
    headers,
    columns,
    rowCount,
    sampleRows,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Type Inference
// ---------------------------------------------------------------------------

function inferColumnSchema(
  name: string,
  colIdx: number,
  dataRows: unknown[][],
): ColumnSchema {
  let numberCount = 0;
  let stringCount = 0;
  let boolCount = 0;
  let dateCount = 0;
  let nullCount = 0;

  const distinctValues = new Set<string>();
  const sampleLimit = Math.min(dataRows.length, 200); // Sample first 200 rows for dtype

  for (let r = 0; r < sampleLimit; r++) {
    const row = dataRows[r];
    const val = colIdx < row.length ? row[colIdx] : null;

    if (val == null || (typeof val === 'string' && val.trim() === '')) {
      nullCount++;
      continue;
    }

    if (typeof val === 'boolean') {
      boolCount++;
    } else if (typeof val === 'number') {
      numberCount++;
    } else if (val instanceof Date) {
      dateCount++;
    } else {
      const strVal = String(val).trim();
      // Check if it's a number stored as string
      if (strVal !== '' && !isNaN(Number(strVal))) {
        numberCount++;
      } else {
        stringCount++;
      }
    }

    // Collect distinct values for categorical preview
    if (distinctValues.size < SAMPLE_VALUES_COUNT) {
      const displayVal = val instanceof Date
        ? val.toISOString().split('T')[0]
        : String(val);
      distinctValues.add(displayVal);
    }
  }

  // Determine dominant type
  const total = numberCount + stringCount + boolCount + dateCount;
  let dtype: ColumnDtype = 'empty';
  if (total === 0) {
    dtype = 'empty';
  } else if (dateCount >= total * 0.6) {
    dtype = 'date';
  } else if (numberCount >= total * 0.6) {
    dtype = 'number';
  } else if (boolCount >= total * 0.6) {
    dtype = 'boolean';
  } else {
    dtype = 'string';
  }

  // Build sample values list
  const sampleValues: (string | number | boolean)[] = [];
  for (const v of distinctValues) {
    if (sampleValues.length >= SAMPLE_VALUES_COUNT) break;
    if (dtype === 'number') {
      const n = Number(v);
      if (!isNaN(n)) sampleValues.push(n);
      else sampleValues.push(v);
    } else if (dtype === 'boolean') {
      sampleValues.push(v.toLowerCase() === 'true');
    } else {
      sampleValues.push(v);
    }
  }

  return {
    name,
    dtype,
    nonNullCount: total,
    sampleValues,
  };
}

// ---------------------------------------------------------------------------
// Schema Serialization (for LLM prompts)
// ---------------------------------------------------------------------------

/**
 * Produce a concise schema description suitable for an LLM system prompt.
 * Includes column names, types, sample values, and a few sample rows.
 */
export function schemaToPrompt(sheet: SheetData): string {
  const lines: string[] = [];
  lines.push(`Sheet: "${sheet.name}"  |  ${sheet.rowCount} rows × ${sheet.headers.length} columns`);
  lines.push('');
  lines.push('Columns:');

  for (const col of sheet.columns) {
    const samples = col.sampleValues.length > 0
      ? ` — examples: ${col.sampleValues.slice(0, 5).map((v) => JSON.stringify(v)).join(', ')}`
      : '';
    lines.push(`  • ${col.name} (${col.dtype})${samples}`);
  }

  lines.push('');
  lines.push(`Sample rows (first ${Math.min(sheet.sampleRows.length, 5)}):`)
  const displayRows = sheet.sampleRows.slice(0, 5);
  for (let i = 0; i < displayRows.length; i++) {
    lines.push(`  Row ${i + 1}: ${JSON.stringify(displayRows[i])}`);
  }

  return lines.join('\n');
}

/**
 * Check if a filename is a spreadsheet format.
 */
export function isSpreadsheetFile(filename: string): boolean {
  const ext = getExtension(filename);
  return SPREADSHEET_EXTENSIONS.includes(ext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot).toLowerCase();
}
