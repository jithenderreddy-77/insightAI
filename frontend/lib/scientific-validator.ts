/**
 * scientific-validator.ts
 *
 * Data quality validation for scientific measurement datasets.
 * Runs after dataset detection to warn researchers about data issues
 * before performing analysis.
 */

import type { SheetData, ColumnSchema } from './spreadsheet-parser';
import type { ScientificDatasetProfile, ExperimentType } from './scientific-dataset-detector';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'info' | 'warning' | 'error';

export interface ValidationIssue {
  severity: ValidationSeverity;
  column?: string;
  message: string;
  /** Affected row indices (0-based, first 10 max) */
  affectedRows?: number[];
}

export interface ValidationReport {
  /** Overall data quality score (0–100) */
  qualityScore: number;
  /** Total number of data rows */
  totalRows: number;
  /** Total number of columns */
  totalColumns: number;
  /** List of validation issues found */
  issues: ValidationIssue[];
  /** Quick summary text */
  summary: string;
}

// ---------------------------------------------------------------------------
// Main Validation Function
// ---------------------------------------------------------------------------

/**
 * Validate scientific dataset quality.
 *
 * @param sheet - Parsed sheet data
 * @param profile - Scientific dataset profile from the detector
 * @returns ValidationReport with issues and quality score
 */
export function validateScientificData(
  sheet: SheetData,
  profile: ScientificDatasetProfile,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const rows = sheet.rows;
  const headers = sheet.headers;
  const columns = sheet.columns;

  // 1. Check for missing values
  checkMissingValues(rows, headers, columns, issues);

  // 2. Check for duplicate rows
  checkDuplicateRows(rows, headers, issues);

  // 3. Check for impossible/invalid values based on experiment type
  checkImpossibleValues(rows, headers, profile, issues);

  // 4. Check for malformed numeric values
  checkMalformedNumerics(rows, headers, columns, issues);

  // 5. Check for outliers using IQR method
  checkOutliers(rows, headers, columns, issues);

  // 6. Check for inconsistent data precision
  checkPrecisionConsistency(rows, headers, columns, issues);

  // 7. Check minimum data requirements
  checkMinimumData(rows, headers, profile, issues);

  // Calculate quality score
  const qualityScore = calculateQualityScore(rows.length, headers.length, issues);

  // Build summary
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warnCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;

  let summary: string;
  if (errorCount > 0) {
    summary = `Found ${errorCount} critical issue${errorCount > 1 ? 's' : ''} that may affect analysis accuracy.`;
  } else if (warnCount > 0) {
    summary = `Data quality is acceptable with ${warnCount} warning${warnCount > 1 ? 's' : ''} to review.`;
  } else {
    summary = 'Data quality looks good. No significant issues detected.';
  }

  return {
    qualityScore,
    totalRows: rows.length,
    totalColumns: headers.length,
    issues,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Validation Checks
// ---------------------------------------------------------------------------

function checkMissingValues(
  rows: Record<string, unknown>[],
  headers: string[],
  columns: ColumnSchema[],
  issues: ValidationIssue[],
): void {
  for (let c = 0; c < headers.length; c++) {
    const col = columns[c];
    if (!col) continue;

    const header = headers[c];
    let missingCount = 0;
    const missingRows: number[] = [];

    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][header];
      if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
        missingCount++;
        if (missingRows.length < 10) missingRows.push(r);
      }
    }

    if (missingCount > 0) {
      const pct = ((missingCount / rows.length) * 100).toFixed(1);
      const severity: ValidationSeverity = missingCount / rows.length > 0.3 ? 'warning' : 'info';

      issues.push({
        severity,
        column: header,
        message: `${missingCount} missing value${missingCount > 1 ? 's' : ''} (${pct}% of data) in column "${header}".`,
        affectedRows: missingRows,
      });
    }
  }
}

function checkDuplicateRows(
  rows: Record<string, unknown>[],
  headers: string[],
  issues: ValidationIssue[],
): void {
  if (rows.length > 10000) return; // Skip for very large datasets

  const seen = new Map<string, number>();
  const duplicateIndices: number[] = [];

  for (let r = 0; r < rows.length; r++) {
    const key = headers.map(h => String(rows[r][h] ?? '')).join('|');
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      if (duplicateIndices.length < 10) duplicateIndices.push(r);
    } else {
      seen.set(key, r);
    }
  }

  const dupCount = rows.length - seen.size;
  if (dupCount > 0) {
    issues.push({
      severity: dupCount > rows.length * 0.1 ? 'warning' : 'info',
      message: `${dupCount} duplicate row${dupCount > 1 ? 's' : ''} detected. These may be repeated measurements or data entry errors.`,
      affectedRows: duplicateIndices,
    });
  }
}

function checkImpossibleValues(
  rows: Record<string, unknown>[],
  headers: string[],
  profile: ScientificDatasetProfile,
  issues: ValidationIssue[],
): void {
  const checks = getImpossibleValueChecks(profile.experimentType);

  for (const detected of profile.detectedColumns) {
    const check = checks[detected.role];
    if (!check) continue;

    const colName = detected.name;
    const violations: number[] = [];

    for (let r = 0; r < rows.length; r++) {
      const rawVal = rows[r][colName];
      if (rawVal === null || rawVal === undefined) continue;

      const val = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
      if (isNaN(val)) continue;

      if ((check.min !== undefined && val < check.min) || (check.max !== undefined && val > check.max)) {
        if (violations.length < 10) violations.push(r);
      }
    }

    if (violations.length > 0) {
      issues.push({
        severity: 'warning',
        column: colName,
        message: `${violations.length} value${violations.length > 1 ? 's' : ''} in "${colName}" ${check.description}. This may indicate instrument artifacts or data entry errors.`,
        affectedRows: violations,
      });
    }
  }
}

interface ValueCheck {
  min?: number;
  max?: number;
  description: string;
}

function getImpossibleValueChecks(type: ExperimentType): Record<string, ValueCheck> {
  const checks: Record<string, ValueCheck> = {};

  switch (type) {
    case 'XRD':
      checks['angle'] = { min: 0, max: 180, description: 'outside valid 2θ range (0°–180°)' };
      checks['intensity'] = { min: 0, description: 'negative (intensity cannot be negative)' };
      checks['fwhm'] = { min: 0, max: 10, description: 'outside reasonable FWHM range' };
      checks['d_spacing'] = { min: 0, description: 'negative (d-spacing cannot be negative)' };
      break;
    case 'XPS':
      checks['binding_energy'] = { min: 0, max: 1500, description: 'outside typical binding energy range (0–1500 eV)' };
      checks['intensity'] = { min: 0, description: 'negative (counts cannot be negative)' };
      checks['atomic_percent'] = { min: 0, max: 100, description: 'outside 0–100% range' };
      break;
    case 'VSM':
      // Field and magnetization can be negative (hysteresis loop)
      break;
    case 'TGA':
      checks['weight'] = { min: 0, max: 200, description: 'outside reasonable weight % range' };
      break;
    case 'UV-Vis':
      checks['wavelength'] = { min: 100, max: 2500, description: 'outside UV-Vis range (100–2500 nm)' };
      checks['absorbance'] = { min: -0.5, max: 10, description: 'outside reasonable absorbance range' };
      break;
    case 'BET':
      checks['relative_pressure'] = { min: 0, max: 1.1, description: 'outside valid P/P₀ range (0–1)' };
      checks['adsorbed_volume'] = { min: 0, description: 'negative (volume cannot be negative)' };
      break;
    case 'EDX':
      checks['composition'] = { min: 0, max: 100, description: 'outside 0–100% composition range' };
      break;
    case 'Electrochemical':
      // Voltage and current can be negative
      checks['capacitance'] = { min: 0, description: 'negative (specific capacitance should be positive)' };
      break;
  }

  return checks;
}

function checkMalformedNumerics(
  rows: Record<string, unknown>[],
  headers: string[],
  columns: ColumnSchema[],
  issues: ValidationIssue[],
): void {
  for (let c = 0; c < headers.length; c++) {
    const col = columns[c];
    if (!col || col.dtype !== 'number') continue;

    const header = headers[c];
    let malformedCount = 0;
    const malformedRows: number[] = [];

    for (let r = 0; r < Math.min(rows.length, 1000); r++) {
      const val = rows[r][header];
      if (val === null || val === undefined) continue;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed !== '' && isNaN(Number(trimmed))) {
          malformedCount++;
          if (malformedRows.length < 10) malformedRows.push(r);
        }
      }
    }

    if (malformedCount > 0) {
      issues.push({
        severity: 'warning',
        column: header,
        message: `${malformedCount} non-numeric value${malformedCount > 1 ? 's' : ''} found in numeric column "${header}". These will be treated as missing values.`,
        affectedRows: malformedRows,
      });
    }
  }
}

function checkOutliers(
  rows: Record<string, unknown>[],
  headers: string[],
  columns: ColumnSchema[],
  issues: ValidationIssue[],
): void {
  for (let c = 0; c < headers.length; c++) {
    const col = columns[c];
    if (!col || col.dtype !== 'number') continue;

    const header = headers[c];
    const values: number[] = [];

    for (const row of rows) {
      const val = row[header];
      if (val !== null && val !== undefined) {
        const num = typeof val === 'number' ? val : parseFloat(String(val));
        if (!isNaN(num) && isFinite(num)) values.push(num);
      }
    }

    if (values.length < 10) continue; // Need enough data for IQR

    // IQR-based outlier detection
    values.sort((a, b) => a - b);
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const iqr = q3 - q1;

    if (iqr === 0) continue; // All values identical or nearly so

    const lowerBound = q1 - 3 * iqr; // Use 3×IQR for scientific data (less aggressive)
    const upperBound = q3 + 3 * iqr;

    let outlierCount = 0;
    const outlierRows: number[] = [];

    for (let r = 0; r < rows.length; r++) {
      const val = rows[r][header];
      if (val === null || val === undefined) continue;
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (isNaN(num)) continue;

      if (num < lowerBound || num > upperBound) {
        outlierCount++;
        if (outlierRows.length < 10) outlierRows.push(r);
      }
    }

    if (outlierCount > 0 && outlierCount <= rows.length * 0.05) {
      issues.push({
        severity: 'info',
        column: header,
        message: `${outlierCount} potential outlier${outlierCount > 1 ? 's' : ''} detected in "${header}" (outside 3×IQR bounds). Verify if these are legitimate extreme values or instrument artifacts.`,
        affectedRows: outlierRows,
      });
    }
  }
}

function checkPrecisionConsistency(
  rows: Record<string, unknown>[],
  headers: string[],
  columns: ColumnSchema[],
  issues: ValidationIssue[],
): void {
  for (let c = 0; c < headers.length; c++) {
    const col = columns[c];
    if (!col || col.dtype !== 'number') continue;

    const header = headers[c];
    const decimalCounts = new Map<number, number>();
    const sampleSize = Math.min(rows.length, 200);

    for (let r = 0; r < sampleSize; r++) {
      const val = rows[r][header];
      if (val === null || val === undefined) continue;
      const str = String(val);
      const dotIndex = str.indexOf('.');
      const decimals = dotIndex >= 0 ? str.length - dotIndex - 1 : 0;
      decimalCounts.set(decimals, (decimalCounts.get(decimals) || 0) + 1);
    }

    // If more than 3 different precision levels, warn
    if (decimalCounts.size > 3) {
      issues.push({
        severity: 'info',
        column: header,
        message: `Mixed decimal precision in "${header}" (${decimalCounts.size} different precisions). This may indicate data from multiple sources or manual entry.`,
      });
    }
  }
}

function checkMinimumData(
  rows: Record<string, unknown>[],
  headers: string[],
  profile: ScientificDatasetProfile,
  issues: ValidationIssue[],
): void {
  if (rows.length < 3) {
    issues.push({
      severity: 'warning',
      message: `Only ${rows.length} data row${rows.length > 1 ? 's' : ''} found. Most scientific analyses require more data points for meaningful results.`,
    });
  }

  // Check if key measurement columns are present
  const measurementCols = profile.detectedColumns.filter(
    d => d.role !== 'element' && d.role !== 'phase' && d.role !== 'miller_index' && d.role !== 'categorical'
  );

  if (measurementCols.length < 2 && profile.experimentType !== 'EDX' && profile.experimentType !== 'General') {
    issues.push({
      severity: 'warning',
      message: `Only ${measurementCols.length} measurement column${measurementCols.length !== 1 ? 's' : ''} detected. Most analyses require at least 2 measurement columns (e.g., x-axis and y-axis).`,
    });
  }
}

// ---------------------------------------------------------------------------
// Quality Score
// ---------------------------------------------------------------------------

function calculateQualityScore(
  totalRows: number,
  totalColumns: number,
  issues: ValidationIssue[],
): number {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        score -= 15;
        break;
      case 'warning':
        score -= 5;
        break;
      case 'info':
        score -= 1;
        break;
    }
  }

  // Bonus for having sufficient data
  if (totalRows >= 50) score = Math.min(score + 3, 100);
  if (totalRows >= 100) score = Math.min(score + 2, 100);

  return Math.max(0, Math.min(100, Math.round(score)));
}
