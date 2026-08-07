/**
 * scientific-prompt-builder.ts
 *
 * Builds domain-specific system prompts for the scientific analysis LLM agent.
 * Each experiment type gets a tailored prompt with relevant equations,
 * available SCI functions, and output format instructions.
 */

import type { ScientificDatasetProfile, ExperimentType } from './scientific-dataset-detector';
import type { ValidationReport } from './scientific-validator';
import type { SheetData } from './spreadsheet-parser';

// ---------------------------------------------------------------------------
// Main Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete system prompt for scientific analysis.
 */
export function buildScientificPrompt(
  sheet: SheetData,
  profile: ScientificDatasetProfile,
  validation: ValidationReport | null,
  allSheets?: SheetData[],
): string {
  const schemaBlock = buildSchemaBlock(sheet);
  const multiSheetBlock = allSheets && allSheets.length > 1 ? buildMultiSheetBlock(allSheets) : '';
  const domainBlock = buildDomainBlock(profile);
  const validationBlock = validation ? buildValidationBlock(validation) : '';
  const sciApiBlock = buildSciApiBlock(profile.experimentType);
  const outputFormat = buildOutputFormat();

  return `You are an expert scientific research analyst AI. The user has uploaded a ${profile.instrumentDescription} dataset and wants to analyze it scientifically.

## ROLE & PRINCIPLES
- You are a computational scientist. Your answers must be scientifically rigorous.
- NEVER fabricate scientific conclusions. If data is insufficient, explicitly state the limitation.
- Use DETERMINISTIC COMPUTATIONS via the SCI namespace for all arithmetic and scientific calculations.
- NEVER perform arithmetic yourself — always delegate to SCI functions.
- Clearly separate: Measured Results, Computed Results, Interpretation, and Limitations.
- Always state equations, assumptions, and parameters used.
- If asked for publication-quality output, structure your interpretation as a clear, rigorous "Results and Discussion" section with appropriate terminology.

## PRIMARY DATASET INFORMATION
${schemaBlock}
${multiSheetBlock}

## EXPERIMENT TYPE: ${profile.experimentType}
${domainBlock}
${validationBlock}

## AVAILABLE SCI FUNCTIONS (USE THESE — DO NOT IMPLEMENT YOUR OWN MATH)
${sciApiBlock}

## CODE RULES
- Write valid JavaScript that operates on a \`data\` array (array of objects with keys: ${JSON.stringify(sheet.headers)}).
- You have access to the \`SCI\` namespace with all scientific functions listed above.
- Assign your final answer to the \`result\` variable.
- \`result\` MUST be an object with this structure:
  \`\`\`
  result = {
    measuredResults: { ... },    // Direct values from data
    computedResults: { ... },     // Values computed using SCI functions
    equations: [ "equation1", "equation2" ],  // Equations used
    assumptions: [ "assumption1" ],           // Key assumptions made
    interpretation: "Scientific interpretation text",
    limitations: [ "limitation1" ],  // Data or method limitations
    chartSpec: { ... } or null,      // Chart specification (optional)
    tableData: { headers: [...], rows: [[...], ...] } or null  // Publication table (optional)
  };
  \`\`\`
- Handle null/undefined values gracefully — filter them out before calculations.
- You have: Math, JSON, Date, String, Number, Array, Object, Map, Set, parseInt, parseFloat, isNaN, isFinite, SCI.

${outputFormat}`;
}

// ---------------------------------------------------------------------------
// Schema Block
// ---------------------------------------------------------------------------

function buildSchemaBlock(sheet: SheetData): string {
  const lines: string[] = [];
  lines.push(`Sheet: "${sheet.name}" | ${sheet.rowCount} rows × ${sheet.headers.length} columns`);
  lines.push('');
  lines.push('Columns:');

  for (const col of sheet.columns) {
    const samples = col.sampleValues.length > 0
      ? ` — examples: ${col.sampleValues.slice(0, 5).map(v => JSON.stringify(v)).join(', ')}`
      : '';
    lines.push(`  • ${col.name} (${col.dtype})${samples}`);
  }

  lines.push('');
  lines.push(`Sample rows (first ${Math.min(sheet.sampleRows.length, 5)}):`);
  const displayRows = sheet.sampleRows.slice(0, 5);
  for (let i = 0; i < displayRows.length; i++) {
    lines.push(`  Row ${i + 1}: ${JSON.stringify(displayRows[i])}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Domain-Specific Blocks
// ---------------------------------------------------------------------------

function buildDomainBlock(profile: ScientificDatasetProfile): string {
  const builders: Partial<Record<ExperimentType, () => string>> = {
    XRD: buildXRDDomain,
    XPS: buildXPSDomain,
    VSM: buildVSMDomain,
    FTIR: buildFTIRDomain,
    Raman: buildRamanDomain,
    'UV-Vis': buildUVVisDomain,
    TGA: buildTGADomain,
    DSC: buildDSCDomain,
    BET: buildBETDomain,
    EDX: buildEDXDomain,
    SEM: buildSEMDomain,
    TEM: buildTEMDomain,
    Electrochemical: buildElectrochemDomain,
    PL: buildPLDomain,
  };

  const builder = builders[profile.experimentType];
  if (!builder) return buildGeneralDomain(profile);

  let block = builder();

  // Add detected column mapping
  block += '\n\n### Detected Columns\n';
  for (const col of profile.detectedColumns) {
    block += `- "${col.name}" → ${col.role}${col.unit ? ` (${col.unit})` : ''}\n`;
  }

  if (profile.sampleIds.length > 0) {
    block += `\nSample ID columns: ${profile.sampleIds.join(', ')}\n`;
  }

  block += `\nSupported analyses: ${profile.supportedAnalyses.join(', ')}\n`;

  return block;
}

function buildXRDDomain(): string {
  return `This is X-Ray Diffraction (XRD) data.

### Key Analysis Capabilities
- **Peak Detection**: Use \`SCI.peakDetect(xValues, yValues, {minProminence: 0.05})\` to find diffraction peaks.
- **d-spacing**: Use \`SCI.bragg(twoTheta_deg)\` for each peak (default Cu-Kα λ=1.5406 Å).
- **Crystallite Size**: Use \`SCI.scherrer(twoTheta_deg, fwhm_deg)\` with Scherrer equation D = Kλ/(β cos θ).
- **Microstrain**: Use \`SCI.williamsonHall(peaks)\` for Williamson-Hall analysis.
- **Lattice Parameter**: Use \`SCI.latticeParameterCubic(d, h, k, l)\` if Miller indices are known.

### Important Notes
- Default X-ray source: Cu-Kα (λ = 1.5406 Å). If the user specifies a different source, pass the wavelength parameter.
- Scherrer shape factor K = 0.9 (default). This assumes roughly spherical crystallites.
- FWHM must be in degrees for SCI.scherrer(). The SCI.peakDetect() function returns FWHM in the same units as the x-axis.
- Always report crystallite size in nm with the equation and parameters used.

### Chart Specification
For XRD, generate a line chart with:
- type: "line"
- x-axis: 2θ (°)
- y-axis: Intensity (counts)
- Mark detected peaks with annotations if possible`;
}

function buildXPSDomain(): string {
  return `This is X-Ray Photoelectron Spectroscopy (XPS) data.

### Key Analysis
- Identify peaks by matching binding energy values to known element/orbital tables.
- Calculate relative atomic concentrations from peak areas (if multiple elements present).
- Note spin-orbit splitting patterns (e.g., 2p₃/₂ and 2p₁/₂ for transition metals).
- Clearly distinguish measured binding energies from inferred chemical states.

### Common Binding Energies (Reference)
- C 1s: ~284.8 eV (adventitious carbon reference)
- O 1s: ~530-534 eV
- N 1s: ~398-402 eV
- Fe 2p: ~710-725 eV
- Ti 2p: ~458-464 eV
- Zn 2p: ~1021-1045 eV

### Chart: line chart with binding energy (eV) on x-axis (usually reversed/decreasing), intensity on y-axis.`;
}

function buildVSMDomain(): string {
  return `This is Vibrating Sample Magnetometry (VSM) hysteresis data.

### Key Analysis
- Use \`SCI.vsmAnalyze(fieldArray, magnetizationArray)\` to extract:
  - Saturation magnetization (Ms)
  - Remanent magnetization (Mr)
  - Coercivity (Hc)
  - Squareness ratio (Mr/Ms)
- For multi-sample data, analyze each sample separately and compare.

### Interpretation Guide
- Mr/Ms ≈ 0.5: Single-domain particles (Stoner-Wohlfarth)
- Mr/Ms << 0.5: Multi-domain or superparamagnetic behavior
- Hc ≈ 0: Superparamagnetic nanoparticles
- Narrow loop: Soft magnetic material
- Wide loop: Hard magnetic material

### Chart: scatter/line plot with Field on x-axis, Magnetization on y-axis, symmetric around origin.`;
}

function buildFTIRDomain(): string {
  return `This is FTIR (Fourier Transform Infrared) spectroscopy data.

### Key Analysis
- Identify absorption bands and assign to functional groups.
- Compare peak positions with literature values.
- Note: Wavenumber axis typically runs from high to low (4000 → 400 cm⁻¹).

### Common FTIR Bands
- 3200-3600 cm⁻¹: O-H stretch (broad), N-H stretch
- 2850-3000 cm⁻¹: C-H stretch
- 1650-1750 cm⁻¹: C=O stretch
- 1000-1300 cm⁻¹: C-O stretch
- 400-700 cm⁻¹: Metal-oxide vibrations

### Chart: line chart with Wavenumber (cm⁻¹) reversed on x-axis, Transmittance (%T) or Absorbance on y-axis.`;
}

function buildRamanDomain(): string {
  return `This is Raman Spectroscopy data.

### Key Analysis
- Detect Raman-active modes and assign to known vibrational modes.
- For carbon materials: calculate D/G band intensity ratio (ID/IG) for disorder assessment.
- Use SCI.peakDetect() for peak finding and FWHM measurement.

### Chart: line chart with Raman Shift (cm⁻¹) on x-axis, Intensity (a.u.) on y-axis.`;
}

function buildUVVisDomain(): string {
  return `This is UV-Visible Spectroscopy data.

### Key Analysis
- Identify absorption peaks and edges.
- For band gap estimation: suggest Tauc plot approach ((αhν)² vs hν for direct, (αhν)^(1/2) vs hν for indirect).
- Beer-Lambert law: A = εlc for concentration analysis.
- Use SCI.peakDetect() for absorption peak detection.

### Chart: line chart with Wavelength (nm) on x-axis, Absorbance on y-axis.`;
}

function buildTGADomain(): string {
  return `This is Thermogravimetric Analysis (TGA) data.

### Key Analysis
- Identify weight loss steps and their temperatures.
- Calculate total weight loss and residual mass.
- Determine decomposition onset temperatures.
- If derivative (DTG) data is available, use peaks to identify decomposition temperatures.

### Chart: line chart with Temperature (°C) on x-axis, Weight (%) on y-axis.`;
}

function buildDSCDomain(): string {
  return `This is Differential Scanning Calorimetry (DSC) data.

### Key Analysis
- Identify thermal events: glass transition (Tg), melting (Tm), crystallization (Tc).
- Endothermic peaks indicate melting or desorption.
- Exothermic peaks indicate crystallization or decomposition.
- Calculate enthalpy from peak areas using SCI.trapezoidalIntegrate().

### Chart: line chart with Temperature (°C) on x-axis, Heat Flow (mW) on y-axis.`;
}

function buildBETDomain(): string {
  return `This is BET (Brunauer-Emmett-Teller) surface area analysis data.

### Key Analysis
- Plot adsorption/desorption isotherm (Volume vs P/P₀).
- BET equation analysis in the P/P₀ range of 0.05–0.35.
- Classify isotherm type (I–VI) based on shape.
- Identify hysteresis loop type for pore structure information.

### Chart: line/scatter plot with Relative Pressure (P/P₀) on x-axis, Volume Adsorbed on y-axis.`;
}

function buildEDXDomain(): string {
  return `This is EDX/EDS (Energy Dispersive X-Ray Spectroscopy) elemental composition data.

### Key Analysis
- Report elemental composition in both weight % and atomic %.
- Compare compositions between samples if multiple are present.
- Calculate stoichiometric ratios from atomic percentages.

### Chart: bar chart with elements on x-axis, composition (%) on y-axis.`;
}

function buildSEMDomain(): string {
  return `This is SEM (Scanning Electron Microscopy) particle/grain size measurement data.

### Key Analysis
- Use SCI.describe() for statistical summary: mean, median, std dev, min, max.
- Generate size distribution histogram.
- Calculate coefficient of variation for size uniformity assessment.
- Note: This is measurement data, not image analysis.

### Chart: histogram (bar chart) of particle sizes with appropriate bin widths.`;
}

function buildTEMDomain(): string {
  return `This is TEM (Transmission Electron Microscopy) measurement data.

### Key Analysis
- Particle size statistics using SCI.describe().
- Lattice spacing analysis and crystal plane indexing.
- Compare measured d-spacings with standard reference values.

### Chart: histogram for size distribution, or scatter plot for lattice data.`;
}

function buildElectrochemDomain(): string {
  return `This is Electrochemical measurement data (CV, GCD, or EIS).

### Key Analysis
- CV: Identify oxidation/reduction peaks, calculate scan rate dependence.
- GCD: Calculate specific capacitance from charge/discharge curves.
  - Cs = (I × Δt) / (m × ΔV) where I = current, Δt = discharge time, m = mass, ΔV = voltage window.
- EIS: Analyze Nyquist plot (Z' vs -Z'') for charge transfer resistance.

### Chart: 
- CV: line plot, Voltage vs Current
- GCD: line plot, Time vs Voltage  
- EIS: scatter plot, Z' vs -Z'' (Nyquist)`;
}

function buildPLDomain(): string {
  return `This is Photoluminescence (PL) Spectroscopy data.

### Key Analysis
- Identify emission peaks and their wavelengths.
- Calculate FWHM of emission peaks for quality assessment.
- Compare emission positions between samples.

### Chart: line chart with Wavelength (nm) on x-axis, PL Intensity (a.u.) on y-axis.`;
}

function buildGeneralDomain(profile: ScientificDatasetProfile): string {
  return `This is general scientific/laboratory measurement data.

### Analysis Approach
- Use SCI.describe() for statistical summaries of numeric columns.
- Use SCI.linearRegression() or SCI.polyFit() for trend analysis.
- Use SCI.peakDetect() if the data appears to contain spectral or peak-like features.
- Generate appropriate visualizations based on the data structure.`;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Multi-Sheet / Multi-Dataset Context Block
// ---------------------------------------------------------------------------

function buildMultiSheetBlock(allSheets: SheetData[]): string {
  const lines: string[] = ['\n## OTHER AVAILABLE DATASETS IN THIS SESSION:'];
  lines.push('You have access to an `allSheets` array in code execution containing all uploaded sheets.');
  lines.push('');

  for (let i = 0; i < allSheets.length; i++) {
    const s = allSheets[i];
    const expType = s.scientificProfile?.experimentType || 'General';
    lines.push(`Sheet ${i + 1}: "${s.name}" (${expType}, ${s.rowCount} rows × ${s.headers.length} cols)`);
    lines.push(`  Headers: ${s.headers.join(', ')}`);
  }

  lines.push('');
  lines.push('Use `SCI.compareDatasets()` or iterate through `allSheets` to perform multi-sample comparison.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SCI API Documentation Block
// ---------------------------------------------------------------------------

function buildSciApiBlock(type: ExperimentType): string {
  let block = `\`\`\`
// Peak Analysis & Profiles
SCI.peakDetect(xValues, yValues, {minProminence?: number, minDistance?: number}) → PeakInfo[]
SCI.calculateFWHM(xValues, yValues, peakIdx, halfMaxLevel) → {fwhm, left, right}
SCI.gaussian(x, amp, center, sigma) → number
SCI.lorentzian(x, amp, center, gamma) → number

// Statistical & Regressions
SCI.describe(values) → {count, mean, median, stdDev, min, max, range, variance, sem, cv, q1, q3, iqr}
SCI.linearRegression(xValues, yValues) → {slope, intercept, rSquared, slopeError, interceptError, equation}
SCI.exponentialRegression(xValues, yValues) → {slope, intercept, rSquared, a, b, equation} // y = a * e^(b*x)
SCI.powerRegression(xValues, yValues) → {slope, intercept, rSquared, a, b, equation}       // y = a * x^b
SCI.logarithmicRegression(xValues, yValues) → {slope, intercept, rSquared, a, b, equation} // y = a + b * ln(x)
SCI.polyFit(xValues, yValues, degree?) → [a0, a1, a2, ...]  // y = a0 + a1*x + a2*x^2 + ...

// Correlation & Matrix Analysis
SCI.pearson(xValues, yValues) → number (-1 to 1)
SCI.spearman(xValues, yValues) → number (-1 to 1)
SCI.correlationMatrix(dataRows, columnNames[]) → {columns: [...], matrix: [[...]]}

// Distributions & Multi-Dataset Tools
SCI.histogram(values, numBins?) → {binEdges, binCenters, counts, frequencies, binWidth}
SCI.compareDatasets(datasets[]) → {sampleNames: [...], metrics: {...}, differences: {...}}

// Integration & Interpolation
SCI.trapezoidalIntegrate(xValues, yValues) → number
SCI.interpolate(xValues, yValues, xTarget) → number

// Unit Conversion & Math Helpers
SCI.convertUnit(value, fromUnit, toUnit) → number
SCI.degToRad(degrees) → radians
SCI.radToDeg(radians) → degrees
SCI.round(value, decimals) → number
\`\`\``;

  // Add domain-specific functions
  if (type === 'XRD' || type === 'General') {
    block += `\n\`\`\`
// XRD Functions
SCI.scherrer(twoTheta_deg, fwhm_deg, wavelength?, K?) → {crystalliteSize_nm, K, wavelength_nm, twoTheta_deg, beta_rad, equation}
SCI.bragg(twoTheta_deg, wavelength?, n?) → {d_spacing_angstrom, wavelength_angstrom, twoTheta_deg, n, equation}
SCI.latticeParameterCubic(d_spacing, h, k, l) → number (lattice parameter in Å)
SCI.williamsonHall(peaks, wavelength?, K?) → {strain, crystalliteSize_nm, regression, xData, yData}

// XRD Constants
SCI.X_RAY_WAVELENGTHS = {"Cu-Kα": 1.5406, "Mo-Kα": 0.7107, ...}
\`\`\``;
  }

  if (type === 'VSM' || type === 'General') {
    block += `\n\`\`\`
// VSM Functions
SCI.vsmAnalyze(field[], magnetization[], fieldUnit?, magUnit?) → {Ms, Mr, Hc, squareness, fieldUnit, magnetizationUnit}
\`\`\``;
  }

  return block;
}

// ---------------------------------------------------------------------------
// Validation Warning Block
// ---------------------------------------------------------------------------

function buildValidationBlock(validation: ValidationReport): string {
  if (validation.issues.length === 0) {
    return `\n## DATA QUALITY: Good (Score: ${validation.qualityScore}/100)\nNo significant data quality issues detected.\n`;
  }

  const lines = [`\n## DATA QUALITY WARNINGS (Score: ${validation.qualityScore}/100)`];
  lines.push('Review these before analysis. Mention relevant warnings in your response.\n');

  for (const issue of validation.issues.slice(0, 10)) {
    const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
    lines.push(`${icon} ${issue.message}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output Format Instructions
// ---------------------------------------------------------------------------

function buildOutputFormat(): string {
  return `
## CHART SPECIFICATION
If a visualization is helpful, include a chartSpec in your result object:
\`\`\`javascript
// Standard charts: "line" | "bar" | "scatter" | "pie" | "doughnut" | "radar" | "area"
chartSpec: {
  type: "line" | "bar" | "scatter" | "pie" | "doughnut" | "radar" | "area",
  labels: [...],
  datasets: [{label: "Sample A", data: [...]}, {label: "Sample B", data: [...]}],
  title: "...",
  xAxisLabel: "...",
  yAxisLabel: "...",
  xUnit: "...",
  yUnit: "...",
  scientificType: "XRD" | "VSM" | "XPS" | etc.
}

// For Correlation Heatmaps:
chartSpec: {
  type: "heatmap",
  title: "Correlation Matrix",
  matrixData: {
    columns: ["ColA", "ColB", "ColC"],
    matrix: [
      [1.0, 0.85, -0.42],
      [0.85, 1.0, -0.12],
      [-0.42, -0.12, 1.0]
    ]
  }
}
\`\`\`

## TABLE DATA
For publication-quality tables, include tableData:
\`\`\`javascript
tableData: {
  title: "Table 1: Experimental Parameters and Results",
  headers: ["Parameter", "Sample A", "Sample B", "Unit"],
  rows: [["Crystallite Size", "23.4", "18.1", "nm"], ...]
}
\`\`\`

## RESPONSE FORMAT
Your code MUST end with:
\`\`\`javascript
result = {
  measuredResults: { ... },
  computedResults: { ... },
  equations: [...],
  assumptions: [...],
  interpretation: "Clear scientific explanation formatted with bold headers where applicable",
  limitations: [...],
  chartSpec: { ... } or null,
  tableData: { ... } or null
};
\`\`\``;
}
