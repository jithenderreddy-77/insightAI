'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PWAUpdateToast() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleRegistration = (reg: ServiceWorkerRegistration) => {
      // Check if a worker is already waiting
      if (reg.waiting) {
        setWaitingWorker(reg.waiting);
        setShowToast(true);
      }

      // Listen for new service worker installation
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA Update] New version detected and ready for refresh!');
            setWaitingWorker(newWorker);
            setShowToast(true);
          }
        });
      });
    };

    // Register service worker and attach lifecycle listeners
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        handleRegistration(reg);

        // Periodically check for updates (every 5 minutes)
        const interval = setInterval(() => {
          reg.update().catch(() => {/* ignore offline update check failure */});
        }, 5 * 60 * 1000);

        return () => clearInterval(interval);
      })
      .catch((err) => {
        console.log('[PWA] ServiceWorker registration error:', err);
      });

    // Listen for controller changes to refresh page after SKIP_WAITING
    let refreshing = false;
    const handleControllerChange = () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const handleRefresh = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  };

  if (!showToast) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] max-w-md w-[90vw] p-4 rounded-2xl bg-slate-900/95 border border-indigo-500/50 text-white shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-600/30 text-indigo-400 shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse text-cyan-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              New Version Available
            </h4>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              A new update has been deployed to Vercel. Refresh to load the latest features!
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowToast(false)}
          className="text-slate-400 hover:text-white transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowToast(false)}
          className="h-8 text-xs text-slate-400 hover:text-white"
        >
          Later
        </Button>
        <Button
          size="sm"
          onClick={handleRefresh}
          className="h-8 px-4 text-xs font-bold bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white gap-1.5 rounded-xl shadow-lg"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Now
        </Button>
      </div>
    </div>
  );
}
