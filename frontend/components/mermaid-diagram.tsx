'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Download,
  Copy,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

interface MermaidDiagramProps {
  chart: string;
}

let idCounter = 0;

/**
 * Strip code fences and normalise line endings.
 * Let Mermaid parse its own syntax — no regex hacks.
 */
function sanitizeMermaidCode(raw: string): string {
  return raw
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderState, setRenderState] = useState<'loading' | 'success' | 'error'>('loading');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const cleanDOMErrorNodes = useCallback(() => {
    if (typeof document === 'undefined') return;
    try {
      document.querySelectorAll('.error-icon, [id^="dmermaid"], [id^="mermaid-error"]').forEach((n) => n.remove());
      document.querySelectorAll('div').forEach((div) => {
        if (
          (div.id && div.id.startsWith('dmermaid')) ||
          (typeof div.className === 'string' && div.className.includes('error-icon')) ||
          (div.textContent && div.textContent.includes('mermaid version'))
        ) {
          div.remove();
        }
      });
    } catch {}
  }, []);

  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme:
            document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'default',
          deterministicIds: true,
          flowchart: {
            htmlLabels: true,
            curve: 'linear',
            useMaxWidth: true,
          },
          sequence: {
            useMaxWidth: true,
          },
          gantt: {
            useMaxWidth: true,
          },
        });

        const sanitized = sanitizeMermaidCode(chart);
        if (!sanitized || sanitized.length < 10) {
          cleanDOMErrorNodes();
          if (isMounted) setRenderState('error');
          return;
        }

        // Validate syntax before rendering — gives cleaner failures
        await mermaid.parse(sanitized);

        const uniqueId = `mermaid_${Date.now()}_${idCounter++}`;
        const { svg } = await mermaid.render(uniqueId, sanitized);

        cleanDOMErrorNodes();

        if (isMounted && svg) {
          setSvgContent(svg);
          setRenderState('success');
        } else {
          cleanDOMErrorNodes();
          if (isMounted) setRenderState('error');
        }
      } catch (err) {
        console.error(err);
        cleanDOMErrorNodes();
        if (isMounted) {
          setSvgContent('');
          setRenderState('error');
        }
      }
    };

    if (chart && chart.trim().length > 5) {
      setRenderState('loading');
      renderDiagram();
    }

    return () => {
      isMounted = false;
      cleanDOMErrorNodes();
    };
  }, [chart, cleanDOMErrorNodes]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 2.5));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => setZoomLevel(1);

  const handleCopyCode = async () => {
    try {
      const clean = chart.replace(/```(mermaid)?/gi, '').trim();
      await navigator.clipboard.writeText(clean);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleDownloadSVG = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight_diagram_${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Loading state
  if (renderState === 'loading') {
    return (
      <div className="my-4 p-5 rounded-2xl bg-gradient-to-br from-indigo-50/80 via-purple-50/50 to-slate-50 dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-slate-900 border border-indigo-200/80 dark:border-indigo-800/60 shadow-sm text-center">
        <div className="flex items-center justify-center gap-2 text-xs font-bold text-indigo-600 dark:text-indigo-400">
          <Sparkles className="w-4 h-4 animate-spin text-indigo-500" />
          Rendering Interactive Visual Flowchart...
        </div>
      </div>
    );
  }

  // Error / fallback: show clear error state with syntax
  if (renderState === 'error' || !svgContent) {
    const cleanedCode = chart.replace(/```(mermaid)?/gi, '').trim();
    return (
      <div className="my-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-red-700 dark:text-red-400">Diagram couldn&apos;t be rendered</h3>
            <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">Mermaid syntax appears invalid.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 gap-1"
            onClick={handleCopyCode}
          >
            {copiedCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copiedCode ? 'Copied' : 'Copy Code'}
          </Button>
        </div>
        <pre className="text-xs font-mono text-red-900 dark:text-red-200 bg-red-100/60 dark:bg-red-950/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">{cleanedCode}</pre>
      </div>
    );
  }

  // Success: Render visual SVG diagram with interactive Control Header
  return (
    <>
      <div className="my-4 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/60 shadow-xl overflow-hidden group">
        {/* Interactive Diagram Control Header */}
        <div className="bg-slate-50/90 dark:bg-slate-850 p-2.5 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="font-bold text-slate-800 dark:text-slate-100 text-xs tracking-tight">
              Interactive Workflow Diagram
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 gap-1 rounded-lg"
              onClick={handleZoomOut}
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-[11px] font-mono font-bold text-slate-500 px-1">
              {Math.round(zoomLevel * 100)}%
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 gap-1 rounded-lg"
              onClick={handleZoomIn}
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>

            {zoomLevel !== 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-slate-500 hover:text-indigo-600 gap-1 rounded-lg"
                onClick={handleResetZoom}
                title="Reset Zoom"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            )}

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/50 hover:bg-indigo-100 border-indigo-200 dark:border-indigo-800 gap-1.5 rounded-lg"
              onClick={handleDownloadSVG}
              title="Download SVG"
            >
              <Download className="w-3.5 h-3.5" />
              SVG
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 gap-1 rounded-lg"
              onClick={() => setIsFullscreen(true)}
              title="Fullscreen View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Scrollable & Zoomable SVG Graphic View */}
        <div className="p-4 sm:p-6 overflow-x-auto flex justify-center items-center bg-slate-50/40 dark:bg-slate-950/40 min-h-[160px]">
          <div
            ref={containerRef}
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center', transition: 'transform 0.2s ease-in-out' }}
            className="w-full flex justify-center items-center [&>svg]:max-w-full [&>svg]:h-auto [&>svg]:mx-auto"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      </div>

      {/* FULLSCREEN MODAL HIGH-RES VIEW */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent className="sm:max-w-[95vw] w-[95vw] max-h-[92vh] h-[92vh] p-0 overflow-hidden border border-indigo-900/50 shadow-2xl rounded-2xl bg-slate-950 flex flex-col text-white">
          <div className="bg-slate-900 p-4 px-6 flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <DialogTitle className="text-lg font-black tracking-tight text-white">
                Fullscreen High-Resolution Diagram Inspector
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border-indigo-500 gap-1.5 rounded-xl"
                onClick={handleDownloadSVG}
              >
                <Download className="w-3.5 h-3.5" />
                Download High-Res SVG
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-white"
                onClick={() => setIsFullscreen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-8 flex justify-center items-center bg-slate-950/90">
            <div
              className="w-full h-full flex justify-center items-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
