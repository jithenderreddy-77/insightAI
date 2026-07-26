'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

let idCounter = 0;

/**
 * Sanitize Mermaid code to prevent parse failures:
 * 1. Strip ```mermaid fences
 * 2. Remove emoji characters (Mermaid parser chokes on them)
 * 3. Auto-quote unquoted node labels with special characters
 * 4. Add default graph direction if missing
 */
function sanitizeMermaidCode(rawChart: string): string {
  let clean = rawChart
    .replace(/^```(mermaid)?[\s]*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();

  // 1. Remove emoji characters — Mermaid parser cannot handle them
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu, '');

  // 2. Ensure valid diagram header
  const lines = clean.split('\n');
  const firstLine = lines[0].trim().toLowerCase();
  if (
    !firstLine.startsWith('graph ') &&
    !firstLine.startsWith('flowchart ') &&
    !firstLine.startsWith('sequencediagram') &&
    !firstLine.startsWith('gantt') &&
    !firstLine.startsWith('classdiagram') &&
    !firstLine.startsWith('statediagram') &&
    !firstLine.startsWith('erdiagram') &&
    !firstLine.startsWith('pie') &&
    !firstLine.startsWith('gitgraph') &&
    !firstLine.startsWith('journey') &&
    !firstLine.startsWith('mindmap') &&
    !firstLine.startsWith('timeline')
  ) {
    clean = `graph TD\n${clean}`;
  }

  // 3. Normalize quote duplicates before pattern matching
  clean = clean.replace(/""+/g, '"');

  // 4. Auto-quote decision node labels: C{Label} -> C{"Label"}
  clean = clean.replace(/([A-Za-z0-9_]+)\{([^}"\n]+)\}/g, (m, id, label) => {
    if (label.startsWith('"') && label.endsWith('"')) return `${id}{${label}}`;
    const cleanLabel = label.replace(/"/g, "'").trim();
    return `${id}{"${cleanLabel}"}`;
  });

  // 5. Auto-quote stadium nodes: A([Start]) -> A(["Start"])
  clean = clean.replace(/([A-Za-z0-9_]+)\(\[([^\]"\n]+)\]\)/g, (m, id, label) => {
    if (label.startsWith('"') && label.endsWith('"')) return `${id}([${label}])`;
    const cleanLabel = label.replace(/"/g, "'").trim();
    return `${id}(["${cleanLabel}"])`;
  });

  // 6. Auto-quote standard rectangle nodes: B[Process] -> B["Process"]
  clean = clean.replace(/([A-Za-z0-9_]+)\[([^\]"\n]+)\]/g, (m, id, label) => {
    if (m.trim().toLowerCase().startsWith('subgraph')) return m;
    if (label.startsWith('"') && label.endsWith('"')) return `${id}[${label}]`;
    const cleanLabel = label.replace(/"/g, "'").trim();
    return `${id}["${cleanLabel}"]`;
  });

  // 7. Final pass to clean any accidental double double-quotes
  clean = clean.replace(/""+/g, '"');

  return clean;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderState, setRenderState] = useState<'loading' | 'success' | 'error'>('loading');

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
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'Inter, system-ui, sans-serif',
          suppressErrorRendering: true,
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
        });

        const sanitized = sanitizeMermaidCode(chart);
        if (!sanitized || sanitized.length < 10) {
          cleanDOMErrorNodes();
          if (isMounted) setRenderState('error');
          return;
        }

        // Validate syntax before render
        const valid = await mermaid.parse(sanitized).catch(() => false);
        if (!valid) {
          cleanDOMErrorNodes();
          if (isMounted) setRenderState('error');
          return;
        }

        const uniqueId = `mermaid_${Date.now()}_${idCounter++}`;
        const { svg } = await mermaid.render(uniqueId, sanitized);

        cleanDOMErrorNodes();

        if (isMounted && svg) {
          setSvgContent(svg);
          setRenderState('success');
        }
      } catch (err) {
        cleanDOMErrorNodes();
        if (isMounted) setRenderState('error');
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

  // Loading state
  if (renderState === 'loading') {
    return (
      <div className="my-3 p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 border border-indigo-200 dark:border-indigo-800 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Rendering diagram...
        </div>
      </div>
    );
  }

  // Error / fallback: show the code as a styled code block (not a bomb icon)
  if (renderState === 'error' || !svgContent) {
    const cleanedCode = chart.replace(/```(mermaid)?/gi, '').trim();
    return (
      <div className="my-3 p-3.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto border border-slate-700 shadow-sm">
        <div className="text-[10px] uppercase font-bold text-indigo-400 mb-1.5 tracking-wide">
          Diagram Code
        </div>
        <pre className="text-slate-300 text-xs whitespace-pre-wrap leading-relaxed">{cleanedCode}</pre>
      </div>
    );
  }

  // Success: render the SVG
  return (
    <div
      ref={containerRef}
      className="my-4 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/50 shadow-lg overflow-x-auto flex justify-center items-center max-w-full [&>svg]:max-w-full [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
