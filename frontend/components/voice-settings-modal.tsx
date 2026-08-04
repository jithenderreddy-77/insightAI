'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Settings, Volume2, Keyboard, Sparkles, User, ShieldCheck } from 'lucide-react';
import { getPreferences, setPreference, type UserPreferences } from '@/lib/brain/memory-manager';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VoiceSettingsModal({ isOpen, onClose }: VoiceSettingsModalProps) {
  const [prefs, setPrefs] = useState<UserPreferences>(getPreferences());

  useEffect(() => {
    if (isOpen) {
      setPrefs(getPreferences());
    }
  }, [isOpen]);

  const handleGreetingStyleChange = (style: UserPreferences['wakeGreetingStyle']) => {
    setPreference('wakeGreetingStyle', style);
    setPrefs((prev) => ({ ...prev, wakeGreetingStyle: style }));
  };

  const handleSpeedChange = (speed: number) => {
    setPreference('voiceSpeed', speed);
    setPrefs((prev) => ({ ...prev, voiceSpeed: speed }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Voice & OS Settings</DialogTitle>
              <p className="text-xs text-slate-400">Voice synthesis options, shortcuts, and safety automation policies</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Greeting Style */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Greeting & Personality Style
            </span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'brief', label: 'Brief', desc: 'Minimalist 1-sentence' },
                { id: 'energetic', label: 'Energetic', desc: 'JARVIS-style warm greeting' },
                { id: 'detailed', label: 'Detailed', desc: 'Full capability status' },
              ].map((style) => (
                <button
                  key={style.id}
                  onClick={() => handleGreetingStyleChange(style.id as any)}
                  className={`p-3 rounded-xl border text-left space-y-1 transition-all ${
                    prefs.wakeGreetingStyle === style.id
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <p className="text-xs font-bold">{style.label}</p>
                  <p className="text-[10px] text-slate-500">{style.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Speech Rate */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                Speech Synthesis Speed
              </span>
              <span className="text-indigo-400 font-mono">{prefs.voiceSpeed || 1.05}x</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.5"
              step="0.05"
              value={prefs.voiceSpeed || 1.05}
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="w-full accent-indigo-500 bg-slate-900"
            />
          </div>

          {/* Keyboard Shortcuts Reference */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
              Keyboard Shortcuts
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Focus Text Command</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">/</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Toggle Voice Mic</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Space</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Close Assistant Modal</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Esc</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Submit Command</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Enter</kbd>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
