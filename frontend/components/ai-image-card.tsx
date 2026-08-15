'use client';

import React, { useState } from 'react';
import {
  Maximize2,
  Download,
  Sparkles,
  Check,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

export interface AIImageCardProps {
  imageUrl?: string;
  prompt: string;
  provider?: string;
  groundedFacts?: string[];
  aspectRatio?: string;
  status?: string;
}

export function AIImageCard({
  imageUrl,
  prompt,
  provider = 'Google Gemini Imagen',
  groundedFacts = [],
  status,
}: AIImageCardProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const isGenerating = status === 'generating' || !imageUrl;

  const handleDownload = async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pdf-visual-illustration-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch {
      window.open(imageUrl, '_blank');
    }
  };

  return (
    <div className="my-4 rounded-2xl border border-indigo-200/60 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/40 via-purple-50/20 to-slate-50 dark:from-slate-900/80 dark:via-indigo-950/40 dark:to-slate-900 p-4 shadow-md backdrop-blur-sm transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <span>AI Visual Illustration</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                {isGenerating ? 'Generating...' : provider}
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs sm:max-w-md">
              {prompt}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        {!isGenerating && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={handleDownload}
              title="Download visual image"
            >
              {downloaded ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => setIsFullscreen(true)}
              title="Full screen view"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Image Display / Progressive Loader */}
      <div
        className={`relative rounded-xl overflow-hidden bg-slate-900/10 dark:bg-slate-950/80 border border-slate-200/80 dark:border-slate-800 ${
          isGenerating ? 'cursor-default' : 'cursor-pointer group'
        }`}
        onClick={() => !isGenerating && setIsFullscreen(true)}
      >
        {isGenerating ? (
          <div className="w-full h-56 sm:h-72 flex flex-col items-center justify-center bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm text-slate-500 gap-3">
            <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-500 animate-spin">
              <Loader2 className="w-6 h-6" />
            </div>
            <div className="text-center px-4">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-0.5">
                Creating grounded visual illustration...
              </span>
              <span className="text-[11px] text-slate-400">
                You can continue typing and chatting while the image renders.
              </span>
            </div>
          </div>
        ) : (
          <>
            {!loaded && (
              <div className="w-full h-64 sm:h-80 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 animate-pulse text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs font-medium">Loading image...</span>
              </div>
            )}

            <img
              src={imageUrl}
              alt={prompt}
              onLoad={() => setLoaded(true)}
              className={`w-full h-auto max-h-[420px] object-cover transition-transform duration-500 group-hover:scale-[1.02] ${
                loaded ? 'opacity-100' : 'opacity-0 absolute top-0 left-0'
              }`}
            />

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/80 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                <Maximize2 className="w-3.5 h-3.5" /> Click for full view
              </span>
            </div>
          </>
        )}
      </div>

      {/* Grounding Facts Badge */}
      {!isGenerating && groundedFacts && groundedFacts.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-indigo-100 dark:border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">PDF Grounding Verified: </span>
            <span className="opacity-90">{groundedFacts.slice(0, 2).join(' • ')}</span>
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {!isGenerating && imageUrl && (
        <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
          <DialogContent className="max-w-5xl w-[95vw] p-2 bg-slate-950/95 border-slate-800 backdrop-blur-xl">
            <DialogTitle className="sr-only">AI Visual Illustration View</DialogTitle>
            <div className="relative flex flex-col items-center justify-center p-2">
              <img
                src={imageUrl}
                alt={prompt}
                className="max-h-[85vh] w-auto object-contain rounded-lg shadow-2xl"
              />
              <div className="w-full mt-3 px-4 py-2 bg-slate-900/80 rounded-xl flex justify-between items-center text-slate-200 text-xs">
                <p className="truncate max-w-xl">{prompt}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={handleDownload}
                >
                  <Download className="w-3.5 h-3.5" /> Download PNG
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
