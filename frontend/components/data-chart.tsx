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
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut, Scatter } from 'react-chartjs-2';
import { Download } from 'lucide-react';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
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

export interface DataChartProps {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter';
  labels: string[];
  datasets: ChartDataset[];
  title?: string;
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
}

// Premium color palette
const CHART_COLORS = [
  'rgba(99, 102, 241, 0.85)',   // Indigo
  'rgba(236, 72, 153, 0.85)',   // Pink
  'rgba(14, 165, 233, 0.85)',   // Sky
  'rgba(34, 197, 94, 0.85)',    // Green
  'rgba(245, 158, 11, 0.85)',   // Amber
  'rgba(168, 85, 247, 0.85)',   // Purple
  'rgba(239, 68, 68, 0.85)',    // Red
  'rgba(20, 184, 166, 0.85)',   // Teal
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
];

export function DataChart({ type, labels, datasets, title, onPointClick, xAxisLabel, yAxisLabel, xUnit, yUnit, scientificType }: DataChartProps) {
  const chartRef = useRef<any>(null);
  const isScientific = !!(xAxisLabel || yAxisLabel || scientificType);

  // Apply colors to datasets
  const coloredDatasets = datasets.map((ds, i) => ({
    ...ds,
    backgroundColor: ds.backgroundColor || (
      type === 'pie' || type === 'doughnut'
        ? CHART_COLORS.slice(0, labels.length)
        : CHART_COLORS[i % CHART_COLORS.length]
    ),
    borderColor: ds.borderColor || (
      type === 'pie' || type === 'doughnut'
        ? CHART_BORDERS.slice(0, labels.length)
        : CHART_BORDERS[i % CHART_BORDERS.length]
    ),
    borderWidth: type === 'pie' || type === 'doughnut' ? 2 : 2,
    borderRadius: type === 'bar' ? 6 : 0,
    tension: type === 'line' ? 0.4 : 0,
    fill: type === 'line' ? 'origin' : false,
    pointRadius: type === 'line' || type === 'scatter' ? 4 : 0,
    pointHoverRadius: 7,
  }));

  const chartData = { labels, datasets: coloredDatasets };

  const commonOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: !!title,
        text: title || '',
        font: { size: 14, weight: '600' as const, family: "'Inter', sans-serif" },
        color: '#6366f1',
        padding: { bottom: 16 },
      },
      legend: {
        display: datasets.length > 1 || type === 'pie' || type === 'doughnut',
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
    scales: type !== 'pie' && type !== 'doughnut' ? {
      x: {
        grid: { display: false },
        title: {
          display: !!(xAxisLabel || xUnit),
          text: xAxisLabel ? (xUnit ? `${xAxisLabel} (${xUnit})` : xAxisLabel) : (xUnit || ''),
          font: { size: 12, weight: '600' as const, family: "'Inter', sans-serif" },
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
          font: { size: 12, weight: '600' as const, family: "'Inter', sans-serif" },
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

  const ChartComponent = {
    bar: Bar,
    line: Line,
    pie: Pie,
    doughnut: Doughnut,
    scatter: Scatter,
  }[type] || Bar;

  return (
    <div className="my-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
            {isScientific ? `${scientificType || 'Scientific'} Visualization` : 'Data Visualization'}
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
      <div className="h-[300px] w-full">
        <ChartComponent ref={chartRef} data={chartData} options={commonOptions} />
      </div>
    </div>
  );
}
