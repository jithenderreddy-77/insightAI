/**
 * scientific-formulas.ts
 *
 * Deterministic, tested implementations of key scientific formulas.
 * These are injected into the VM sandbox as the `SCI` namespace so
 * LLM-generated code can call them directly instead of implementing
 * its own arithmetic.
 *
 * IMPORTANT: All functions are pure — no side effects, no external
 * dependencies beyond standard JavaScript Math.
 */

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface PeakInfo {
  /** Index in the original data array */
  index: number;
  /** X-axis value at the peak */
  x: number;
  /** Y-axis value at the peak */
  y: number;
  /** Full width at half maximum (in x-axis units) */
  fwhm: number;
  /** Left half-maximum x position */
  halfMaxLeft: number;
  /** Right half-maximum x position */
  halfMaxRight: number;
}

export interface ScherrerResult {
  /** Crystallite size in nm */
  crystalliteSize_nm: number;
  /** Shape factor K used */
  K: number;
  /** Wavelength used in nm */
  wavelength_nm: number;
  /** Peak angle 2θ in degrees */
  twoTheta_deg: number;
  /** FWHM β in radians */
  beta_rad: number;
  /** Equation used: D = Kλ / (β cos θ) */
  equation: string;
}

export interface BraggResult {
  /** d-spacing in Å */
  d_spacing_angstrom: number;
  /** Wavelength used in Å */
  wavelength_angstrom: number;
  /** Diffraction angle 2θ in degrees */
  twoTheta_deg: number;
  /** Order of diffraction */
  n: number;
  /** Equation used: nλ = 2d sin θ */
  equation: string;
}

export interface VSMResult {
  /** Saturation magnetization */
  Ms: number;
  /** Remanent magnetization */
  Mr: number;
  /** Coercivity */
  Hc: number;
  /** Squareness ratio Mr/Ms */
  squareness: number;
  /** Units of field */
  fieldUnit: string;
  /** Units of magnetization */
  magnetizationUnit: string;
}

export interface RegressionResult {
  /** Slope */
  slope: number;
  /** Intercept */
  intercept: number;
  /** R-squared coefficient of determination */
  rSquared: number;
  /** Standard error of the slope */
  slopeError: number;
  /** Standard error of the intercept */
  interceptError: number;
  /** Equation string: y = mx + b */
  equation: string;
}

export interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  range: number;
  variance: number;
  /** Standard error of the mean */
  sem: number;
  /** Coefficient of variation (%) */
  cv: number;
  /** First quartile */
  q1: number;
  /** Third quartile */
  q3: number;
  /** Interquartile range */
  iqr: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Common X-ray wavelengths in Å (Angstroms) */
const X_RAY_WAVELENGTHS: Record<string, number> = {
  'Cu-Kα': 1.5406,
  'Cu-Kα1': 1.5405,
  'Cu-Kα2': 1.5443,
  'Cu-Kβ': 1.3922,
  'Mo-Kα': 0.7107,
  'Mo-Kα1': 0.7093,
  'Co-Kα': 1.7890,
  'Cr-Kα': 2.2910,
  'Fe-Kα': 1.9373,
  'Ag-Kα': 0.5594,
};

// ---------------------------------------------------------------------------
// Peak Detection
// ---------------------------------------------------------------------------

/**
 * Detect peaks in 1D data using local maxima with prominence filtering.
 *
 * @param xValues - Array of x-axis values (e.g., 2θ angles)
 * @param yValues - Array of y-axis values (e.g., intensities)
 * @param options.minProminence - Minimum peak prominence as fraction of max intensity (default 0.05)
 * @param options.minDistance - Minimum distance between peaks in x-units (default 0)
 * @returns Array of PeakInfo objects sorted by intensity (descending)
 */
function peakDetect(
  xValues: number[],
  yValues: number[],
  options?: { minProminence?: number; minDistance?: number },
): PeakInfo[] {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 3) return [];

  const minProm = (options?.minProminence ?? 0.05);
  const minDist = options?.minDistance ?? 0;
  const yMax = Math.max(...yValues);
  const prominenceThreshold = minProm * yMax;

  // Find local maxima
  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (yValues[i] > yValues[i - 1] && yValues[i] >= yValues[i + 1]) {
      // Check prominence: difference from nearest valleys
      let leftMin = yValues[i];
      for (let j = i - 1; j >= 0; j--) {
        if (yValues[j] < leftMin) leftMin = yValues[j];
        if (yValues[j] > yValues[i]) break;
      }
      let rightMin = yValues[i];
      for (let j = i + 1; j < n; j++) {
        if (yValues[j] < rightMin) rightMin = yValues[j];
        if (yValues[j] > yValues[i]) break;
      }
      const prominence = yValues[i] - Math.max(leftMin, rightMin);
      if (prominence >= prominenceThreshold) {
        candidates.push(i);
      }
    }
  }

  // Apply minimum distance filter
  const filtered: number[] = [];
  for (const idx of candidates) {
    const tooClose = filtered.some(
      prev => Math.abs(xValues[idx] - xValues[prev]) < minDist
    );
    if (!tooClose) {
      filtered.push(idx);
    } else {
      // Keep the higher peak
      const closeIdx = filtered.findIndex(
        prev => Math.abs(xValues[idx] - xValues[prev]) < minDist
      );
      if (closeIdx >= 0 && yValues[idx] > yValues[filtered[closeIdx]]) {
        filtered[closeIdx] = idx;
      }
    }
  }

  // Calculate FWHM for each peak
  const peaks: PeakInfo[] = filtered.map(idx => {
    const halfMax = yValues[idx] / 2;
    const fwhmResult = calculateFWHM(xValues, yValues, idx, halfMax);
    return {
      index: idx,
      x: xValues[idx],
      y: yValues[idx],
      fwhm: fwhmResult.fwhm,
      halfMaxLeft: fwhmResult.left,
      halfMaxRight: fwhmResult.right,
    };
  });

  // Sort by intensity descending
  peaks.sort((a, b) => b.y - a.y);
  return peaks;
}

/**
 * Calculate FWHM for a peak at a given index.
 */
function calculateFWHM(
  xValues: number[],
  yValues: number[],
  peakIdx: number,
  halfMaxLevel: number,
): { fwhm: number; left: number; right: number } {
  const n = xValues.length;

  // Find left half-max crossing (linear interpolation)
  let leftX = xValues[peakIdx];
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (yValues[i] <= halfMaxLevel) {
      // Linear interpolation between i and i+1
      const frac = (halfMaxLevel - yValues[i]) / (yValues[i + 1] - yValues[i]);
      leftX = xValues[i] + frac * (xValues[i + 1] - xValues[i]);
      break;
    }
    if (i === 0) leftX = xValues[0];
  }

  // Find right half-max crossing
  let rightX = xValues[peakIdx];
  for (let i = peakIdx + 1; i < n; i++) {
    if (yValues[i] <= halfMaxLevel) {
      const frac = (halfMaxLevel - yValues[i]) / (yValues[i - 1] - yValues[i]);
      rightX = xValues[i] - frac * (xValues[i] - xValues[i - 1]);
      break;
    }
    if (i === n - 1) rightX = xValues[n - 1];
  }

  return {
    fwhm: Math.abs(rightX - leftX),
    left: leftX,
    right: rightX,
  };
}

// ---------------------------------------------------------------------------
// XRD Calculations
// ---------------------------------------------------------------------------

/**
 * Scherrer equation: Calculate crystallite size from XRD peak broadening.
 *
 *   D = Kλ / (β cos θ)
 *
 * @param twoTheta_deg - Peak position 2θ in degrees
 * @param fwhm_deg - Full width at half maximum in degrees
 * @param wavelength - X-ray wavelength in Å (default Cu-Kα = 1.5406 Å)
 * @param K - Shape factor (default 0.9)
 * @returns ScherrerResult with crystallite size in nm
 */
function scherrer(
  twoTheta_deg: number,
  fwhm_deg: number,
  wavelength?: number | string,
  K?: number,
): ScherrerResult {
  const shapeK = K ?? 0.9;

  // Resolve wavelength
  let lambda_angstrom: number;
  if (typeof wavelength === 'string') {
    lambda_angstrom = X_RAY_WAVELENGTHS[wavelength] ?? 1.5406;
  } else {
    lambda_angstrom = wavelength ?? 1.5406;
  }

  const theta_rad = (twoTheta_deg / 2) * (Math.PI / 180);
  const beta_rad = fwhm_deg * (Math.PI / 180);

  // D = Kλ / (β cos θ) → result in Å, convert to nm
  const D_angstrom = (shapeK * lambda_angstrom) / (beta_rad * Math.cos(theta_rad));
  const D_nm = D_angstrom / 10;

  return {
    crystalliteSize_nm: parseFloat(D_nm.toFixed(4)),
    K: shapeK,
    wavelength_nm: lambda_angstrom / 10,
    twoTheta_deg,
    beta_rad: parseFloat(beta_rad.toFixed(6)),
    equation: 'D = Kλ / (β cos θ)',
  };
}

/**
 * Bragg's law: Calculate d-spacing from diffraction angle.
 *
 *   nλ = 2d sin θ  →  d = nλ / (2 sin θ)
 *
 * @param twoTheta_deg - Diffraction angle 2θ in degrees
 * @param wavelength - X-ray wavelength in Å (default Cu-Kα = 1.5406 Å)
 * @param n - Order of diffraction (default 1)
 * @returns BraggResult with d-spacing in Å
 */
function bragg(
  twoTheta_deg: number,
  wavelength?: number | string,
  n?: number,
): BraggResult {
  const order = n ?? 1;

  let lambda_angstrom: number;
  if (typeof wavelength === 'string') {
    lambda_angstrom = X_RAY_WAVELENGTHS[wavelength] ?? 1.5406;
  } else {
    lambda_angstrom = wavelength ?? 1.5406;
  }

  const theta_rad = (twoTheta_deg / 2) * (Math.PI / 180);
  const d = (order * lambda_angstrom) / (2 * Math.sin(theta_rad));

  return {
    d_spacing_angstrom: parseFloat(d.toFixed(4)),
    wavelength_angstrom: lambda_angstrom,
    twoTheta_deg,
    n: order,
    equation: 'nλ = 2d sin θ',
  };
}

/**
 * Estimate lattice parameter 'a' for a cubic crystal system.
 *
 *   a = d × √(h² + k² + l²)
 *
 * @param d_spacing - d-spacing in Å
 * @param h - Miller index h
 * @param k - Miller index k
 * @param l - Miller index l
 * @returns Lattice parameter 'a' in Å
 */
function latticeParameterCubic(
  d_spacing: number,
  h: number,
  k: number,
  l: number,
): number {
  return parseFloat((d_spacing * Math.sqrt(h * h + k * k + l * l)).toFixed(4));
}

/**
 * Williamson-Hall analysis for microstrain estimation.
 * Plots β cos θ vs 4 sin θ; slope = microstrain ε, intercept = Kλ/D.
 *
 * @param peaks - Array of { twoTheta_deg, fwhm_deg }
 * @param wavelength - X-ray wavelength in Å (default Cu-Kα)
 * @param K - Shape factor (default 0.9)
 * @returns { strain, crystalliteSize_nm, regression }
 */
function williamsonHall(
  peaks: Array<{ twoTheta_deg: number; fwhm_deg: number }>,
  wavelength?: number,
  K?: number,
): { strain: number; crystalliteSize_nm: number; regression: RegressionResult; xData: number[]; yData: number[] } {
  const lambda = wavelength ?? 1.5406;
  const shapeK = K ?? 0.9;

  const xData: number[] = []; // 4 sin θ
  const yData: number[] = []; // β cos θ

  for (const peak of peaks) {
    const theta = (peak.twoTheta_deg / 2) * (Math.PI / 180);
    const beta = peak.fwhm_deg * (Math.PI / 180);
    xData.push(4 * Math.sin(theta));
    yData.push(beta * Math.cos(theta));
  }

  const reg = linearRegression(xData, yData);
  const strain = Math.abs(reg.slope);
  const D_angstrom = (shapeK * lambda) / reg.intercept;
  const D_nm = Math.abs(D_angstrom) / 10;

  return {
    strain: parseFloat(strain.toFixed(6)),
    crystalliteSize_nm: parseFloat(D_nm.toFixed(4)),
    regression: reg,
    xData,
    yData,
  };
}

// ---------------------------------------------------------------------------
// VSM Analysis
// ---------------------------------------------------------------------------

/**
 * Extract key parameters from VSM hysteresis loop data.
 *
 * @param field - Array of magnetic field values
 * @param magnetization - Array of magnetization values
 * @param fieldUnit - Unit of field (default 'Oe')
 * @param magUnit - Unit of magnetization (default 'emu/g')
 * @returns VSMResult with Ms, Mr, Hc, squareness
 */
function vsmAnalyze(
  field: number[],
  magnetization: number[],
  fieldUnit?: string,
  magUnit?: string,
): VSMResult {
  const n = Math.min(field.length, magnetization.length);
  if (n < 4) {
    return { Ms: 0, Mr: 0, Hc: 0, squareness: 0, fieldUnit: fieldUnit || 'Oe', magnetizationUnit: magUnit || 'emu/g' };
  }

  // Ms: maximum absolute magnetization
  let maxMag = 0;
  for (let i = 0; i < n; i++) {
    const absMag = Math.abs(magnetization[i]);
    if (absMag > maxMag) maxMag = absMag;
  }
  const Ms = maxMag;

  // Mr: magnetization at zero field (interpolated)
  // Find zero-crossings of field and interpolate magnetization
  let Mr = 0;
  const mrValues: number[] = [];
  for (let i = 1; i < n; i++) {
    if ((field[i - 1] <= 0 && field[i] >= 0) || (field[i - 1] >= 0 && field[i] <= 0)) {
      if (field[i] === field[i - 1]) {
        mrValues.push(Math.abs(magnetization[i]));
      } else {
        const frac = (0 - field[i - 1]) / (field[i] - field[i - 1]);
        const mInterp = magnetization[i - 1] + frac * (magnetization[i] - magnetization[i - 1]);
        mrValues.push(Math.abs(mInterp));
      }
    }
  }
  if (mrValues.length > 0) {
    Mr = mrValues.reduce((a, b) => a + b, 0) / mrValues.length;
  }

  // Hc: field at zero magnetization (interpolated)
  let Hc = 0;
  const hcValues: number[] = [];
  for (let i = 1; i < n; i++) {
    if ((magnetization[i - 1] <= 0 && magnetization[i] >= 0) ||
        (magnetization[i - 1] >= 0 && magnetization[i] <= 0)) {
      if (magnetization[i] === magnetization[i - 1]) {
        hcValues.push(Math.abs(field[i]));
      } else {
        const frac = (0 - magnetization[i - 1]) / (magnetization[i] - magnetization[i - 1]);
        const hInterp = field[i - 1] + frac * (field[i] - field[i - 1]);
        hcValues.push(Math.abs(hInterp));
      }
    }
  }
  if (hcValues.length > 0) {
    Hc = hcValues.reduce((a, b) => a + b, 0) / hcValues.length;
  }

  const squareness = Ms > 0 ? parseFloat((Mr / Ms).toFixed(4)) : 0;

  return {
    Ms: parseFloat(Ms.toFixed(6)),
    Mr: parseFloat(Mr.toFixed(6)),
    Hc: parseFloat(Hc.toFixed(4)),
    squareness,
    fieldUnit: fieldUnit || 'Oe',
    magnetizationUnit: magUnit || 'emu/g',
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics for an array of numbers.
 */
function describe(values: number[]): DescriptiveStats {
  const clean = values.filter(v => !isNaN(v) && isFinite(v));
  const n = clean.length;
  if (n === 0) {
    return { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0, range: 0, variance: 0, sem: 0, cv: 0, q1: 0, q3: 0, iqr: 0 };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const sum = clean.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  const variance = clean.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1 || 1);
  const stdDev = Math.sqrt(variance);
  const sem = stdDev / Math.sqrt(n);
  const cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];

  return {
    count: n,
    mean: parseFloat(mean.toFixed(6)),
    median: parseFloat(median.toFixed(6)),
    stdDev: parseFloat(stdDev.toFixed(6)),
    min: sorted[0],
    max: sorted[n - 1],
    range: parseFloat((sorted[n - 1] - sorted[0]).toFixed(6)),
    variance: parseFloat(variance.toFixed(6)),
    sem: parseFloat(sem.toFixed(6)),
    cv: parseFloat(cv.toFixed(4)),
    q1,
    q3,
    iqr: parseFloat((q3 - q1).toFixed(6)),
  };
}

/**
 * Linear regression: y = mx + b
 */
function linearRegression(xValues: number[], yValues: number[]): RegressionResult {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) {
    return { slope: 0, intercept: 0, rSquared: 0, slopeError: 0, interceptError: 0, equation: 'y = 0x + 0' };
  }

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xValues[i];
    sumY += yValues[i];
    sumXY += xValues[i] * yValues[i];
    sumX2 += xValues[i] * xValues[i];
    sumY2 += yValues[i] * yValues[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-15) {
    return { slope: 0, intercept: sumY / n, rSquared: 0, slopeError: 0, interceptError: 0, equation: `y = ${(sumY / n).toFixed(4)}` };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yValues[i] - yMean) ** 2;
    const yPred = slope * xValues[i] + intercept;
    ssRes += (yValues[i] - yPred) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Standard errors
  const mse = ssRes / (n - 2 || 1);
  const slopeError = Math.sqrt(mse * n / denom);
  const interceptError = Math.sqrt(mse * sumX2 / denom);

  const slopeStr = slope >= 0 ? slope.toFixed(4) : `(${slope.toFixed(4)})`;
  const interceptStr = intercept >= 0 ? `+ ${intercept.toFixed(4)}` : `- ${Math.abs(intercept).toFixed(4)}`;

  return {
    slope: parseFloat(slope.toFixed(6)),
    intercept: parseFloat(intercept.toFixed(6)),
    rSquared: parseFloat(rSquared.toFixed(6)),
    slopeError: parseFloat(slopeError.toFixed(6)),
    interceptError: parseFloat(interceptError.toFixed(6)),
    equation: `y = ${slopeStr}x ${interceptStr}`,
  };
}

/**
 * Polynomial fit of degree N using least squares.
 *
 * @param xValues - x data
 * @param yValues - y data
 * @param degree - polynomial degree (default 2)
 * @returns coefficients [a0, a1, a2, ...] where y = a0 + a1*x + a2*x^2 + ...
 */
function polyFit(xValues: number[], yValues: number[], degree?: number): number[] {
  const n = Math.min(xValues.length, yValues.length);
  const deg = degree ?? 2;
  const m = deg + 1;

  if (n < m) return new Array(m).fill(0);

  // Build Vandermonde-like normal equations: (X^T X) a = X^T y
  const xtx: number[][] = [];
  const xty: number[] = [];

  for (let i = 0; i < m; i++) {
    xtx[i] = [];
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += Math.pow(xValues[k], i + j);
      }
      xtx[i][j] = sum;
    }
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += yValues[k] * Math.pow(xValues[k], i);
    }
    xty[i] = sum;
  }

  // Solve via Gaussian elimination
  return solveLinearSystem(xtx, xty);
}

/**
 * Solve a linear system Ax = b using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) continue;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(aug[i][i]) < 1e-12) continue;
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i][j] * x[j];
    }
    x[i] = sum / aug[i][i];
  }

  return x.map(v => parseFloat(v.toFixed(8)));
}

/**
 * Numerical integration using the trapezoidal rule.
 *
 * @param xValues - x data (must be sorted)
 * @param yValues - y data
 * @returns Integral value
 */
function trapezoidalIntegrate(xValues: number[], yValues: number[]): number {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) return 0;

  let integral = 0;
  for (let i = 1; i < n; i++) {
    integral += 0.5 * (yValues[i] + yValues[i - 1]) * (xValues[i] - xValues[i - 1]);
  }
  return parseFloat(integral.toFixed(8));
}

/**
 * Linear interpolation at a specific x value.
 */
function interpolate(xValues: number[], yValues: number[], xTarget: number): number {
  const n = Math.min(xValues.length, yValues.length);
  if (n === 0) return 0;
  if (n === 1) return yValues[0];

  // Find bracketing interval
  for (let i = 1; i < n; i++) {
    if ((xValues[i - 1] <= xTarget && xValues[i] >= xTarget) ||
        (xValues[i - 1] >= xTarget && xValues[i] <= xTarget)) {
      const frac = (xTarget - xValues[i - 1]) / (xValues[i] - xValues[i - 1]);
      return yValues[i - 1] + frac * (yValues[i] - yValues[i - 1]);
    }
  }

  // Extrapolation: use nearest edge
  return xTarget < xValues[0] ? yValues[0] : yValues[n - 1];
}

/**
 * Convert between common scientific units.
 */
function convertUnit(value: number, from: string, to: string): number {
  const conversions: Record<string, Record<string, number>> = {
    // Length
    'nm': { 'Å': 10, 'μm': 0.001, 'mm': 1e-6, 'm': 1e-9 },
    'Å': { 'nm': 0.1, 'μm': 1e-4, 'mm': 1e-7, 'm': 1e-10 },
    'μm': { 'nm': 1000, 'Å': 10000, 'mm': 0.001, 'm': 1e-6 },
    // Energy
    'eV': { 'keV': 0.001, 'J': 1.602e-19 },
    'keV': { 'eV': 1000, 'J': 1.602e-16 },
    // Magnetic field
    'Oe': { 'A/m': 79.5775, 'T': 1e-4 / (4 * Math.PI), 'G': 1 },
    'T': { 'G': 10000, 'Oe': 10000 / (4 * Math.PI) },
    'G': { 'T': 1e-4, 'Oe': 1 },
    // Temperature
    '°C': { 'K': NaN, '°F': NaN }, // Special handling needed
    'K': { '°C': NaN, '°F': NaN },
  };

  // Temperature special cases
  if (from === '°C' && to === 'K') return value + 273.15;
  if (from === 'K' && to === '°C') return value - 273.15;
  if (from === '°C' && to === '°F') return value * 9 / 5 + 32;
  if (from === '°F' && to === '°C') return (value - 32) * 5 / 9;

  const factor = conversions[from]?.[to];
  if (factor !== undefined && !isNaN(factor)) {
    return parseFloat((value * factor).toFixed(8));
  }

  // Try reverse
  const reverseFactor = conversions[to]?.[from];
  if (reverseFactor !== undefined && !isNaN(reverseFactor) && reverseFactor !== 0) {
    return parseFloat((value / reverseFactor).toFixed(8));
  }

  // Unknown conversion
  return value;
}

// ---------------------------------------------------------------------------
// Correlation & Matrix Analysis
// ---------------------------------------------------------------------------

/**
 * Compute Pearson correlation coefficient r between two numeric arrays.
 */
function pearson(xValues: number[], yValues: number[]): number {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) return 0;

  const statsX = describe(xValues);
  const statsY = describe(yValues);

  if (statsX.stdDev === 0 || statsY.stdDev === 0) return 0;

  let sumCov = 0;
  for (let i = 0; i < n; i++) {
    sumCov += (xValues[i] - statsX.mean) * (yValues[i] - statsY.mean);
  }

  const r = sumCov / ((n - 1) * statsX.stdDev * statsY.stdDev);
  return parseFloat(Math.max(-1, Math.min(1, r)).toFixed(4));
}

/**
 * Compute Spearman rank correlation coefficient.
 */
function spearman(xValues: number[], yValues: number[]): number {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) return 0;

  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      ranks[sorted[i].i] = i + 1;
    }
    return ranks;
  };

  const rankX = rank(xValues.slice(0, n));
  const rankY = rank(yValues.slice(0, n));

  return pearson(rankX, rankY);
}

export interface CorrelationMatrixResult {
  columns: string[];
  matrix: number[][];
}

/**
 * Compute full Pearson correlation matrix for specified numeric columns in data array.
 */
function correlationMatrix(data: Record<string, unknown>[], columns: string[]): CorrelationMatrixResult {
  const nCols = columns.length;
  const matrix: number[][] = Array.from({ length: nCols }, () => new Array(nCols).fill(1));

  const colValues: Record<string, number[]> = {};
  for (const col of columns) {
    colValues[col] = data
      .map(r => r[col])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v) && isFinite(v));
  }

  for (let i = 0; i < nCols; i++) {
    for (let j = i + 1; j < nCols; j++) {
      const c1 = columns[i];
      const c2 = columns[j];
      const v1: number[] = [];
      const v2: number[] = [];

      for (const row of data) {
        const val1 = row[c1];
        const val2 = row[c2];
        if (typeof val1 === 'number' && !isNaN(val1) && typeof val2 === 'number' && !isNaN(val2)) {
          v1.push(val1);
          v2.push(val2);
        }
      }

      const r = pearson(v1, v2);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }

  return { columns, matrix };
}

// ---------------------------------------------------------------------------
// Non-Linear Curve Fitting
// ---------------------------------------------------------------------------

/**
 * Exponential fit: y = a * exp(b * x)
 */
function exponentialRegression(xValues: number[], yValues: number[]): RegressionResult & { a: number; b: number } {
  // Linearize by taking ln(y): ln(y) = ln(a) + b*x
  const validX: number[] = [];
  const lnY: number[] = [];

  for (let i = 0; i < Math.min(xValues.length, yValues.length); i++) {
    if (yValues[i] > 0) {
      validX.push(xValues[i]);
      lnY.push(Math.log(yValues[i]));
    }
  }

  const linFit = linearRegression(validX, lnY);
  const a = Math.exp(linFit.intercept);
  const b = linFit.slope;

  return {
    ...linFit,
    a: parseFloat(a.toFixed(6)),
    b: parseFloat(b.toFixed(6)),
    equation: `y = ${a.toFixed(4)} * exp(${b.toFixed(4)} * x)`,
  };
}

/**
 * Power law fit: y = a * x^b
 */
function powerRegression(xValues: number[], yValues: number[]): RegressionResult & { a: number; b: number } {
  // Linearize by taking ln(x) and ln(y): ln(y) = ln(a) + b*ln(x)
  const lnX: number[] = [];
  const lnY: number[] = [];

  for (let i = 0; i < Math.min(xValues.length, yValues.length); i++) {
    if (xValues[i] > 0 && yValues[i] > 0) {
      lnX.push(Math.log(xValues[i]));
      lnY.push(Math.log(yValues[i]));
    }
  }

  const linFit = linearRegression(lnX, lnY);
  const a = Math.exp(linFit.intercept);
  const b = linFit.slope;

  return {
    ...linFit,
    a: parseFloat(a.toFixed(6)),
    b: parseFloat(b.toFixed(6)),
    equation: `y = ${a.toFixed(4)} * x^(${b.toFixed(4)})`,
  };
}

/**
 * Logarithmic fit: y = a + b * ln(x)
 */
function logarithmicRegression(xValues: number[], yValues: number[]): RegressionResult & { a: number; b: number } {
  const lnX: number[] = [];
  const validY: number[] = [];

  for (let i = 0; i < Math.min(xValues.length, yValues.length); i++) {
    if (xValues[i] > 0) {
      lnX.push(Math.log(xValues[i]));
      validY.push(yValues[i]);
    }
  }

  const linFit = linearRegression(lnX, validY);
  return {
    ...linFit,
    a: linFit.intercept,
    b: linFit.slope,
    equation: `y = ${linFit.intercept.toFixed(4)} + ${linFit.slope.toFixed(4)} * ln(x)`,
  };
}

// ---------------------------------------------------------------------------
// Peak Profile Functions (Gaussian & Lorentzian)
// ---------------------------------------------------------------------------

/**
 * Evaluate Gaussian peak profile: y = amp * exp(-((x - center)^2) / (2 * sigma^2))
 */
function gaussian(x: number, amp: number, center: number, sigma: number): number {
  if (sigma === 0) return 0;
  return amp * Math.exp(-Math.pow(x - center, 2) / (2 * Math.pow(sigma, 2)));
}

/**
 * Evaluate Lorentzian peak profile: y = amp / (1 + ((x - center) / gamma)^2)
 */
function lorentzian(x: number, amp: number, center: number, gamma: number): number {
  if (gamma === 0) return 0;
  return amp / (1 + Math.pow((x - center) / gamma, 2));
}

// ---------------------------------------------------------------------------
// Histogram & Distribution Analysis
// ---------------------------------------------------------------------------

export interface HistogramResult {
  binEdges: number[];
  binCenters: number[];
  counts: number[];
  frequencies: number[]; // relative frequencies (sums to 1)
  binWidth: number;
}

/**
 * Bin 1D array into histogram with specified number of bins.
 */
function histogram(values: number[], numBins: number = 10): HistogramResult {
  const clean = values.filter(v => !isNaN(v) && isFinite(v));
  if (clean.length === 0) {
    return { binEdges: [], binCenters: [], counts: [], frequencies: [], binWidth: 0 };
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const binWidth = range / numBins;

  const binEdges: number[] = [];
  for (let i = 0; i <= numBins; i++) {
    binEdges.push(parseFloat((min + i * binWidth).toFixed(4)));
  }

  const binCenters: number[] = [];
  for (let i = 0; i < numBins; i++) {
    binCenters.push(parseFloat(((binEdges[i] + binEdges[i + 1]) / 2).toFixed(4)));
  }

  const counts = new Array(numBins).fill(0);
  for (const v of clean) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  const total = clean.length;
  const frequencies = counts.map(c => parseFloat((c / total).toFixed(4)));

  return { binEdges, binCenters, counts, frequencies, binWidth: parseFloat(binWidth.toFixed(4)) };
}

// ---------------------------------------------------------------------------
// Multi-Dataset Alignment & Comparison
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  sampleNames: string[];
  metrics: Record<string, (number | string)[]>;
  differences: Record<string, string>;
}

/**
 * Compare key summary metrics between multiple datasets / samples.
 */
function compareDatasets(
  datasets: Array<{ name: string; metrics: Record<string, number | string> }>
): ComparisonResult {
  const sampleNames = datasets.map(d => d.name);
  const allMetricKeys = Array.from(new Set(datasets.flatMap(d => Object.keys(d.metrics))));

  const metrics: Record<string, (number | string)[]> = {};
  const differences: Record<string, string> = {};

  for (const key of allMetricKeys) {
    const vals = datasets.map(d => d.metrics[key] ?? '—');
    metrics[key] = vals;

    // Check numerical differences
    const numVals = vals.filter((v): v is number => typeof v === 'number');
    if (numVals.length >= 2) {
      const minVal = Math.min(...numVals);
      const maxVal = Math.max(...numVals);
      const pctDiff = minVal !== 0 ? (((maxVal - minVal) / Math.abs(minVal)) * 100).toFixed(1) : 'N/A';
      differences[key] = `${maxVal > minVal ? '+' : ''}${pctDiff}% range`;
    }
  }

  return { sampleNames, metrics, differences };
}

// ---------------------------------------------------------------------------
// Export namespace object for sandbox injection
// ---------------------------------------------------------------------------

/**
 * The SCI namespace — injected into the VM sandbox for LLM-generated
 * scientific analysis code. All functions are deterministic and pure.
 */
export const SCI = {
  // Peak analysis
  peakDetect,
  calculateFWHM,
  gaussian,
  lorentzian,

  // XRD
  scherrer,
  bragg,
  latticeParameterCubic,
  williamsonHall,

  // VSM
  vsmAnalyze,

  // Statistics & Regressions
  describe,
  linearRegression,
  exponentialRegression,
  powerRegression,
  logarithmicRegression,
  polyFit,
  trapezoidalIntegrate,
  interpolate,

  // Correlation Matrix
  pearson,
  spearman,
  correlationMatrix,

  // Distributions & Comparisons
  histogram,
  compareDatasets,

  // Utilities
  convertUnit,

  // Constants
  X_RAY_WAVELENGTHS,

  // Math helpers (convenient shortcuts)
  degToRad: (deg: number) => deg * Math.PI / 180,
  radToDeg: (rad: number) => rad * 180 / Math.PI,
  round: (val: number, decimals: number) => parseFloat(val.toFixed(decimals)),
};

