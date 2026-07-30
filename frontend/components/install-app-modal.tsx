'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Monitor, Smartphone, Apple, Sparkles, CheckCircle2, Share, Zap, RefreshCw } from 'lucide-react';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt: any;
  onInstall: () => void;
}

export function InstallAppModal({
  isOpen,
  onClose,
  deferredPrompt,
  onInstall,
}: InstallAppModalProps) {
  const [os, setOs] = useState<'android' | 'ios' | 'mac' | 'windows' | 'linux' | 'other'>('windows');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent.toLowerCase();
    if (/android/i.test(ua)) setOs('android');
    else if (/iphone|ipad|ipod/i.test(ua)) setOs('ios');
    else if (/mac/i.test(ua)) setOs('mac');
    else if (/win/i.test(ua)) setOs('windows');
    else if (/linux/i.test(ua)) setOs('linux');
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-w-[94vw] rounded-3xl p-6 bg-slate-950/95 border border-indigo-500/30 text-white backdrop-blur-2xl shadow-[0_0_80px_rgba(79,70,229,0.3)]">
        <DialogHeader className="text-left space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-500 text-white shadow-lg">
              <Download className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <DialogTitle className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-cyan-200 to-white bg-clip-text text-transparent">
                Download & Install Insight AI App
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 font-medium">
                Install as a native desktop/mobile app on Windows, macOS, Android, Linux & iOS.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Auto-Update Guarantee Banner */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-900/60 via-slate-900 to-cyan-950/60 border border-indigo-500/40 flex items-start gap-3">
          <RefreshCw className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5 animate-spin" />
          <div className="text-xs space-y-1">
            <span className="font-extrabold text-cyan-300 block">⚡ Automatic Instant Updates</span>
            <p className="text-slate-300 leading-relaxed">
              Whenever new updates are deployed to Vercel, your installed app updates <strong className="text-white">instantly in the background</strong> without needing to re-download binary packages!
            </p>
          </div>
        </div>

        {/* Primary 1-Click Install Button (When browser supports beforeinstallprompt) */}
        {deferredPrompt ? (
          <div className="p-4 rounded-2xl bg-indigo-950/60 border border-indigo-500/50 flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2 text-indigo-200 font-extrabold text-sm">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span>1-Click Native App Installation Ready!</span>
            </div>
            <Button
              onClick={() => {
                onInstall();
                onClose();
              }}
              className="w-full py-6 rounded-2xl bg-gradient-to-r from-indigo-500 via-cyan-500 to-teal-400 hover:from-indigo-600 hover:to-teal-500 text-white font-extrabold text-sm shadow-xl transition-all duration-300 hover:scale-[1.02] flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              <span>Install Insight AI App Now ({os.toUpperCase()})</span>
            </Button>
          </div>
        ) : null}

        {/* Platform Selection & Instructions */}
        <div className="space-y-3">
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
            Installation Guide by Device:
          </span>

          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            <button
              onClick={() => setOs('windows')}
              className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
                os === 'windows'
                  ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Monitor className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Windows App</span>
            </button>

            <button
              onClick={() => setOs('mac')}
              className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
                os === 'mac'
                  ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Apple className="w-4 h-4 text-slate-200 shrink-0" />
              <span>macOS App</span>
            </button>

            <button
              onClick={() => setOs('android')}
              className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
                os === 'android'
                  ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Android App</span>
            </button>

            <button
              onClick={() => setOs('ios')}
              className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
                os === 'ios'
                  ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Apple className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>iOS (iPhone/iPad)</span>
            </button>
          </div>

          {/* Platform Specific Steps */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 space-y-2">
            {os === 'windows' && (
              <>
                <div className="font-extrabold text-indigo-300 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-indigo-400" /> Windows Desktop Installation:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Click the <strong>&quot;Install App&quot;</strong> icon in the address bar or tap the button above.</li>
                  <li>Click <strong>&quot;Install&quot;</strong> when prompted by Chrome or Microsoft Edge.</li>
                  <li>Insight AI will launch in a dedicated window and add an icon to your <strong>Start Menu, Desktop & Taskbar</strong>!</li>
                </ol>
              </>
            )}

            {os === 'mac' && (
              <>
                <div className="font-extrabold text-indigo-300 flex items-center gap-1.5">
                  <Apple className="w-4 h-4 text-slate-200" /> macOS Desktop Installation:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>In <strong>Chrome / Edge</strong>: Click the install icon in address bar ➔ <strong>&quot;Install App&quot;</strong>.</li>
                  <li>In <strong>Safari</strong>: Click <em>File</em> ➔ <strong>&quot;Add to Dock&quot;</strong>.</li>
                  <li>Insight AI becomes a native macOS app in your <strong>Applications folder & Dock</strong>!</li>
                </ol>
              </>
            )}

            {os === 'android' && (
              <>
                <div className="font-extrabold text-emerald-300 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-400" /> Android App Installation:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Tap Chrome menu <strong>⋮</strong> (top right).</li>
                  <li>Tap <strong>&quot;Install App&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong>.</li>
                  <li>Insight AI installs as a standalone APK app on your <strong>Home Screen & App Drawer</strong>!</li>
                </ol>
              </>
            )}

            {os === 'ios' && (
              <>
                <div className="font-extrabold text-cyan-300 flex items-center gap-1.5">
                  <Share className="w-4 h-4 text-cyan-400" /> iPhone / iPad iOS Installation:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Open this site in <strong>Safari</strong>.</li>
                  <li>Tap the <strong>Share button</strong> (square with arrow up at the bottom bar).</li>
                  <li>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong> ➔ <strong>Add</strong>.</li>
                </ol>
              </>
            )}

            {os === 'linux' && (
              <>
                <div className="font-extrabold text-indigo-300 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-indigo-400" /> Linux Desktop Installation:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Open in Chrome/Brave/Edge on Linux.</li>
                  <li>Click menu ➔ <strong>&quot;Install Insight AI&quot;</strong> or address bar install icon.</li>
                  <li>Launches as a desktop app in your system launcher!</li>
                </ol>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Standalone PWA Architecture
          </span>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs text-slate-400 hover:text-white">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
