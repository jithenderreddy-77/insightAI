'use client';

import React, { useEffect, useState } from 'react';
import { Download, Share, X, Sparkles, Smartphone, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Check if running as installed standalone PWA
    const standaloneMatch = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (standaloneMatch) {
      setIsStandalone(true);
      return;
    }

    // 2. Check 7-day dismissal cooldown in localStorage
    const dismissedUntil = localStorage.getItem('pwa_install_dismissed_until');
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      return;
    }

    // 3. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isIOSDevice) {
      setShowBanner(true);
    }

    // 4. Handle beforeinstallprompt for Chrome / Edge / Android
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIOSGuide(false);
    // 7-day dismissal cooldown
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem('pwa_install_dismissed_until', (Date.now() + SEVEN_DAYS_MS).toString());
  };

  if (isStandalone || !showBanner) return null;

  return (
    <div className="bg-gradient-to-r from-indigo-900/90 via-slate-900/95 to-purple-900/90 border-b border-indigo-500/30 text-white px-4 py-2.5 text-xs flex items-center justify-between gap-3 shadow-md relative z-40">
      <div className="flex items-center gap-2.5 overflow-hidden">
        <div className="p-1.5 rounded-xl bg-indigo-600/40 text-cyan-300 shrink-0">
          <Smartphone className="w-4 h-4" />
        </div>
        <div className="truncate">
          <span className="font-extrabold text-white">Install Insight AI App</span>
          <span className="hidden sm:inline text-slate-300 ml-1">
            — Add to your home screen for offline access & faster launches
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={handleInstallClick}
          className="h-7 px-3 text-[11px] font-bold bg-indigo-500 hover:bg-indigo-600 text-white gap-1 rounded-lg shadow-sm"
        >
          {isIOS ? <Share className="w-3 h-3 text-cyan-300" /> : <Download className="w-3 h-3" />}
          <span>{isIOS ? 'iOS Setup' : 'Install'}</span>
        </Button>
        <button
          onClick={handleDismiss}
          className="text-slate-400 hover:text-white p-1"
          title="Dismiss for 7 days"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* iOS Safari Guided Popup */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full p-5 rounded-3xl bg-slate-900 border border-indigo-500/40 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-cyan-300 flex items-center gap-2">
                <Share className="w-5 h-5 text-indigo-400" /> Install on iOS Safari
              </h3>
              <button onClick={() => setShowIOSGuide(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="space-y-3 text-xs text-slate-300 list-decimal list-inside leading-relaxed">
              <li>
                Tap the <strong className="text-white">Share button</strong> <Share className="w-3.5 h-3.5 inline text-cyan-400" /> in Safari&apos;s bottom toolbar.
              </li>
              <li>
                Scroll down and select <strong className="text-white">&quot;Add to Home Screen&quot;</strong>.
              </li>
              <li>
                Tap <strong className="text-white">&quot;Add&quot;</strong> in the top right to complete installation!
              </li>
            </ol>

            <Button
              onClick={handleDismiss}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
            >
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
