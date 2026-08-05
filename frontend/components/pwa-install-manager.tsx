'use client';

import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InstallAppModal } from '@/components/install-app-modal';

export function PWAInstallManager() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showTopBanner, setShowTopBanner] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Check if running as installed standalone PWA window
    const standaloneMatch =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (standaloneMatch) {
      setIsStandalone(true);
      return;
    }

    // 2. Capture beforeinstallprompt event (Chrome, Edge, Brave, Opera, Android, Windows, Mac)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Auto-open modal when browser triggers beforeinstallprompt
      setIsModalOpen(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 3. Auto-pop the install modal when user opens the site on Laptop / Desktop / Mobile
    const timer = setTimeout(() => {
      const sessionDismissed = sessionStorage.getItem('pwa_modal_dismissed_session');
      if (!sessionDismissed && !standaloneMatch) {
        setIsModalOpen(true);
      }
    }, 800);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      clearTimeout(timer);
    };
  }, []);

  const handleInstallClick = async (): Promise<boolean> => {
    const activePrompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).deferredPwaPrompt : null);
    if (activePrompt) {
      try {
        activePrompt.prompt();
        const { outcome } = await activePrompt.userChoice;
        if (outcome === 'accepted') {
          setIsModalOpen(false);
          setShowTopBanner(false);
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
      }
      setDeferredPrompt(null);
      if (typeof window !== 'undefined') (window as any).deferredPwaPrompt = null;
      return true;
    }
    return false;
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    sessionStorage.setItem('pwa_modal_dismissed_session', 'true');
  };

  if (isStandalone) return null;

  return (
    <>
      {/* Persistent top reminder banner on website */}
      {showTopBanner && (
        <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 border-b border-indigo-500/30 text-white px-4 py-2 text-xs flex items-center justify-between gap-3 shadow-md relative z-40">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-1.5 rounded-xl bg-indigo-600/50 text-cyan-300 shrink-0">
              <Download className="w-3.5 h-3.5 animate-bounce" />
            </div>
            <div className="truncate">
              <span className="font-extrabold text-white">Install Insight AI Desktop & Mobile App</span>
              <span className="hidden sm:inline text-slate-300 ml-1">
                — Add to Laptop Start Menu, Mac Dock & Phone Home Screen for 100% offline access
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className="h-7 px-3 text-[11px] font-extrabold bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white gap-1 rounded-lg shadow-sm"
            >
              <Download className="w-3 h-3" />
              <span>Install App</span>
            </Button>
            <button
              onClick={() => setShowTopBanner(false)}
              className="text-slate-400 hover:text-white p-1"
              title="Close Banner"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Auto-popping Modal Dialog on Laptop / Desktop / Mobile */}
      <InstallAppModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        deferredPrompt={deferredPrompt}
        onInstall={handleInstallClick}
      />
    </>
  );
}
