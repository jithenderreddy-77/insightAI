'use client';

/**
 * ScientificReport — Renders structured scientific analysis results.
 *
 * Displays: dataset profile, validation warnings, measured/computed results,
 * equations, assumptions, limitations, publication-quality tables,
 * and integrated charts with scientific axis labels.
 */

import React, { useState } from 'react';
import {
  Beaker,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Download,
  Info,
  Microscope,
} from 'lucide-react';
import { DataChart } from '@/components/data-chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScientificReportData {
  result: {
    measuredResults?: Record<string, unknown> | null;
    computedResults?: Record<string, unknown> | null;
    equations?: string[];
    assumptions?: string[];
    interpretation?: string;
    limitations?: string[];
    chartSpec?: {
      type: 'line' | 'bar' | 'scatter' | 'pie' | 'doughnut' | 'radar' | 'area' | 'heatmap';
      labels?: string[];
      datasets?: Array<{ label: string; data: number[] }>;
      title?: string;
      xAxisLabel?: string;
      yAxisLabel?: string;
      xUnit?: string;
      yUnit?: string;
      scientificType?: string;
      matrixData?: {
        columns: string[];
        matrix: number[][];
      };
    } | null;
    tableData?: {
      title?: string;
      headers: string[];
      rows: (string | number)[][];
    } | null;
  };
  experimentType: string;
  instrumentDescription?: string;
  dataQualityScore?: number | null;
  explanation?: string;
  code?: string | null;
  executionTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScientificReport({ data }: { data: ScientificReportData }) {
  const [showCode, setShowCode] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const { result, experimentType, instrumentDescription, dataQualityScore, explanation, code, executionTimeMs } = data;

  return (
    <div className="space-y-4 my-3">
      {/* Header Badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 dark:border-emerald-400/20">
          <Microscope className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
            {experimentType} Analysis
          </span>
        </div>
        {instrumentDescription && instrumentDescription !== 'General laboratory measurement data' && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {instrumentDescription}
          </span>
        )}
        {dataQualityScore != null && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${
            dataQualityScore >= 80
              ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
              : dataQualityScore >= 50
              ? 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-300'
              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}>
            {dataQualityScore >= 80 ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            Data Quality: {dataQualityScore}/100
          </div>
        )}
      </div>

      {/* Interpretation */}
      {result.interpretation && (
        <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          {result.interpretation}
        </div>
      )}

      {/* Computed Results */}
      {result.computedResults && Object.keys(result.computedResults).length > 0 && (
        <ResultSection
          title="Computed Results"
          icon={<FlaskConical className="w-4 h-4" />}
          accentColor="indigo"
        >
          <ResultGrid results={result.computedResults} />
        </ResultSection>
      )}

      {/* Measured Results */}
      {result.measuredResults && Object.keys(result.measuredResults).length > 0 && (
        <ResultSection
          title="Measured Results"
          icon={<Beaker className="w-4 h-4" />}
          accentColor="sky"
        >
          <ResultGrid results={result.measuredResults} />
        </ResultSection>
      )}

      {/* Publication Table */}
      {result.tableData && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700/50">
          {result.tableData.title && (
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/50">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {result.tableData.title}
              </span>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/30">
                {result.tableData.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700/50"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.tableData.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 === 0
                    ? 'bg-white dark:bg-slate-900/20'
                    : 'bg-slate-50/50 dark:bg-slate-800/20'
                  }
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-4 py-2 text-xs text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800/50 font-mono"
                    >
                      {formatCellValue(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Chart */}
      {result.chartSpec && (
        <DataChart
          type={result.chartSpec.type}
          labels={result.chartSpec.labels}
          datasets={result.chartSpec.datasets}
          title={result.chartSpec.title}
          xAxisLabel={result.chartSpec.xAxisLabel}
          yAxisLabel={result.chartSpec.yAxisLabel}
          xUnit={result.chartSpec.xUnit}
          yUnit={result.chartSpec.yUnit}
          scientificType={result.chartSpec.scientificType}
        />
      )}

      {/* Equations */}
      {result.equations && result.equations.length > 0 && (
        <div className="rounded-xl border border-violet-200/50 dark:border-violet-800/30 bg-violet-50/30 dark:bg-violet-950/10 p-3">
          <div className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-2">
            Equations Used
          </div>
          <div className="space-y-1">
            {result.equations.map((eq, i) => (
              <div key={i} className="text-sm font-mono text-violet-800 dark:text-violet-200 bg-violet-100/50 dark:bg-violet-900/20 px-3 py-1.5 rounded-lg">
                {eq}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assumptions & Limitations (Collapsible) */}
      {((result.assumptions && result.assumptions.length > 0) || (result.limitations && result.limitations.length > 0)) && (
        <button
          onClick={() => setShowAssumptions(!showAssumptions)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          {showAssumptions ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Info className="w-3 h-3" />
          Assumptions & Limitations
        </button>
      )}
      {showAssumptions && (
        <div className="space-y-2 ml-5">
          {result.assumptions && result.assumptions.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase mb-1">Assumptions</div>
              <ul className="space-y-0.5">
                {result.assumptions.map((a, i) => (
                  <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                    <span className="text-amber-400 mt-0.5">•</span> {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.limitations && result.limitations.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase mb-1">Limitations</div>
              <ul className="space-y-0.5">
                {result.limitations.map((l, i) => (
                  <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                    <span className="text-orange-400 mt-0.5">•</span> {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Reasoning / Code (Collapsible) */}
      {code && (
        <button
          onClick={() => setShowCode(!showCode)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {showCode ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          🔍 Show reasoning
          {executionTimeMs != null && (
            <span className="text-[10px] text-slate-400">({executionTimeMs}ms)</span>
          )}
        </button>
      )}
      {showCode && code && (
        <pre className="text-[11px] bg-slate-950 text-green-400 p-3 rounded-xl overflow-x-auto max-h-[300px]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

function ResultSection({
  title,
  icon,
  accentColor,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  children: React.ReactNode;
}) {
  const colorClasses: Record<string, string> = {
    indigo: 'border-indigo-200/50 dark:border-indigo-800/30 bg-indigo-50/30 dark:bg-indigo-950/10 text-indigo-600 dark:text-indigo-400',
    sky: 'border-sky-200/50 dark:border-sky-800/30 bg-sky-50/30 dark:bg-sky-950/10 text-sky-600 dark:text-sky-400',
    emerald: 'border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-400',
  };

  const cls = colorClasses[accentColor] || colorClasses.indigo;

  return (
    <div className={`rounded-xl border p-3 ${cls.split(' ').filter(c => c.startsWith('border-') || c.startsWith('bg-')).join(' ')}`}>
      <div className={`flex items-center gap-1.5 mb-2 ${cls.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function ResultGrid({ results }: { results: Record<string, unknown> }) {
  const entries = Object.entries(results);
  if (entries.length === 0) return null;

  // Check if any value is an object/array (nested results)
  const isNested = entries.some(([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v));

  if (isNested) {
    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key}>
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              {formatLabel(key)}
            </div>
            {typeof val === 'object' && val !== null && !Array.isArray(val) ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 ml-2">
                {Object.entries(val as Record<string, unknown>).map(([subKey, subVal]) => (
                  <div key={subKey} className="bg-white/60 dark:bg-slate-800/40 rounded-lg p-2">
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{formatLabel(subKey)}</div>
                    <div className="text-sm font-mono font-semibold text-slate-800 dark:text-slate-100">
                      {formatValue(subVal)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200 ml-2">
                {formatValue(val)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([key, val]) => (
        <div key={key} className="bg-white/60 dark:bg-slate-800/40 rounded-lg p-2">
          <div className="text-[10px] text-slate-400 dark:text-slate-500">{formatLabel(key)}</div>
          <div className="text-sm font-mono font-semibold text-slate-800 dark:text-slate-100">
            {formatValue(val)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString();
    if (Math.abs(val) < 0.001 || Math.abs(val) >= 1e6) return val.toExponential(4);
    return val.toFixed(4);
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) return val.map(v => formatValue(v)).join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function formatCellValue(val: string | number): string {
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString();
    if (Math.abs(val) < 0.001 || Math.abs(val) >= 1e6) return val.toExponential(4);
    return val.toFixed(4);
  }
  return String(val);
}
