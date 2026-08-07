/**
 * scientific-dataset-detector.ts
 *
 * Automatic detection of scientific dataset types from spreadsheet column names,
 * units, and data patterns. Runs after spreadsheet-parser.ts processes the file.
 *
 * Supports: XRD, XPS, SEM, TEM, VSM, FTIR, Raman, UV-Vis, PL, TGA, DSC, DTA,
 *           BET, EDX/EDS, Electrochemical (CV, GCD, EIS), General
 */

import type { SheetData, ColumnSchema } from './spreadsheet-parser';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Supported scientific experiment types */
export type ExperimentType =
  | 'XRD'
  | 'XPS'
  | 'SEM'
  | 'TEM'
  | 'VSM'
  | 'FTIR'
  | 'Raman'
  | 'UV-Vis'
  | 'PL'
  | 'TGA'
  | 'DSC'
  | 'DTA'
  | 'BET'
  | 'EDX'
  | 'Electrochemical'
  | 'General';

/** Detected column role in the scientific context */
export interface DetectedColumn {
  /** Original column name from the spreadsheet */
  name: string;
  /** Detected scientific role (e.g., 'angle', 'intensity', 'field', 'magnetization') */
  role: string;
  /** Detected or inferred unit (e.g., '°', 'counts', 'Oe', 'emu/g') */
  unit: string;
  /** Confidence of detection (0–1) */
  confidence: number;
}

/** Complete scientific profile for a dataset sheet */
export interface ScientificDatasetProfile {
  /** Detected experiment type */
  experimentType: ExperimentType;
  /** Human-readable instrument description */
  instrumentDescription: string;
  /** Detected columns with roles and units */
  detectedColumns: DetectedColumn[];
  /** Identified sample identifiers (column names that appear to be sample IDs) */
  sampleIds: string[];
  /** Whether repeated measurements were detected */
  hasRepeatedMeasurements: boolean;
  /** Overall detection confidence (0–1) */
  confidence: number;
  /** Supported analyses for this experiment type */
  supportedAnalyses: string[];
}

// ---------------------------------------------------------------------------
// Column Pattern Knowledge Base
// ---------------------------------------------------------------------------

interface ColumnPattern {
  /** Regex patterns to match column names (case-insensitive) */
  patterns: RegExp[];
  /** Scientific role of this column */
  role: string;
  /** Default unit if not detected from the column name */
  defaultUnit: string;
  /** Weight for this pattern in experiment type scoring */
  weight: number;
}

interface ExperimentSignature {
  type: ExperimentType;
  description: string;
  /** Required column patterns — at least one must match */
  requiredPatterns: ColumnPattern[];
  /** Optional column patterns — bonus score if matched */
  optionalPatterns: ColumnPattern[];
  /** Supported analyses for this experiment type */
  supportedAnalyses: string[];
}

const EXPERIMENT_SIGNATURES: ExperimentSignature[] = [
  {
    type: 'XRD',
    description: 'X-Ray Diffraction',
    requiredPatterns: [
      {
        patterns: [/2\s*theta/i, /2θ/i, /two\s*theta/i, /angle/i, /2th/i, /2-theta/i],
        role: 'angle',
        defaultUnit: '°',
        weight: 10,
      },
      {
        patterns: [/intensity/i, /counts/i, /cps/i, /i\s*\(/i, /int/i, /yobs/i, /ycalc/i],
        role: 'intensity',
        defaultUnit: 'counts',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/fwhm/i, /full\s*width/i, /beta/i, /β/i], role: 'fwhm', defaultUnit: '°', weight: 6 },
      { patterns: [/d[\s_-]*spacing/i, /d[\s_-]*value/i, /d\s*\(/i], role: 'd_spacing', defaultUnit: 'Å', weight: 5 },
      { patterns: [/hkl/i, /miller/i, /h\s*k\s*l/i, /plane/i, /index/i], role: 'miller_index', defaultUnit: '', weight: 4 },
      { patterns: [/phase/i, /crystal/i, /structure/i], role: 'phase', defaultUnit: '', weight: 3 },
      { patterns: [/background/i, /bg/i], role: 'background', defaultUnit: 'counts', weight: 2 },
    ],
    supportedAnalyses: [
      'Peak detection & indexing',
      'FWHM calculation',
      'd-spacing calculation (Bragg\'s law)',
      'Crystallite size (Scherrer equation)',
      'Lattice parameter estimation',
      'Microstrain estimation (Williamson-Hall)',
      'Relative peak intensity comparison',
      'Phase identification guidance',
    ],
  },
  {
    type: 'XPS',
    description: 'X-Ray Photoelectron Spectroscopy',
    requiredPatterns: [
      {
        patterns: [/binding\s*energy/i, /be\s*\(/i, /b\.?\s*e\.?/i, /energy\s*\(ev\)/i],
        role: 'binding_energy',
        defaultUnit: 'eV',
        weight: 10,
      },
      {
        patterns: [/intensity/i, /counts/i, /cps/i, /c\/s/i, /signal/i],
        role: 'intensity',
        defaultUnit: 'counts/s',
        weight: 7,
      },
    ],
    optionalPatterns: [
      { patterns: [/kinetic\s*energy/i, /ke\s*\(/i], role: 'kinetic_energy', defaultUnit: 'eV', weight: 5 },
      { patterns: [/atomic\s*%/i, /at\.?\s*%/i, /composition/i], role: 'atomic_percent', defaultUnit: 'at.%', weight: 4 },
      { patterns: [/element/i, /species/i, /orbital/i, /peak/i], role: 'element', defaultUnit: '', weight: 3 },
    ],
    supportedAnalyses: [
      'Survey spectrum interpretation',
      'Peak identification',
      'Binding energy analysis',
      'Chemical state interpretation',
      'Relative atomic concentration',
      'Spin-orbit splitting identification',
    ],
  },
  {
    type: 'VSM',
    description: 'Vibrating Sample Magnetometry',
    requiredPatterns: [
      {
        patterns: [/field/i, /h\s*\(/i, /magnetic\s*field/i, /applied\s*field/i, /oe/i, /tesla/i, /gauss/i, /a\/m/i],
        role: 'field',
        defaultUnit: 'Oe',
        weight: 10,
      },
      {
        patterns: [/magnetization/i, /moment/i, /emu/i, /m\s*\(/i, /mag/i],
        role: 'magnetization',
        defaultUnit: 'emu/g',
        weight: 9,
      },
    ],
    optionalPatterns: [
      { patterns: [/temp/i, /temperature/i, /t\s*\(k\)/i], role: 'temperature', defaultUnit: 'K', weight: 4 },
      { patterns: [/suscept/i, /chi/i, /χ/i], role: 'susceptibility', defaultUnit: 'emu/(g·Oe)', weight: 4 },
    ],
    supportedAnalyses: [
      'Hysteresis loop analysis',
      'Saturation magnetization (Ms)',
      'Remanent magnetization (Mr)',
      'Coercivity (Hc)',
      'Squareness ratio (Mr/Ms)',
      'Loop area / hysteresis loss',
      'Multi-sample comparison',
    ],
  },
  {
    type: 'FTIR',
    description: 'Fourier Transform Infrared Spectroscopy',
    requiredPatterns: [
      {
        patterns: [/wavenumber/i, /cm[\s_-]*1/i, /cm⁻¹/i, /frequency/i, /wave\s*number/i],
        role: 'wavenumber',
        defaultUnit: 'cm⁻¹',
        weight: 10,
      },
      {
        patterns: [/transmit/i, /absorb/i, /absorbance/i, /transmittance/i, /%\s*t/i, /a\.u\./i],
        role: 'signal',
        defaultUnit: '%T',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/wavelength/i, /lambda/i, /μm/i], role: 'wavelength', defaultUnit: 'μm', weight: 3 },
    ],
    supportedAnalyses: [
      'Peak identification',
      'Functional group analysis',
      'Band assignment',
      'Spectral comparison',
    ],
  },
  {
    type: 'Raman',
    description: 'Raman Spectroscopy',
    requiredPatterns: [
      {
        patterns: [/raman\s*shift/i, /wavenumber/i, /cm[\s_-]*1/i, /shift/i],
        role: 'raman_shift',
        defaultUnit: 'cm⁻¹',
        weight: 10,
      },
      {
        patterns: [/intensity/i, /counts/i, /a\.u\./i, /signal/i],
        role: 'intensity',
        defaultUnit: 'a.u.',
        weight: 7,
      },
    ],
    optionalPatterns: [],
    supportedAnalyses: [
      'Peak detection',
      'Band assignment',
      'D/G band ratio (for carbon materials)',
      'Spectral comparison',
    ],
  },
  {
    type: 'UV-Vis',
    description: 'UV-Visible Spectroscopy',
    requiredPatterns: [
      {
        patterns: [/wavelength/i, /lambda/i, /λ/i, /nm\s*$/i],
        role: 'wavelength',
        defaultUnit: 'nm',
        weight: 8,
      },
      {
        patterns: [/absorb/i, /absorbance/i, /optical\s*density/i, /od/i, /transmit/i, /a\.u\./i, /abs/i],
        role: 'absorbance',
        defaultUnit: 'a.u.',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/reflectance/i, /%\s*r/i], role: 'reflectance', defaultUnit: '%', weight: 4 },
    ],
    supportedAnalyses: [
      'Absorption edge determination',
      'Band gap estimation (Tauc plot)',
      'Peak wavelength identification',
      'Beer-Lambert analysis',
    ],
  },
  {
    type: 'PL',
    description: 'Photoluminescence Spectroscopy',
    requiredPatterns: [
      {
        patterns: [/wavelength/i, /emission/i, /nm/i, /lambda/i],
        role: 'wavelength',
        defaultUnit: 'nm',
        weight: 7,
      },
      {
        patterns: [/pl\s*intensity/i, /intensity/i, /luminescence/i, /photoluminescence/i, /counts/i],
        role: 'pl_intensity',
        defaultUnit: 'a.u.',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/excitation/i, /excit/i], role: 'excitation', defaultUnit: 'nm', weight: 5 },
    ],
    supportedAnalyses: [
      'Emission peak identification',
      'Peak position and FWHM',
      'Spectral comparison',
    ],
  },
  {
    type: 'TGA',
    description: 'Thermogravimetric Analysis',
    requiredPatterns: [
      {
        patterns: [/temp/i, /temperature/i, /°c/i, /celsius/i],
        role: 'temperature',
        defaultUnit: '°C',
        weight: 8,
      },
      {
        patterns: [/weight/i, /mass/i, /tga/i, /%\s*weight/i, /wt/i, /mg/i],
        role: 'weight',
        defaultUnit: '%',
        weight: 9,
      },
    ],
    optionalPatterns: [
      { patterns: [/deriv/i, /dtg/i, /d\s*weight/i], role: 'derivative', defaultUnit: '%/°C', weight: 5 },
      { patterns: [/time/i, /min/i], role: 'time', defaultUnit: 'min', weight: 2 },
    ],
    supportedAnalyses: [
      'Decomposition temperature',
      'Weight loss steps',
      'Residual mass',
      'Thermal stability comparison',
    ],
  },
  {
    type: 'DSC',
    description: 'Differential Scanning Calorimetry',
    requiredPatterns: [
      {
        patterns: [/temp/i, /temperature/i, /°c/i],
        role: 'temperature',
        defaultUnit: '°C',
        weight: 7,
      },
      {
        patterns: [/heat\s*flow/i, /dsc/i, /mw/i, /w\/g/i, /endo/i, /exo/i],
        role: 'heat_flow',
        defaultUnit: 'mW',
        weight: 10,
      },
    ],
    optionalPatterns: [
      { patterns: [/time/i, /min/i], role: 'time', defaultUnit: 'min', weight: 2 },
    ],
    supportedAnalyses: [
      'Glass transition temperature (Tg)',
      'Melting temperature (Tm)',
      'Crystallization temperature (Tc)',
      'Enthalpy calculations',
    ],
  },
  {
    type: 'DTA',
    description: 'Differential Thermal Analysis',
    requiredPatterns: [
      {
        patterns: [/temp/i, /temperature/i, /°c/i],
        role: 'temperature',
        defaultUnit: '°C',
        weight: 7,
      },
      {
        patterns: [/dta/i, /delta\s*t/i, /ΔT/i, /differential/i, /μv/i],
        role: 'dta_signal',
        defaultUnit: 'μV',
        weight: 10,
      },
    ],
    optionalPatterns: [],
    supportedAnalyses: [
      'Phase transition detection',
      'Thermal event identification',
    ],
  },
  {
    type: 'BET',
    description: 'Brunauer-Emmett-Teller Surface Area Analysis',
    requiredPatterns: [
      {
        patterns: [/relative\s*pressure/i, /p\/p0/i, /p\s*\/\s*p/i],
        role: 'relative_pressure',
        defaultUnit: 'P/P₀',
        weight: 10,
      },
      {
        patterns: [/adsorb/i, /desorb/i, /volume/i, /quantity/i, /v\s*\(/i, /cm3/i, /cc/i],
        role: 'adsorbed_volume',
        defaultUnit: 'cm³/g STP',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/surface\s*area/i, /bet/i, /m2\/g/i], role: 'surface_area', defaultUnit: 'm²/g', weight: 5 },
      { patterns: [/pore/i, /diameter/i, /size/i], role: 'pore_size', defaultUnit: 'nm', weight: 4 },
    ],
    supportedAnalyses: [
      'BET surface area calculation',
      'Adsorption/desorption isotherm analysis',
      'Pore size distribution',
      'Isotherm type classification',
    ],
  },
  {
    type: 'EDX',
    description: 'Energy Dispersive X-Ray Spectroscopy (EDX/EDS)',
    requiredPatterns: [
      {
        patterns: [/element/i, /symbol/i, /species/i],
        role: 'element',
        defaultUnit: '',
        weight: 6,
      },
      {
        patterns: [/weight\s*%/i, /wt\s*%/i, /atomic\s*%/i, /at\s*%/i, /mass\s*%/i, /composition/i],
        role: 'composition',
        defaultUnit: 'wt.%',
        weight: 10,
      },
    ],
    optionalPatterns: [
      { patterns: [/energy/i, /kev/i], role: 'energy', defaultUnit: 'keV', weight: 5 },
      { patterns: [/counts/i, /intensity/i], role: 'counts', defaultUnit: 'counts', weight: 3 },
    ],
    supportedAnalyses: [
      'Elemental composition',
      'Weight % vs atomic % conversion',
      'Composition comparison between samples',
    ],
  },
  {
    type: 'SEM',
    description: 'Scanning Electron Microscopy (particle/grain measurement data)',
    requiredPatterns: [
      {
        patterns: [/particle\s*size/i, /grain\s*size/i, /diameter/i, /size\s*\(/i, /d\s*\(nm\)/i, /d\s*\(μm\)/i],
        role: 'particle_size',
        defaultUnit: 'nm',
        weight: 10,
      },
    ],
    optionalPatterns: [
      { patterns: [/count/i, /frequency/i, /number/i], role: 'frequency', defaultUnit: '', weight: 4 },
      { patterns: [/area/i, /surface/i], role: 'area', defaultUnit: 'nm²', weight: 3 },
    ],
    supportedAnalyses: [
      'Particle size statistics (mean, median, std)',
      'Size distribution histogram',
      'Morphology description',
    ],
  },
  {
    type: 'TEM',
    description: 'Transmission Electron Microscopy (measurement data)',
    requiredPatterns: [
      {
        patterns: [/lattice\s*spacing/i, /d[\s_-]*spacing/i, /fringe/i, /interplanar/i],
        role: 'lattice_spacing',
        defaultUnit: 'nm',
        weight: 10,
      },
    ],
    optionalPatterns: [
      { patterns: [/particle\s*size/i, /diameter/i, /size/i], role: 'particle_size', defaultUnit: 'nm', weight: 5 },
      { patterns: [/plane/i, /hkl/i, /miller/i], role: 'miller_index', defaultUnit: '', weight: 4 },
    ],
    supportedAnalyses: [
      'Particle size statistics',
      'Lattice spacing calculations',
      'Crystal plane indexing guidance',
    ],
  },
  {
    type: 'Electrochemical',
    description: 'Electrochemical Analysis (CV, GCD, EIS)',
    requiredPatterns: [
      {
        patterns: [/voltage/i, /potential/i, /v\s*\(/i, /e\s*\(v\)/i, /v\s*vs/i],
        role: 'voltage',
        defaultUnit: 'V',
        weight: 8,
      },
      {
        patterns: [/current/i, /i\s*\(a\)/i, /i\s*\(ma\)/i, /ampere/i, /density/i, /a\/g/i, /ma/i],
        role: 'current',
        defaultUnit: 'mA',
        weight: 8,
      },
    ],
    optionalPatterns: [
      { patterns: [/impedance/i, /z'/i, /z''/i, /z_real/i, /z_imag/i, /ohm/i], role: 'impedance', defaultUnit: 'Ω', weight: 7 },
      { patterns: [/capacitance/i, /f\/g/i, /specific\s*cap/i], role: 'capacitance', defaultUnit: 'F/g', weight: 6 },
      { patterns: [/time/i, /sec/i, /min/i, /hour/i], role: 'time', defaultUnit: 's', weight: 3 },
      { patterns: [/cycle/i, /scan/i, /rate/i], role: 'cycle', defaultUnit: '', weight: 3 },
      { patterns: [/charge/i, /discharge/i, /capacity/i, /mah/i], role: 'capacity', defaultUnit: 'mAh/g', weight: 6 },
    ],
    supportedAnalyses: [
      'CV curve analysis',
      'Specific capacitance calculation',
      'GCD charge/discharge analysis',
      'EIS Nyquist plot analysis',
      'Cycle stability',
      'Rate capability',
    ],
  },
];

// ---------------------------------------------------------------------------
// Unit Extraction
// ---------------------------------------------------------------------------

/** Common unit patterns found in column names (parenthesized or after slash) */
const UNIT_PATTERNS: Array<{ regex: RegExp; unit: string }> = [
  { regex: /\(°\)/i, unit: '°' },
  { regex: /\(deg(?:rees?)?\)/i, unit: '°' },
  { regex: /\(2θ\)/i, unit: '°' },
  { regex: /\(nm\)/i, unit: 'nm' },
  { regex: /\(μm\)/i, unit: 'μm' },
  { regex: /\(mm\)/i, unit: 'mm' },
  { regex: /\(Å\)/i, unit: 'Å' },
  { regex: /\(angstrom\)/i, unit: 'Å' },
  { regex: /\(eV\)/i, unit: 'eV' },
  { regex: /\(keV\)/i, unit: 'keV' },
  { regex: /\(counts?\)/i, unit: 'counts' },
  { regex: /\(cps\)/i, unit: 'counts/s' },
  { regex: /\(c\/s\)/i, unit: 'counts/s' },
  { regex: /\(a\.u\.?\)/i, unit: 'a.u.' },
  { regex: /\(Oe\)/i, unit: 'Oe' },
  { regex: /\(T\)/i, unit: 'T' },
  { regex: /\(tesla\)/i, unit: 'T' },
  { regex: /\(gauss\)/i, unit: 'G' },
  { regex: /\(A\/m\)/i, unit: 'A/m' },
  { regex: /\(emu\/g\)/i, unit: 'emu/g' },
  { regex: /\(emu\)/i, unit: 'emu' },
  { regex: /\(cm[\s⁻-]*1\)/i, unit: 'cm⁻¹' },
  { regex: /\(%T\)/i, unit: '%T' },
  { regex: /\(%R\)/i, unit: '%R' },
  { regex: /\(°C\)/i, unit: '°C' },
  { regex: /\(K\)/i, unit: 'K' },
  { regex: /\(%\)/i, unit: '%' },
  { regex: /\(mg\)/i, unit: 'mg' },
  { regex: /\(mW\)/i, unit: 'mW' },
  { regex: /\(W\/g\)/i, unit: 'W/g' },
  { regex: /\(μV\)/i, unit: 'μV' },
  { regex: /\(V\)/i, unit: 'V' },
  { regex: /\(mA\)/i, unit: 'mA' },
  { regex: /\(A\)/i, unit: 'A' },
  { regex: /\(A\/g\)/i, unit: 'A/g' },
  { regex: /\(mA\/g\)/i, unit: 'mA/g' },
  { regex: /\(F\/g\)/i, unit: 'F/g' },
  { regex: /\(Ω\)/i, unit: 'Ω' },
  { regex: /\(ohm\)/i, unit: 'Ω' },
  { regex: /\(mAh\/g\)/i, unit: 'mAh/g' },
  { regex: /\(cm[³3]\/g\s*STP\)/i, unit: 'cm³/g STP' },
  { regex: /\(cm[³3]\/g\)/i, unit: 'cm³/g' },
  { regex: /\(m[²2]\/g\)/i, unit: 'm²/g' },
  { regex: /\(P\/P[₀0]\)/i, unit: 'P/P₀' },
  { regex: /\(wt\.?\s*%\)/i, unit: 'wt.%' },
  { regex: /\(at\.?\s*%\)/i, unit: 'at.%' },
];

/**
 * Extract unit from a column name string.
 */
function extractUnit(columnName: string): string {
  for (const { regex, unit } of UNIT_PATTERNS) {
    if (regex.test(columnName)) return unit;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Main Detection Function
// ---------------------------------------------------------------------------

/**
 * Analyze a SheetData object and detect if it contains a scientific dataset.
 *
 * @param sheet - Parsed sheet data from spreadsheet-parser.ts
 * @returns ScientificDatasetProfile with detected experiment type and metadata
 */
export function detectScientificDataset(sheet: SheetData): ScientificDatasetProfile {
  const columnNames = sheet.headers;
  const columns = sheet.columns;

  // Score each experiment type
  const scores: Array<{
    signature: ExperimentSignature;
    score: number;
    matchedRequired: DetectedColumn[];
    matchedOptional: DetectedColumn[];
  }> = [];

  for (const sig of EXPERIMENT_SIGNATURES) {
    let score = 0;
    const matchedRequired: DetectedColumn[] = [];
    const matchedOptional: DetectedColumn[] = [];

    // Check required patterns
    for (const pattern of sig.requiredPatterns) {
      const match = findColumnMatch(columnNames, columns, pattern);
      if (match) {
        score += pattern.weight;
        matchedRequired.push(match);
      }
    }

    // Check optional patterns
    for (const pattern of sig.optionalPatterns) {
      const match = findColumnMatch(columnNames, columns, pattern);
      if (match) {
        score += pattern.weight;
        matchedOptional.push(match);
      }
    }

    // Require at least one required pattern match
    if (matchedRequired.length > 0) {
      scores.push({ signature: sig, score, matchedRequired, matchedOptional });
    }
  }

  // Sort by score, pick best
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    // No scientific pattern detected — return General
    return buildGeneralProfile(sheet);
  }

  const best = scores[0];
  const maxPossibleScore = [...best.signature.requiredPatterns, ...best.signature.optionalPatterns]
    .reduce((sum, p) => sum + p.weight, 0);
  const confidence = Math.min(best.score / maxPossibleScore, 1.0);

  const allDetected = [...best.matchedRequired, ...best.matchedOptional];

  // Detect sample IDs — columns that look like identifiers, not measurement data
  const sampleIds = detectSampleIds(columnNames, columns, allDetected);

  // Detect repeated measurements
  const hasRepeated = detectRepeatedMeasurements(columnNames);

  return {
    experimentType: best.signature.type,
    instrumentDescription: best.signature.description,
    detectedColumns: allDetected,
    sampleIds,
    hasRepeatedMeasurements: hasRepeated,
    confidence,
    supportedAnalyses: best.signature.supportedAnalyses,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findColumnMatch(
  columnNames: string[],
  columns: ColumnSchema[],
  pattern: ColumnPattern,
): DetectedColumn | null {
  for (let i = 0; i < columnNames.length; i++) {
    const colName = columnNames[i];
    for (const regex of pattern.patterns) {
      if (regex.test(colName)) {
        const unit = extractUnit(colName) || pattern.defaultUnit;
        // Higher confidence if the column has numeric data (for measurement columns)
        const col = columns[i];
        const isNumeric = col && (col.dtype === 'number');
        const confidence = isNumeric || pattern.role === 'element' || pattern.role === 'phase'
          ? 0.9
          : 0.6;

        return {
          name: colName,
          role: pattern.role,
          unit,
          confidence,
        };
      }
    }
  }
  return null;
}

function detectSampleIds(
  columnNames: string[],
  columns: ColumnSchema[],
  detectedScientific: DetectedColumn[],
): string[] {
  const scientificColNames = new Set(detectedScientific.map(d => d.name));
  const samplePatterns = [/sample/i, /specimen/i, /label/i, /name/i, /id/i, /code/i, /batch/i];

  return columnNames.filter((name, i) => {
    // Skip already-detected scientific columns
    if (scientificColNames.has(name)) return false;
    // Check if it matches sample ID patterns
    if (samplePatterns.some(p => p.test(name))) return true;
    // String columns with few unique values could be sample identifiers
    const col = columns[i];
    if (col && col.dtype === 'string' && col.sampleValues.length > 0 && col.sampleValues.length <= 20) {
      return true;
    }
    return false;
  });
}

function detectRepeatedMeasurements(columnNames: string[]): boolean {
  // Check for columns like "Run 1", "Run 2", "Trial 1", "Measurement 1", etc.
  const repeatPatterns = [/run\s*\d/i, /trial\s*\d/i, /measurement\s*\d/i, /rep\s*\d/i, /scan\s*\d/i];
  let matchCount = 0;
  for (const name of columnNames) {
    if (repeatPatterns.some(p => p.test(name))) matchCount++;
  }
  return matchCount >= 2;
}

function buildGeneralProfile(sheet: SheetData): ScientificDatasetProfile {
  const detectedColumns: DetectedColumn[] = sheet.columns.map(col => ({
    name: col.name,
    role: col.dtype === 'number' ? 'numeric_measurement' : 'categorical',
    unit: extractUnit(col.name),
    confidence: 0.3,
  }));

  return {
    experimentType: 'General',
    instrumentDescription: 'General laboratory measurement data',
    detectedColumns,
    sampleIds: detectSampleIds(sheet.headers, sheet.columns, []),
    hasRepeatedMeasurements: detectRepeatedMeasurements(sheet.headers),
    confidence: 0.2,
    supportedAnalyses: [
      'Descriptive statistics',
      'Data visualization',
      'Trend analysis',
      'Comparison',
    ],
  };
}
