'use client';

import React, { useEffect, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

let idCounter = 0;

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [isValid, setIsValid] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const cleanDOMErrorNodes = () => {
      if (typeof document !== 'undefined') {
        const errorNodes = document.querySelectorAll('.error-icon, [id^="dmermaid"], div:contains("Syntax error")');
        errorNodes.forEach((node) => node.remove());
      }
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

        const cleanChart = chart.trim();
        if (!cleanChart || cleanChart.length < 10) {
          return;
        }

        // Validate syntax with parse() before render() to prevent error injection during streaming
        const valid = await mermaid.parse(cleanChart).catch(() => false);
        if (!valid) {
          cleanDOMErrorNodes();
          if (isMounted) setIsValid(false);
          return;
        }

        const uniqueId = `mermaid_chart_${Date.now()}_${idCounter++}`;
        const { svg } = await mermaid.render(uniqueId, cleanChart);
        
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
    return null; // Gracefully hide partial/incomplete streaming diagrams instead of showing bomb icons or syntax error banners
  }

  return (
    <div
      ref={containerRef}
      className="my-4 p-3 sm:p-4 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-indigo-100 dark:border-indigo-950 shadow-md overflow-x-auto flex justify-center items-center max-w-full [&>svg]:max-w-full [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
