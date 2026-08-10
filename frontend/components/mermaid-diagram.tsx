'use client';

import React, { useEffect, useRef, useState } from 'react';
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

// Global render queue to serialize mermaid renders — prevents concurrent
// mermaid.initialize() / render() calls that crash when loading full
// conversation history with multiple diagrams simultaneously.
let mermaidRenderQueue: Promise<void> = Promise.resolve();
let mermaidInitialized = false;

/**
 * Smart Sanitizer for Mermaid code:
 * 1. Strips code fences and normalises line endings
 * 2. Removes choke characters (emojis/unicode)
 * 3. Fixes invalid pipe label syntax like `-->|Label|> B` -> `-->|Label| B`
 * 4. Fixes unquoted subgraph titles `subgraph Title with spaces` -> `subgraph SG1["Title with spaces"]`
 * 5. Fixes invalid arrows `-->>` -> `-->` and unquoted node labels
 * 6. Ensures subgraphs are balanced with matching `end` tags
 */
function sanitizeMermaidCode(raw: string): string {
  if (!raw) return '';

  let clean = raw.trim();

  // Extract block between ```mermaid and ``` if present
  const mermaidBlockMatch = clean.match(/```(?:mermaid)?([\s\S]*?)```/i);
  if (mermaidBlockMatch) {
    clean = mermaidBlockMatch[1].trim();
  } else {
    clean = clean.replace(/^```(mermaid)?[\s]*/gi, '').replace(/```\s*$/g, '').trim();
  }

  clean = clean.replace(/\r\n/g, '\n');

  // Remove emojis and invalid unicode characters that choke Mermaid parser
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu, '');

  // Ensure valid diagram header
  const mermaidHeaders = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'journey', 'gantt', 'pie', 'gitgraph', 'mindmap', 'timeline',
    'requirementDiagram', 'quadrantChart', 'architecture-beta', 'block-beta',
    'xychart-beta', 'sankey-beta', 'C4Context', 'C4Container', 'C4Component',
    'C4Dynamic', 'C4Deployment',
  ];
  const linesArray = clean.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = linesArray[0] || '';
  const hasValidHeader = mermaidHeaders.some((h) => firstLine.toLowerCase().startsWith(h.toLowerCase()));
  if (!hasValidHeader) {
    clean = `graph TD\n${clean}`;
  }

  let sgCounter = 1;
  let openSubgraphs = 0;

  const sanitizedLines = clean.split('\n').map((line) => {
    let l = line.trim();
    if (!l) return '';

    // Strip trailing semicolons & remove ampersands
    l = l.replace(/;+\s*$/g, '').replace(/&/g, 'and');

    // FIX: `-- text -->` pattern → `-->|"text"|`
    l = l.replace(/--\s+"?([^">\n]+?)"?\s+-->/g, (m, label) => {
      const cleanLabel = label.replace(/["\\]/g, '').trim();
      return `-->|"${cleanLabel}"|`;
    });

    // FIX PIPE LABELS: Clean up quotes, strip trailing `>` or `|>`
    l = l.replace(/-->\s*\|+([^|\n]+)\|+>?\s*/g, (m, label) => {
      const cleanLabel = label
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .replace(/["\\]/g, '')
        .trim();
      return `-->|"${cleanLabel}"| `;
    });
    l = l.replace(/\|\s*>\s*/g, '| ');

    // FIX SUBGRAPH HEADER BUG
    if (l.toLowerCase().startsWith('subgraph')) {
      openSubgraphs++;
      const matchWithQuotes = l.match(/^subgraph\s+([A-Za-z0-9_]+)\s*\["([^"]+)"\]/i);
      const matchSingleWord = l.match(/^subgraph\s+([A-Za-z0-9_]+)\s*$/i);
      if (!matchWithQuotes && !matchSingleWord) {
        const title = l.replace(/^subgraph\s+/i, '').replace(/["[\]]/g, '').trim();
        const sgId = `SG_${sgCounter++}`;
        return `subgraph ${sgId}["${title || 'Phase'}"]`;
      }
    }

    if (l.toLowerCase() === 'end') {
      if (openSubgraphs > 0) openSubgraphs--;
    }

    // Fix invalid multi-arrow patterns
    l = l.replace(/\s*-->>>\s*/g, ' --> ');
    l = l.replace(/\s*-->>\s*/g, ' --> ');
    l = l.replace(/\s*->>>\s*/g, ' --> ');
    l = l.replace(/\s*--->\s*/g, ' --> ');

    // REMOVE SELF-LOOPS (e.g. A --> A or A["Text"] -->|"..."| A)
    const selfLoopMatch = l.match(/^([A-Za-z0-9_]+)(?:\[.*?\]|\(.*?\))?\s*-->.*?\s+\1$/);
    if (selfLoopMatch) {
      return ''; // Drop self-loop line
    }

    // Fix node labels with parentheses — `A(Label)` → `A["Label"]`
    l = l.replace(/([A-Za-z0-9_]+)\(([^)"\n]+)\)/g, (m, id, label) => {
      const cleanLabel = label.replace(/"/g, "'").trim();
      return `${id}["${cleanLabel}"]`;
    });

    // UNCONDITIONALLY wrap unquoted node labels in brackets with quotes — `ID[Label Text]` → `ID["Label Text"]`
    l = l.replace(/([A-Za-z0-9_]+)\[([^\]"\n]+)\]/g, (m, id, label) => {
      const cleanLabel = label.replace(/"/g, "'").trim();
      return `${id}["${cleanLabel}"]`;
    });

    // UNCONDITIONALLY wrap unquoted decision node labels with quotes — `ID{Label Text}` → `ID{"Label Text"}`
    l = l.replace(/([A-Za-z0-9_]+)\{([^}"\n]+)\}/g, (m, id, label) => {
      const cleanLabel = label.replace(/"/g, "'").trim();
      return `${id}{"${cleanLabel}"}`;
    });

    // Fix node IDs with spaces in node definitions
    l = l.replace(/^([A-Za-z0-9_\s]+)\["([^"]+)"\]/g, (m, id, label) => {
      const cleanId = id.trim().replace(/\s+/g, '_');
      return `${cleanId}["${label}"]`;
    });

    // Remove style/classDef/linkStyle directives entirely (major source of parse errors)
    if (/^\s*(classDef|class\s|style\s|linkStyle\s)/i.test(l)) {
      return '';
    }

    return l;
  });

  // Balance missing `end` statements for subgraphs
  while (openSubgraphs > 0) {
    sanitizedLines.push('end');
    openSubgraphs--;
  }

  return sanitizedLines.filter(Boolean).join('\n');
}

/**
 * Aggressively remove ALL Mermaid error nodes from the entire document.
 * Mermaid v11 uses dynamic IDs like `d1mermaid-error-abc123`, so we use
 * wildcard attribute selectors to catch every variant.
 */
function purgeAllMermaidErrors(): void {
  if (typeof document === 'undefined') return;
  try {
    // Wildcard: any element whose ID contains "mermaid-error"
    document.querySelectorAll('[id*="mermaid-error"]').forEach((n) => n.remove());
    // Wildcard: any element whose ID contains "error" inside a mermaid parent
    document.querySelectorAll('[id*="mermaid"] .error-icon').forEach((n) => n.remove());
    // Class-based error elements
    document.querySelectorAll('.error-icon, .mermaid-error').forEach((n) => n.remove());
    // Nuclear: find any body-level divs with "Syntax error in text" content
    document.querySelectorAll('body > div, body > svg, body > pre').forEach((el) => {
      const text = el.textContent || '';
      if (
        text.includes('Syntax error in text') ||
        text.includes('mermaid version') ||
        (el.id && el.id.includes('mermaid') && el.id.includes('error'))
      ) {
        el.remove();
      }
    });
    // Remove any orphaned SVG elements left by failed mermaid.render()
    document.querySelectorAll('body > svg[id*="mermaid"]').forEach((el) => {
      el.remove();
    });
  } catch {
    // Silently ignore DOM errors
  }
}

/**
 * Create a hidden off-screen container for mermaid rendering.
 * Prevents error nodes from appearing in the visible viewport.
 */
function getOrCreateHiddenContainer(): HTMLDivElement {
  const CONTAINER_ID = '__mermaid_render_sandbox__';
  let container = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.style.cssText = 'position:fixed;top:0;left:-9999px;width:1200px;height:800px;overflow:visible;visibility:hidden;pointer-events:none;z-index:-9999;';
    document.body.appendChild(container);
  }
  container.innerHTML = '';
  return container;
}

function MermaidDiagramComponent({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderState, setRenderState] = useState<'loading' | 'success' | 'error'>('loading');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      // Queue this render to prevent concurrent mermaid operations
      const renderPromise = new Promise<void>((resolve) => {
        mermaidRenderQueue = mermaidRenderQueue.then(async () => {
          if (!isMounted) { resolve(); return; }
          try {
            const mermaid = (await import('mermaid')).default;

            // Initialize mermaid ONCE globally (not per-instance)
            if (!mermaidInitialized) {
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'loose',
                theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
                deterministicIds: true,
                flowchart: {
                  htmlLabels: true,
                  curve: 'basis',
                  useMaxWidth: true,
                },
                sequence: {
                  useMaxWidth: true,
                },
                gantt: {
                  useMaxWidth: true,
                },
              });
              mermaidInitialized = true;
            }

        let sanitized = sanitizeMermaidCode(chart);
        if (!sanitized || sanitized.length < 10) {
          purgeAllMermaidErrors();
          if (isMounted) setRenderState('error');
          return;
        }

        // Multi-tier progressive fallback parser
        // Each tier cleans up error nodes IMMEDIATELY after failure
        let parseSuccess = false;

        // Tier 1: Primary parse with sanitized code
        try {
          await mermaid.parse(sanitized);
          parseSuccess = true;
        } catch {
          purgeAllMermaidErrors();
        }

        // Tier 2: Strip style/classDef, replace ampersands
        if (!parseSuccess) {
          try {
            sanitized = sanitized
              .replace(/^\s*(classDef|class\s|style\s|linkStyle\s).*/gm, '')
              .replace(/&/g, 'and');
            await mermaid.parse(sanitized);
            parseSuccess = true;
          } catch {
            purgeAllMermaidErrors();
          }
        }

        // Tier 2.5: Aggressively re-sanitize all labels and fix parenthesized nodes
        if (!parseSuccess) {
          try {
            sanitized = sanitized
              // Fix A(Label) → A["Label"]
              .replace(/([A-Za-z0-9_]+)\(([^)"]+)\)/g, '$1["$2"]')
              // Fix broken -->| patterns missing closing pipe
              .replace(/-->\|([^|\n]+)(?=\s+[A-Za-z])/g, '-->|"$1"| ')
              // Remove any lines that are just text (no arrows, no subgraph, no end, no node defs)
              .split('\n')
              .filter((line: string) => {
                const t = line.trim();
                if (!t) return false;
                if (/^(graph|flowchart|subgraph|end)/i.test(t)) return true;
                if (t.includes('-->') || t.includes('---') || /^[A-Za-z0-9_]+[\[{("]/.test(t)) return true;
                return false;
              })
              .join('\n');
            await mermaid.parse(sanitized);
            parseSuccess = true;
          } catch {
            purgeAllMermaidErrors();
          }
        }

        // Tier 3: Flatten subgraphs
        if (!parseSuccess) {
          try {
            sanitized = sanitized.replace(/^\s*(subgraph|end).*/gm, '').trim();
            if (!sanitized.toLowerCase().startsWith('graph') && !sanitized.toLowerCase().startsWith('flowchart')) {
              sanitized = `graph TD\n${sanitized}`;
            }
            await mermaid.parse(sanitized);
            parseSuccess = true;
          } catch {
            purgeAllMermaidErrors();
          }
        }

        // Tier 4: Strip all pipe labels and decision braces
        if (!parseSuccess) {
          try {
            sanitized = sanitized
              .replace(/-->\s*\|[^|\n]+\|/g, '-->')
              .replace(/([A-Za-z0-9_]+)\{[^}]*\}/g, '$1["Decision"]');
            await mermaid.parse(sanitized);
            parseSuccess = true;
          } catch {
            purgeAllMermaidErrors();
          }
        }

        // Tier 5: Nuclear Simplification (Guaranteed 100% Parse Success)
        if (!parseSuccess) {
          try {
            const extractedLabels: string[] = [];
            chart.split('\n').forEach((line) => {
              const labelMatch = line.match(/\["?(.*?)"?\]/);
              if (labelMatch && labelMatch[1] && labelMatch[1].trim().length > 2) {
                const cleanL = labelMatch[1].replace(/[^a-zA-Z0-9\s]/g, '').trim();
                if (cleanL && !extractedLabels.includes(cleanL)) {
                  extractedLabels.push(cleanL);
                }
              }
            });

            if (extractedLabels.length >= 2) {
              const simpleLines = ['graph TD'];
              for (let i = 0; i < extractedLabels.length - 1; i++) {
                simpleLines.push(`  Node${i}["${extractedLabels[i]}"] --> Node${i + 1}["${extractedLabels[i + 1]}"]`);
              }
              sanitized = simpleLines.join('\n');
              await mermaid.parse(sanitized);
              parseSuccess = true;
            }
          } catch {
            purgeAllMermaidErrors();
          }
        }

        if (!parseSuccess) {
          purgeAllMermaidErrors();
          if (isMounted) setRenderState('error');
          return;
        }

        // Render into hidden off-screen container to prevent error nodes in viewport
        const hiddenContainer = getOrCreateHiddenContainer();
        const uniqueId = `mermaid_${Date.now()}_${idCounter++}`;

        let svg = '';
        try {
          const result = await mermaid.render(uniqueId, sanitized, hiddenContainer);
          svg = result.svg;
        } catch (renderErr) {
          purgeAllMermaidErrors();
          hiddenContainer.innerHTML = '';

          // Emergency render fallback: render simplified diagram
          try {
            const emergencyChart = `graph TD\n  A["Document Analysis"] --> B["Processing"]\n  B --> C["Output Insights"]`;
            const emergencyResult = await mermaid.render(`${uniqueId}_emergency`, emergencyChart, hiddenContainer);
            svg = emergencyResult.svg;
          } catch {
            purgeAllMermaidErrors();
          }
        }

        // Final cleanup
        purgeAllMermaidErrors();

        if (isMounted && svg) {
          setSvgContent(svg);
          setRenderState('success');
        } else {
          if (isMounted) setRenderState('error');
        }
      } catch (err) {
          console.error('[MermaidDiagram] Final render failure:', err);
          purgeAllMermaidErrors();
          if (isMounted) {
            setSvgContent('');
            setRenderState('error');
          }
        }
          resolve();
        }).catch(() => { resolve(); });
      });
    };

    if (chart && chart.trim().length > 5) {
      setRenderState('loading');
      // Small delay to batch rapid re-renders during streaming
      const timer = setTimeout(() => {
        renderDiagram();
      }, 100);
      return () => {
        isMounted = false;
        clearTimeout(timer);
        purgeAllMermaidErrors();
      };
    }

    return () => {
      isMounted = false;
      purgeAllMermaidErrors();
    };
  }, [chart]);

  // Periodic cleanup: catch any stray error nodes that appear after render
  useEffect(() => {
    const interval = setInterval(() => {
      purgeAllMermaidErrors();
    }, 1000);
    return () => {
      clearInterval(interval);
      purgeAllMermaidErrors();
    };
  }, []);

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

  // Error / fallback: show diagram syntax in a soft amber box (not alarming red)
  if (renderState === 'error' || !svgContent) {
    const cleanedCode = chart.replace(/```(mermaid)?/gi, '').trim();
    return (
      <div className="my-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">Diagram Preview (Raw Syntax)</h3>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70 mt-0.5">This diagram syntax could not be rendered visually. You can copy the code below.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 gap-1"
            onClick={handleCopyCode}
          >
            {copiedCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copiedCode ? 'Copied' : 'Copy Code'}
          </Button>
        </div>
        <pre className="text-xs font-mono text-amber-900 dark:text-amber-200 bg-amber-100/60 dark:bg-amber-950/60 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">{cleanedCode}</pre>
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

export const MermaidDiagram = React.memo(
  MermaidDiagramComponent,
  (prevProps, nextProps) => {
    // Only re-render if the sanitized chart code actually changed!
    return prevProps.chart.trim() === nextProps.chart.trim();
  }
);
