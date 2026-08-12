'use client';

/**
 * DataChart — Interactive Chart.js component for spreadsheet query results.
 *
 * Auto-renders bar/pie/line/scatter/doughnut charts with premium styling,
 * dark mode support, and glassmorphism aesthetics matching the Insight AI UI.
 */

import React, { useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut, Scatter, Radar } from 'react-chartjs-2';
import { Download, Table, Code2, ChevronDown, AlertTriangle } from 'lucide-react';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
}

export interface HeatmapMatrixData {
  columns: string[];
  matrix: number[][];
}

export interface DataChartProps {
  id?: string;
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'radar' | 'area' | 'heatmap';
  labels?: string[];
  datasets?: ChartDataset[];
  title?: string;
  code?: string;
  executionTimeMs?: number;
  reasoning?: string;
  failed?: boolean;
  error?: string;
  /** Callback when user clicks a data point */
  onPointClick?: (label: string, value: number, datasetLabel: string) => void;
  /** Scientific axis labels */
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** Scientific axis units */
  xUnit?: string;
  yUnit?: string;
  /** Scientific experiment type for specialized styling */
  scientificType?: string;
  /** Matrix data for heatmap visualization */
  matrixData?: HeatmapMatrixData;
}

// Premium glassmorphism & dark-mode complementary color palette
const CHART_COLORS = [
  'rgba(99, 102, 241, 0.85)',   // Indigo
  'rgba(236, 72, 153, 0.85)',   // Pink
  'rgba(14, 165, 233, 0.85)',   // Sky
  'rgba(34, 197, 94, 0.85)',    // Green
  'rgba(245, 158, 11, 0.85)',   // Amber
  'rgba(168, 85, 247, 0.85)',   // Purple
  'rgba(239, 68, 68, 0.85)',    // Red
  'rgba(20, 184, 166, 0.85)',   // Teal
  'rgba(249, 115, 22, 0.85)',   // Orange
  'rgba(6, 182, 212, 0.85)',    // Cyan
];

const CHART_BORDERS = [
  'rgba(99, 102, 241, 1)',
  'rgba(236, 72, 153, 1)',
  'rgba(14, 165, 233, 1)',
  'rgba(34, 197, 94, 1)',
  'rgba(245, 158, 11, 1)',
  'rgba(168, 85, 247, 1)',
  'rgba(239, 68, 68, 1)',
  'rgba(20, 184, 166, 1)',
  'rgba(249, 115, 22, 1)',
  'rgba(6, 182, 212, 1)',
];

export function DataChart({
  type,
  labels = [],
  datasets = [],
  title,
  code,
  executionTimeMs,
  reasoning,
  failed,
  error,
  onPointClick,
  xAxisLabel,
  yAxisLabel,
  xUnit,
  yUnit,
  scientificType,
  matrixData,
}: DataChartProps) {
  const chartRef = useRef<any>(null);
  const isScientific = !!(xAxisLabel || yAxisLabel || scientificType);

  // Render failure notice if execution of this chart failed
  if (failed) {
    return (
      <div className="my-3 rounded-2xl border border-rose-200/80 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-950/20 backdrop-blur-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-semibold mb-1">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Couldn't generate the {type || 'visualization'} — {title || 'Error'}</span>
        </div>
        <p className="text-[11px] text-slate-600 dark:text-slate-400 font-mono mt-1">{error || 'Execution failed for this visualization.'}</p>
      </div>
    );
  }

  // Render Heatmap Matrix if type === 'heatmap'
  if (type === 'heatmap' && matrixData && matrixData.columns && matrixData.matrix) {
    return (
      <div className="my-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              {title || 'Correlation Heatmap Matrix'}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="p-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50"></th>
                {matrixData.columns.map((col, i) => (
                  <th key={i} className="p-2 font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixData.matrix.map((row, ri) => (
                <tr key={ri}>
                  <td className="p-2 font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    {matrixData.columns[ri]}
                  </td>
                  {row.map((val, ci) => {
                    let bgStyle = '';
                    if (val > 0) {
                      bgStyle = `rgba(99, 102, 241, ${Math.abs(val) * 0.7 + 0.1})`;
                    } else if (val < 0) {
                      bgStyle = `rgba(239, 68, 68, ${Math.abs(val) * 0.7 + 0.1})`;
                    } else {
                      bgStyle = 'transparent';
                    }
                    return (
                      <td
                        key={ci}
                        style={{ backgroundColor: bgStyle }}
                        className="p-2 text-center font-mono font-semibold text-slate-800 dark:text-slate-100 border border-slate-200/50 dark:border-slate-800/50"
                      >
                        {val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Apply colorful styling to datasets (multi-color categorical palette for bar, pie, doughnut)
  const coloredDatasets = datasets.map((ds, i) => {
    const isCategoricalMultiColor = type === 'pie' || type === 'doughnut' || (type === 'bar' && datasets.length === 1);
    const bgColors = ds.backgroundColor || (
      isCategoricalMultiColor
        ? CHART_COLORS.slice(0, labels.length)
        : type === 'area'
        ? 'rgba(99, 102, 241, 0.15)'
        : CHART_COLORS[i % CHART_COLORS.length]
    );

    const borderColors = ds.borderColor || (
      isCategoricalMultiColor
        ? CHART_BORDERS.slice(0, labels.length)
        : CHART_BORDERS[i % CHART_BORDERS.length]
    );

    return {
      ...ds,
      backgroundColor: bgColors,
      borderColor: borderColors,
      borderWidth: isCategoricalMultiColor ? 2 : 2,
      borderRadius: type === 'bar' ? 6 : 0,
      tension: type === 'line' || type === 'area' ? 0.35 : 0,
      fill: type === 'area' ? 'origin' : false,
      pointRadius: type === 'line' || type === 'area' || type === 'scatter' ? 4 : 0,
      pointHoverRadius: 7,
    };
  });

  const chartData = { labels, datasets: coloredDatasets };

  const commonOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: !!title,
        text: title || '',
        font: { size: 13, weight: '600' as const, family: "'Inter', sans-serif" },
        color: '#6366f1',
        padding: { bottom: 14 },
      },
      legend: {
        display: datasets.length > 1 || type === 'pie' || type === 'doughnut' || type === 'radar',
        position: 'bottom' as const,
        labels: {
          font: { size: 11, family: "'Inter', sans-serif" },
          padding: 12,
          usePointStyle: true,
          pointStyleWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleFont: { size: 12, family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        cornerRadius: 8,
        padding: 10,
      },
    },
    onClick: (_event: any, elements: any[]) => {
      if (elements.length > 0 && onPointClick) {
        const el = elements[0];
        const label = labels[el.index] || '';
        const dsIndex = el.datasetIndex || 0;
        const value = datasets[dsIndex]?.data[el.index] || 0;
        const dsLabel = datasets[dsIndex]?.label || '';
        onPointClick(label, value, dsLabel);
      }
    },
    scales: type !== 'pie' && type !== 'doughnut' && type !== 'radar' ? {
      x: {
        grid: { display: false },
        title: {
          display: !!(xAxisLabel || xUnit),
          text: xAxisLabel ? (xUnit ? `${xAxisLabel} (${xUnit})` : xAxisLabel) : (xUnit || ''),
          font: { size: 11, weight: '600' as const, family: "'Inter', sans-serif" },
          color: isScientific ? '#6366f1' : undefined,
        },
        ticks: {
          font: { size: 10, family: "'Inter', sans-serif" },
          maxRotation: 45,
        },
      },
      y: {
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
        title: {
          display: !!(yAxisLabel || yUnit),
          text: yAxisLabel ? (yUnit ? `${yAxisLabel} (${yUnit})` : yAxisLabel) : (yUnit || ''),
          font: { size: 11, weight: '600' as const, family: "'Inter', sans-serif" },
          color: isScientific ? '#6366f1' : undefined,
        },
        ticks: { font: { size: 10, family: "'Inter', sans-serif" } },
      },
    } : undefined,
  };

  const handleDownload = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'chart'}.png`;
    a.click();
  };

  const chartTypeKey = (type === 'area' ? 'line' : type === 'heatmap' ? 'bar' : type) as keyof typeof ChartComponentMap;
  const ChartComponentMap = {
    bar: Bar,
    line: Line,
    area: Line,
    pie: Pie,
    doughnut: Doughnut,
    scatter: Scatter,
    radar: Radar,
  };
  const ChartComponent = ChartComponentMap[chartTypeKey] || Bar;

  return (
    <div className="my-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
            {isScientific ? `${scientificType || 'Scientific'} Visualization` : `${type.toUpperCase()} CHART`}
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
        >
          <Download className="w-3 h-3" />
          PNG
        </button>
      </div>
      <div className="h-[280px] w-full">
        <ChartComponent ref={chartRef} data={chartData} options={commonOptions} />
      </div>

      {/* Individual Trust Layer / Reasoning Panel */}
      {(code || reasoning) && (
        <div className="mt-3 border-t border-slate-100 dark:border-slate-800/80 pt-2 text-xs">
          <details className="group">
            <summary className="cursor-pointer font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                <span>Show reasoning {executionTimeMs ? `(${executionTimeMs}ms)` : ''}</span>
              </span>
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
              {reasoning && <p className="italic bg-indigo-50/50 dark:bg-indigo-950/30 p-2 rounded-lg border border-indigo-100/50 dark:border-indigo-900/30">{reasoning}</p>}
              {code && (
                <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[10.5px] overflow-x-auto">
                  <code>{code}</code>
                </pre>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
