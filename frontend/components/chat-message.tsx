'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, FileText, User, Download, ExternalLink, Image as ImageIcon, Music, Video, FileSpreadsheet, Archive, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PDFDocument } from '@/types/graphTypes';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { DataChart } from '@/components/data-chart';
import { ChatAttachment } from '@/lib/history-store';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface ChatMessageProps {
  message: {
    role: 'user' | 'assistant';
    content: string;
    sources?: PDFDocument[];
    attachments?: ChatAttachment[];
  };
}

/**
 * Pre-process message content to wrap bare Mermaid diagram blocks in
 * proper ```mermaid code fences so ReactMarkdown can detect them.
 * Also wraps content that's ALREADY in generic code fences (```\n graph TD...)
 * but missing the mermaid language tag.
 */
function preprocessMermaidContent(content: string): string {
  if (!content) return '';
  let processed = content;

  // Mermaid diagram header keywords
  const mermaidHeaders = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'journey', 'gantt', 'pie', 'gitgraph', 'mindmap', 'timeline',
    'requirementDiagram', 'quadrantChart', 'architecture-beta', 'block-beta',
    'xychart-beta', 'sankey-beta', 'C4Context', 'C4Container', 'C4Component',
    'C4Dynamic', 'C4Deployment',
  ];

  // 1. Fix generic code fences (``` without mermaid tag) that contain mermaid content
  processed = processed.replace(/```\s*\n([\s\S]*?)```/g, (match, codeBlock: string) => {
    const trimmedBlock = codeBlock.trim();
    const isMermaid = mermaidHeaders.some((h) => trimmedBlock.toLowerCase().startsWith(h.toLowerCase())) ||
      (trimmedBlock.includes('subgraph') && (trimmedBlock.includes('-->') || trimmedBlock.includes('---')));
    if (isMermaid) {
      return '```mermaid\n' + codeBlock.trim() + '\n```';
    }
    return match;
  });

  // 2. Wrap unfenced mermaid blocks (e.g. lines starting with graph TD / flowchart LR)
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

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const isLoading = message.role === 'assistant' && message.content === '';

  // Extract chart data from <!--CHART_DATA:...--> markers
  const { displayContent, chartData } = useMemo(() => {
    if (message.role !== 'assistant' || !message.content) {
      return { displayContent: message.content, chartData: null };
    }
    const chartMatch = message.content.match(/<!--CHART_DATA:([\s\S]*?)-->/);
    let chart = null;
    let content = message.content;
    if (chartMatch) {
      try {
        chart = JSON.parse(chartMatch[1]);
      } catch { /* ignore malformed chart data */ }
      content = content.replace(/<!--CHART_DATA:[\s\S]*?-->/, '').trim();
    }
    return { displayContent: content, chartData: chart };
  }, [message.content, message.role]);

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

      <div
        className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20'
            : 'glass-card shadow-sm text-slate-800 dark:text-slate-100'
        }`}
      >
        {isLoading ? (
          <div className="flex space-x-1.5 h-6 items-center px-1">
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-[loading_1s_ease-in-out_infinite]" />
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-[loading_1s_ease-in-out_0.2s_infinite]" />
            <div className="w-2 h-2 bg-violet-400 rounded-full animate-[loading_1s_ease-in-out_0.4s_infinite]" />
          </div>
        ) : (
          <>
            {/* Render persistent uploaded attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-2 mb-2">
                {message.attachments.map((att, idx) => {
                  const isImg = (att.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(att.name);
                  const isAud = (att.mimeType || '').startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(att.name);
                  const isVid = (att.mimeType || '').startsWith('video/') || /\.(mp4|webm|mov)$/i.test(att.name);

                  if (isImg && att.url) {
                    return (
                      <div key={att.id || idx} className="rounded-xl overflow-hidden border border-white/20 dark:border-slate-700/50 shadow-sm max-w-xs">
                        <img src={att.url} alt={att.name} className="w-full h-auto max-h-56 object-cover" />
                        <div className="p-1.5 bg-slate-900/70 backdrop-blur-sm text-white text-[11px] flex justify-between items-center px-2.5">
                          <span className="truncate max-w-[180px]">{att.name}</span>
                          <a href={att.url} target="_blank" rel="noopener noreferrer" download={att.name} className="hover:text-indigo-300 transition-colors">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  }

                  if (isAud && att.url) {
                    return (
                      <div key={att.id || idx} className="p-2 rounded-xl bg-slate-900/40 border border-slate-700/50 w-full max-w-xs">
                        <p className="text-xs font-medium mb-1 truncate text-slate-100">{att.name}</p>
                        <audio controls src={att.url} className="w-full h-8" />
                      </div>
                    );
                  }

                  if (isVid && att.url) {
                    return (
                      <div key={att.id || idx} className="rounded-xl overflow-hidden border border-slate-700/50 max-w-xs">
                        <video controls src={att.url} className="w-full max-h-52" />
                        <p className="text-[11px] p-1.5 bg-slate-900/70 text-white truncate px-2">{att.name}</p>
                      </div>
                    );
                  }

                  return (
                    <a
                      key={att.id || idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={att.name}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-medium transition-all duration-200 hover:scale-[1.01] ${
                        isUser
                          ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                          : 'bg-indigo-50/70 border-indigo-100 text-indigo-900 dark:bg-slate-800/70 dark:border-slate-700 dark:text-indigo-200 hover:bg-indigo-100/70'
                      }`}
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-semibold">{att.name}</p>
                        {att.sizeBytes && <p className="text-[10px] opacity-70">{(att.sizeBytes / 1024).toFixed(1)} KB</p>}
                      </div>
                      <Download className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    </a>
                  );
                })}
              </div>
            )}
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
                      // Check if the pre contains a mermaid code block
                      const child = Array.isArray(children) ? children[0] : children;
                      if (child?.props?.className?.includes('language-mermaid')) {
                        const codeText = String(child.props.children).replace(/\n$/, '');
                        return <MermaidDiagram key={codeText.slice(0, 40)} chart={codeText} />;
                      }
                      // Check if the code content looks like a mermaid diagram
                      const codeText = String(child?.props?.children || '').replace(/\n$/, '').trim();
                      const mermaidPrefixes = [
                        'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
                        'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
                        'journey', 'mindmap', 'timeline',
                        'requirementDiagram', 'quadrantChart',
                        'architecture-beta', 'block-beta', 'xychart-beta', 'sankey-beta',
                        'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
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

                      // Detect mermaid: explicit language tag OR content pattern
                      const isMermaidLang = match?.[1] === 'mermaid';
                      const isMermaidContent = [
                        'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
                        'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
                        'journey', 'mindmap', 'timeline',
                        'requirementDiagram', 'quadrantChart',
                        'architecture-beta', 'block-beta', 'xychart-beta', 'sankey-beta',
                        'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
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

                {/* Render Chart.js visualization if chart data is present */}
                {chartData && chartData.type && chartData.labels && chartData.datasets && (
                  <DataChart
                    type={chartData.type}
                    labels={chartData.labels}
                    datasets={chartData.datasets}
                    title={chartData.title}
                  />
                )}
              </div>
            )}

            {!isUser && (
              <div className="flex gap-1 mt-2 -ml-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                  onClick={handleCopy}
                  title={copied ? 'Copied!' : 'Copy to clipboard'}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            )}

            {showSources && message.sources && (
              <Accordion type="single" collapsible className="w-full mt-2">
                <AccordionItem value="sources" className="border-b-0 border-t border-border/50 pt-1">
                  <AccordionTrigger className="text-xs py-2 justify-start gap-2 hover:no-underline text-muted-foreground hover:text-foreground">
                    <FileText className="w-3 h-3 text-indigo-500" />
                    View Sources ({message.sources.length})
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {message.sources?.map((source, index) => (
                        <Card
                          key={index}
                          className="bg-secondary/50 border-0 transition-all duration-200 hover:bg-secondary hover:shadow-sm hover:scale-[1.02] cursor-pointer"
                        >
                          <CardContent className="p-3">
                            <p className="text-xs font-medium truncate">
                              {source.metadata?.source ||
                                source.metadata?.filename ||
                                'Document'}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Chunk {index + 1}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </>
        )}
      </div>

      {/* User Avatar */}
      {isUser && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shrink-0 shadow-md mt-0.5">
          <User className="w-4 h-4 text-white" />
        </div>
      )}
    </div>
  );
}
