'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, FileText, User, Download, ExternalLink, Image as ImageIcon, Music, Video, FileSpreadsheet, Archive, File, Code2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PDFDocument } from '@/types/graphTypes';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { DataChart } from '@/components/data-chart';
import { ScientificReport } from '@/components/scientific-report';
import type { ScientificReportData } from '@/components/scientific-report';
import { TransactionPreviewCard } from '@/components/transaction-preview-card';
import type { TransactionRecord } from '@/lib/brain/transaction-agent/types';
import { ChatAttachment } from '@/lib/history-store';
import { AIImageCard } from '@/components/ai-image-card';
import type { ImageGenResult } from '@/lib/image-generation-service';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export interface ChatMessageProps {
  message: {
    role: 'user' | 'assistant';
    content: string;
    sources?: PDFDocument[];
    attachments?: ChatAttachment[];
    transaction?: TransactionRecord;
  };
  onTransactionConfirm?: (tx: TransactionRecord) => void;
  onTransactionAddToCart?: (tx: TransactionRecord, size?: string) => void;
  onTransactionCancel?: (tx: TransactionRecord) => void;
}

/**
 * Pre-process message content to wrap bare Mermaid diagram blocks in
 * proper ```mermaid code fences so ReactMarkdown can detect them.
 */
function preprocessMermaidContent(content: string): string {
  if (!content) return '';
  let processed = content;

  const mermaidHeaders = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'journey', 'gantt', 'pie', 'gitgraph', 'mindmap', 'timeline',
    'requirementDiagram', 'quadrantChart', 'architecture-beta', 'block-beta',
    'xychart-beta', 'sankey-beta', 'C4Context', 'C4Container', 'C4Component',
    'C4Dynamic', 'C4Deployment',
  ];

  // 1. Fix generic code fences (``` without mermaid tag) containing diagram definitions
  processed = processed.replace(/```\s*\n([\s\S]*?)```/g, (match, codeBlock: string) => {
    const trimmedBlock = codeBlock.trim();
    const isMermaid = mermaidHeaders.some((h) => trimmedBlock.toLowerCase().startsWith(h.toLowerCase())) ||
      (trimmedBlock.includes('subgraph') && (trimmedBlock.includes('-->') || trimmedBlock.includes('---')));
    if (isMermaid) {
      return '```mermaid\n' + codeBlock.trim() + '\n```';
    }
    return match;
  });

  // 2. Wrap unfenced mermaid blocks
  for (const header of mermaidHeaders) {
    const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bareBlockRegex = new RegExp(
      `(?:^|\\n)(${escapedHeader}(?:\\s+[A-Za-z0-9_-]+)?\\s*\\n(?:[^\\n]+\\n?)+?)(?=\\n\\s*\\n|\\n[A-Z#*]|$|\`\`\`)`,
      'gi'
    );

    processed = processed.replace(bareBlockRegex, (match, block: string) => {
      const trimmed = block.trim();
      if (trimmed.includes('-->') || trimmed.includes('---') || trimmed.includes('subgraph') || trimmed.includes('[')) {
        return '\n```mermaid\n' + trimmed + '\n```\n';
      }
      return match;
    });
  }

  return processed;
}

export function ChatMessage({
  message,
  onTransactionConfirm,
  onTransactionAddToCart,
  onTransactionCancel,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isLoading = message.role === 'assistant' && message.content === '';

  // Extract markers: AI images, chart data, scientific reports, code reasoning, transactions
  const { displayContent, chartData, scientificReport, codeReasoning, transactionData, aiImageData } = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) {
      return {
        displayContent: message.content,
        chartData: null,
        scientificReport: null,
        codeReasoning: null,
        transactionData: message.transaction || null,
        aiImageData: null,
      };
    }

    let content = message.content;
    let chart = null;
    let sciReport: ScientificReportData | null = null;
    let reasoningObj: { code: string; executionTimeMs?: number } | null = null;
    let txRecord: TransactionRecord | null = message.transaction || null;
    let imgResult: ImageGenResult | null = null;

    // Robust extraction for AI Image markers (handles multiple progressive markers gracefully)
    const imgMatches = Array.from(content.matchAll(/<!--AI_IMAGE:([\s\S]*?)-->/g));
    if (imgMatches.length > 0) {
      for (const match of imgMatches) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed) {
            // Prefer completed payload with imageUrl over transient status
            if (parsed.imageUrl || !imgResult) {
              imgResult = parsed;
            }
          }
        } catch {}
      }
      content = content.replace(/<!--AI_IMAGE:[\s\S]*?-->/g, '').trim();
    }

    // Extract transaction preview marker
    const txMatch = content.match(/<!--TRANSACTION_PREVIEW:([\s\S]*?)-->/);
    if (txMatch) {
      try {
        txRecord = JSON.parse(txMatch[1]);
      } catch {}
      content = content.replace(/<!--TRANSACTION_PREVIEW:[\s\S]*?-->/g, '').trim();
    }

    // Extract scientific report
    const sciMatch = content.match(/<!--SCIENTIFIC_REPORT:([\s\S]*?)-->/);
    if (sciMatch) {
      try {
        sciReport = JSON.parse(sciMatch[1]);
      } catch {}
      content = content.replace(/<!--SCIENTIFIC_REPORT:[\s\S]*?-->/g, '').trim();
    }

    // Extract chart data
    const chartMatch = content.match(/<!--CHART_DATA:([\s\S]*?)-->/);
    if (chartMatch) {
      try {
        chart = JSON.parse(chartMatch[1]);
      } catch {}
      content = content.replace(/<!--CHART_DATA:[\s\S]*?-->/g, '').trim();
    }

    // Extract code reasoning
    const reasoningMatch = content.match(/<!--CODE_REASONING:([\s\S]*?)-->/);
    if (reasoningMatch) {
      try {
        reasoningObj = JSON.parse(reasoningMatch[1]);
      } catch {}
      content = content.replace(/<!--CODE_REASONING:[\s\S]*?-->/g, '').trim();
    }

    content = content
      .replace(/<\/?details>/gi, '')
      .replace(/<summary>.*?<\/summary>/gi, '')
      .trim();

    return {
      displayContent: content,
      chartData: chart,
      scientificReport: sciReport,
      codeReasoning: reasoningObj,
      transactionData: txRecord,
      aiImageData: imgResult,
    };
  }, [message.content, message.role, message.transaction]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const showSources =
    message.role === 'assistant' &&
    message.sources &&
    message.sources.length > 0;

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Assistant Avatar */}
      {!isUser && (
        <img
          src="/title.png"
          alt="Insight Logo"
          className="w-8 h-8 object-contain rounded-xl shadow-md shrink-0 mt-0.5"
        />
      )}

      <div className={`flex flex-col gap-2 max-w-[85%] sm:max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* User / Assistant Header */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {isUser ? 'You' : 'Insight AI'}
          </span>
        </div>

        {/* Message Bubble Container */}
        <div
          className={`relative group p-4 rounded-2xl shadow-sm transition-all duration-200 ${
            isUser
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none'
              : 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-none shadow-md'
          }`}
        >
          {/* Attachments Preview */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {message.attachments.map((att, idx) => {
                if ((att as any).type === 'image' || att.url?.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
                  return (
                    <div key={att.id || idx} className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 max-w-xs">
                      <img src={att.url} alt={att.name} className="w-full max-h-48 object-cover" />
                    </div>
                  );
                }
                return (
                  <div key={att.id || idx} className="flex items-center gap-2 p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <span className="truncate max-w-[140px] font-medium">{att.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Loading Dots */}
          {isLoading ? (
            <div className="flex items-center gap-1.5 py-1 px-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" />
            </div>
          ) : (
            <>
              {isUser ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none space-y-2 text-sm leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ node, ...props }) => (
                        <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs text-left" {...props} />
                        </div>
                      ),
                      thead: ({ node, ...props }) => (
                        <thead className="bg-slate-100/80 dark:bg-slate-800/80 font-bold text-slate-700 dark:text-slate-200" {...props} />
                      ),
                      th: ({ node, ...props }) => (
                        <th className="px-3 py-2 font-bold border-b border-slate-200 dark:border-slate-800" {...props} />
                      ),
                      td: ({ node, ...props }) => (
                        <td className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/60" {...props} />
                      ),
                      tr: ({ node, ...props }) => (
                        <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors" {...props} />
                      ),
                      pre: ({ node, children, ...props }: any) => {
                        const child = Array.isArray(children) ? children[0] : children;
                        if (child?.props?.className?.includes('language-mermaid')) {
                          const codeText = String(child.props.children).replace(/\n$/, '');
                          return <MermaidDiagram key={codeText.slice(0, 40)} chart={codeText} />;
                        }
                        const codeText = String(child?.props?.children || '').replace(/\n$/, '').trim();
                        const mermaidPrefixes = [
                          'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
                          'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
                          'journey', 'mindmap', 'timeline',
                        ];
                        if (
                          mermaidPrefixes.some((p) => codeText.startsWith(p)) ||
                          (codeText.includes('subgraph') && (codeText.includes('-->') || codeText.includes('---')))
                        ) {
                          return <MermaidDiagram chart={codeText} />;
                        }
                        return <pre {...props}>{children}</pre>;
                      },
                      code: ({ node, inline, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');
                        const trimmed = codeString.trim();

                        const isMermaidLang = match?.[1] === 'mermaid';
                        const isMermaidContent = [
                          'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
                          'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
                          'journey', 'mindmap', 'timeline',
                        ].some((p) => trimmed.startsWith(p)) ||
                          (trimmed.includes('subgraph') && (trimmed.includes('-->') || trimmed.includes('---')));

                        if (!inline && (isMermaidLang || isMermaidContent)) {
                          return <MermaidDiagram chart={codeString} />;
                        }

                        if (inline) {
                          return (
                            <code className="px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-[11px]" {...props}>
                              {children}
                            </code>
                          );
                        }

                        return (
                          <pre className="my-3 p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                        );
                      },
                    }}
                  >
                    {preprocessMermaidContent(displayContent)}
                  </ReactMarkdown>

                  {/* Render AI Image Card if AI Image payload is present */}
                  {aiImageData && (aiImageData.imageUrl || aiImageData.status === 'generating') && (
                    <AIImageCard
                      imageUrl={aiImageData.imageUrl}
                      prompt={aiImageData.promptUsed}
                      provider={aiImageData.provider}
                      groundedFacts={aiImageData.groundedFacts}
                      status={aiImageData.status}
                    />
                  )}

                  {/* Render Chart.js visualization(s) */}
                {(() => {
                  if (!chartData) return null;
                  const chartList = Array.isArray(chartData) ? chartData : [chartData];
                  const validCharts = chartList.filter((c: any) => c && (c.failed || (c.type && (c.labels || c.datasets))));
                  if (validCharts.length === 0) return null;

                  return (
                    <div className="space-y-4 my-4">
                      {validCharts.map((singleChart: any, index: number) => (
                        <DataChart key={singleChart.id || index} {...singleChart} />
                      ))}
                    </div>
                  );
                })()}

                {/* Render Scientific Report */}
                {scientificReport && (
                  <ScientificReport data={scientificReport} />
                )}

                  {/* Render Transaction Preview */}
                  {transactionData && (
                    <TransactionPreviewCard
                      transaction={transactionData}
                      onConfirm={onTransactionConfirm}
                      onAddToCart={onTransactionAddToCart}
                      onCancel={onTransactionCancel}
                    />
                  )}
                </div>
              )}
            </>
          )}

          {/* Copy Action Button */}
          {!isUser && !isLoading && (
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-2 gap-1.5"
                onClick={handleCopy}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          )}
        </div>

        {/* Grounded Sources Accordion */}
        {showSources && (
          <div className="w-full mt-1">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="sources" className="border-none">
                <AccordionTrigger className="py-1 px-2 hover:no-underline text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Grounded Sources ({message.sources!.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-1 px-2 space-y-2">
                  {message.sources!.map((source, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-semibold text-slate-700 dark:text-slate-300">
                        <span className="truncate max-w-[200px] sm:max-w-xs">{source.metadata?.filename || source.metadata?.source || `Source ${idx + 1}`}</span>
                        {source.metadata?.page && <span className="text-[10px] text-slate-400">Page {source.metadata.page}</span>}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-snug">
                        {source.pageContent}
                      </p>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </div>
    </div>
  );
}
