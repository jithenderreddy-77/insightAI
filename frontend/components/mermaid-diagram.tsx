'use client';

import React, { useEffect, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

let idCounter = 0;

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });

        const uniqueId = `mermaid_chart_${Date.now()}_${idCounter++}`;
        const cleanChart = chart.trim();

        const { svg } = await mermaid.render(uniqueId, cleanChart);
        if (isMounted) {
          setSvgContent(svg);
          setHasError(false);
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (isMounted) {
          setHasError(true);
        }
      }
    };

    if (chart) {
      renderDiagram();
    }

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (hasError || !svgContent) {
    return (
      <div className="my-3 p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs overflow-x-auto border border-slate-800">
        <div className="text-[10px] uppercase font-bold text-indigo-400 mb-1">Flowchart Code</div>
        <pre>{chart}</pre>
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
