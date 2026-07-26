'use client';

import React, { useEffect, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

let idCounter = 0;

function sanitizeMermaidCode(rawChart: string): string {
  let clean = rawChart
    .replace(/^```(mermaid)?/gi, '')
    .replace(/```$/g, '')
    .trim();

  if (
    !clean.startsWith('graph ') &&
    !clean.startsWith('flowchart ') &&
    !clean.startsWith('sequenceDiagram') &&
    !clean.startsWith('gantt') &&
    !clean.startsWith('classDiagram')
  ) {
    clean = `graph TD\n${clean}`;
  }

  // Wrap unquoted labels containing special characters in double quotes: A[File (PDF)] => A["File (PDF)"]
  clean = clean.replace(/([A-Za-z0-9_]+)\[([^"\]\n]+)\]/g, (match, nodeId, label) => {
    if (label.includes('(') || label.includes(')') || label.includes(':') || label.includes('/') || label.includes(' ')) {
      const safeLabel = label.replace(/"/g, "'");
      return `${nodeId}["${safeLabel}"]`;
    }
    return match;
  });

  return clean;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [isValid, setIsValid] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const cleanDOMErrorNodes = () => {
      if (typeof document === 'undefined') return;
      try {
        const errorNodes = document.querySelectorAll('.error-icon, [id^="dmermaid"], [id^="mermaid-error"]');
        errorNodes.forEach((node) => node.remove());

        document.querySelectorAll('div').forEach((div) => {
          if (
            (div.id && div.id.startsWith('dmermaid')) ||
            (typeof div.className === 'string' && div.className.includes('error-icon')) ||
            (div.textContent && div.textContent.includes('mermaid version 11'))
          ) {
            div.remove();
          }
        });
      } catch {}
    };

    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
          suppressErrorRendering: true,
        });

        const sanitized = sanitizeMermaidCode(chart);
        if (!sanitized || sanitized.length < 5) {
          cleanDOMErrorNodes();
          if (isMounted) setIsValid(false);
          return;
        }

        // Validate syntax with parse() before render() to prevent error injection during streaming
        const valid = await mermaid.parse(sanitized).catch(() => false);
        if (!valid) {
          cleanDOMErrorNodes();
          if (isMounted) setIsValid(false);
          return;
        }

        const uniqueId = `mermaid_chart_${Date.now()}_${idCounter++}`;
        const { svg } = await mermaid.render(uniqueId, sanitized);

        cleanDOMErrorNodes();

        if (isMounted && svg) {
          setSvgContent(svg);
          setIsValid(true);
        }
      } catch (err) {
        cleanDOMErrorNodes();
        if (isMounted) setIsValid(false);
      }
    };

    if (chart) {
      renderDiagram();
    }

    return () => {
      isMounted = false;
      cleanDOMErrorNodes();
    };
  }, [chart]);

  if (!isValid || !svgContent) {
    // Styled diagram preview fallback while chart is streaming or being generated
    return (
      <div className="my-3 p-3.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto border border-indigo-900/50 shadow-sm">
        <div className="text-[10px] uppercase font-bold text-indigo-400 mb-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Interactive Flowchart / Process Diagram
        </div>
        <pre className="text-slate-300 font-sans text-xs whitespace-pre-wrap">{chart.replace(/```(mermaid)?/g, '').trim()}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 p-3 sm:p-4 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-indigo-100 dark:border-indigo-950 shadow-md overflow-x-auto flex justify-center items-center max-w-full [&>svg]:max-w-full [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
