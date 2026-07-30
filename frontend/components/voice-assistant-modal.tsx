'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, Sparkles, Volume2, Globe, FileText, Zap, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface VoiceAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasActiveDocuments: boolean;
  onTriggerUpload: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenAuth: () => void;
  onInstallApp: () => void;
  onAskDocumentQuestion: (question: string) => void;
}

export function VoiceAssistantModal({
  isOpen,
  onClose,
  hasActiveDocuments,
  onTriggerUpload,
  onNewChat,
  onOpenHistory,
  onOpenAuth,
  onInstallApp,
  onAskDocumentQuestion,
}: VoiceAssistantModalProps) {
  const [assistantState, setAssistantState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [recognitionAvailable, setRecognitionAvailable] = useState<boolean>(true);

  const recognitionRef = useRef<any>(null);

  // Initialize Text-to-Speech Synthesis
  const speakVoiceResponse = useCallback((text: string, onComplete?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onComplete) onComplete();
      return;
    }

    window.speechSynthesis.cancel(); // Stop any ongoing speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick best English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Siri') || v.name.includes('Samantha'))
    ) || voices.find((v) => v.lang.startsWith('en'));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    setAssistantState('speaking');
    setSpokenText(text);

    utterance.onend = () => {
      setAssistantState('idle');
      if (onComplete) onComplete();
    };

    utterance.onerror = () => {
      setAssistantState('idle');
      if (onComplete) onComplete();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // Process voice input and run automation actions
  const processVoiceCommand = useCallback(
    async (spokenTranscript: string) => {
      setAssistantState('thinking');
      setActionNotice(null);

      try {
        const response = await fetch('/api/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: spokenTranscript,
            hasActiveDocuments,
          }),
        });

        const data = await response.json();
        const speech = data.spokenResponse || 'Command processed.';

        // Execute automated actions on client
        if (data.actionType === 'OPEN_WEBSITE' && data.targetUrl) {
          setActionNotice(`Opening website: ${data.targetUrl}`);
          speakVoiceResponse(speech, () => {
            window.open(data.targetUrl, '_blank');
          });
        } else if (data.actionType === 'APP_ACTION') {
          const appAct = data.appAction;
          if (appAct === 'upload_document') {
            setActionNotice('Opening document upload...');
            speakVoiceResponse(speech, () => {
              onTriggerUpload();
              onClose();
            });
          } else if (appAct === 'new_chat') {
            setActionNotice('Starting new chat...');
            speakVoiceResponse(speech, () => {
              onNewChat();
              onClose();
            });
          } else if (appAct === 'open_history') {
            setActionNotice('Opening history...');
            speakVoiceResponse(speech, () => {
              onOpenHistory();
              onClose();
            });
          } else if (appAct === 'open_auth') {
            setActionNotice('Opening sign in...');
            speakVoiceResponse(speech, () => {
              onOpenAuth();
              onClose();
            });
          } else if (appAct === 'install_app') {
            setActionNotice('Launching app installer...');
            speakVoiceResponse(speech, () => {
              onInstallApp();
              onClose();
            });
          } else {
            speakVoiceResponse(speech);
          }
        } else if (data.actionType === 'DOCUMENT_QA' && data.query) {
          setActionNotice(`Querying document: "${data.query}"`);
          speakVoiceResponse(speech, () => {
            onAskDocumentQuestion(data.query);
            onClose();
          });
        } else {
          speakVoiceResponse(speech);
        }
      } catch (err) {
        console.error('Error processing voice command:', err);
        speakVoiceResponse('Sorry, there was an issue executing that command.');
      }
    },
    [hasActiveDocuments, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onAskDocumentQuestion, onClose]
  );

  // Initialize Speech Recognition API
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setRecognitionAvailable(false);
      return;
    }

    const rec = new SpeechRecognitionAPI();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setAssistantState('listening');
      setTranscript('');
      setSpokenText('');
      setActionNotice(null);
    };

    rec.onresult = (event: any) => {
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const finalText = event.results[i][0].transcript;
          setTranscript(finalText);
          processVoiceCommand(finalText);
          return;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
      setTranscript(currentInterim);
    };

    rec.onerror = (event: any) => {
      console.log('[SpeechRecognition] Error notice:', event.error);
      if (event.error !== 'no-speech') {
        setAssistantState('idle');
      }
    };

    rec.onend = () => {
      // Handled in onresult final or error
    };

    recognitionRef.current = rec;
  }, [processVoiceCommand]);

  // Start listening automatically when modal opens
  useEffect(() => {
    if (isOpen && recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
    }

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, [isOpen]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (assistantState === 'listening') {
      try {
        recognitionRef.current.stop();
      } catch {}
      setAssistantState('idle');
    } else {
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
        recognitionRef.current.start();
      } catch {}
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-w-[92vw] rounded-3xl p-0 overflow-hidden border border-cyan-500/30 shadow-[0_0_80px_rgba(6,182,212,0.3)] bg-slate-950/95 backdrop-blur-2xl text-white">
        {/* Top Control Bar */}
        <div className="p-4 px-6 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
            <span className="font-extrabold text-sm tracking-wide bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
              INSIGHT VOICE AUTOMATION
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Central Siri/Alexa Glowing Neon Orb Area */}
        <div className="p-8 py-10 flex flex-col items-center justify-center gap-8 relative overflow-hidden">
          {/* Ambient Background Aura */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-fuchsia-500/10 to-indigo-500/10 blur-3xl pointer-events-none" />

          {/* FUTURISTIC NEON SIRI ORB */}
          <div
            className="relative cursor-pointer group flex items-center justify-center"
            onClick={toggleListening}
            title="Click to speak / stop"
          >
            {/* Outer Glowing Pulsing Rings */}
            <div
              className={`absolute rounded-full transition-all duration-700 ${
                assistantState === 'listening'
                  ? 'w-48 h-48 border-2 border-cyan-400/60 shadow-[0_0_50px_rgba(34,211,238,0.6)] animate-ping'
                  : assistantState === 'speaking'
                  ? 'w-48 h-48 border-2 border-fuchsia-400/60 shadow-[0_0_50px_rgba(232,121,249,0.6)] animate-pulse'
                  : assistantState === 'thinking'
                  ? 'w-48 h-48 border-2 border-indigo-400/60 shadow-[0_0_50px_rgba(129,140,248,0.6)] animate-spin'
                  : 'w-40 h-40 border border-slate-700/50 shadow-none'
              }`}
            />

            <div
              className={`absolute rounded-full transition-all duration-500 ${
                assistantState === 'listening'
                  ? 'w-40 h-40 bg-gradient-to-r from-cyan-500/30 via-indigo-500/30 to-fuchsia-500/30 blur-xl animate-pulse'
                  : assistantState === 'speaking'
                  ? 'w-40 h-40 bg-gradient-to-r from-fuchsia-500/40 via-purple-500/40 to-pink-500/40 blur-xl animate-bounce'
                  : 'w-36 h-36 bg-indigo-500/20 blur-lg'
              }`}
            />

            {/* Core Neon Orb Sphere */}
            <div
              className={`w-32 h-32 rounded-full flex items-center justify-center shadow-2xl relative z-10 transition-transform duration-300 group-hover:scale-105 ${
                assistantState === 'listening'
                  ? 'bg-gradient-to-tr from-cyan-500 via-indigo-500 to-fuchsia-500 shadow-[0_0_60px_rgba(34,211,238,0.8)]'
                  : assistantState === 'speaking'
                  ? 'bg-gradient-to-tr from-fuchsia-600 via-pink-500 to-indigo-500 shadow-[0_0_60px_rgba(236,72,153,0.8)]'
                  : assistantState === 'thinking'
                  ? 'bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 shadow-[0_0_60px_rgba(99,102,241,0.8)] animate-pulse'
                  : 'bg-gradient-to-tr from-slate-800 via-slate-900 to-indigo-950 shadow-lg border border-slate-700'
              }`}
            >
              {assistantState === 'listening' ? (
                <Mic className="w-12 h-12 text-white animate-bounce" />
              ) : assistantState === 'speaking' ? (
                <Volume2 className="w-12 h-12 text-white animate-pulse" />
              ) : assistantState === 'thinking' ? (
                <Sparkles className="w-12 h-12 text-white animate-spin" />
              ) : (
                <MicOff className="w-10 h-10 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              )}
            </div>
          </div>

          {/* Assistant State Status Pill */}
          <div className="flex flex-col items-center gap-2 text-center max-w-xs relative z-10">
            <span
              className={`px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md ${
                assistantState === 'listening'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse'
                  : assistantState === 'speaking'
                  ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
                  : assistantState === 'thinking'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {assistantState === 'listening' && '🎙️ Listening to Voice...'}
              {assistantState === 'thinking' && '⚡ Parsing Intent & Automating...'}
              {assistantState === 'speaking' && '🔊 Speaking Response...'}
              {assistantState === 'idle' && 'Click Orb to Speak'}
            </span>

            {/* Real-time Voice Transcript / Feedback text */}
            {transcript && (
              <div className="p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/30 text-xs font-medium text-cyan-200 w-full animate-fade-in">
                &quot;{transcript}&quot;
              </div>
            )}

            {spokenText && assistantState === 'speaking' && (
              <p className="text-xs text-fuchsia-200 leading-relaxed font-semibold italic animate-fade-in">
                {spokenText}
              </p>
            )}

            {actionNotice && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold">
                <Zap className="w-3.5 h-3.5" />
                {actionNotice}
              </div>
            )}

            {!recognitionAvailable && (
              <p className="text-xs text-rose-400 bg-rose-950/50 p-2 rounded-lg border border-rose-800">
                Speech recognition is unavailable in this browser. Please use Chrome, Edge, or Safari.
              </p>
            )}
          </div>

          {/* Quick Voice Command Hints */}
          <div className="w-full pt-2 border-t border-slate-800/80">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center mb-2.5">
              Try Saying:
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 font-medium">
              <button
                onClick={() => processVoiceCommand('Open YouTube and play iPhone 16 review')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>&quot;Open YouTube & search...&quot;</span>
              </button>

              <button
                onClick={() => processVoiceCommand('Open GitHub')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <Globe className="w-3 h-3 text-fuchsia-400 shrink-0" />
                <span>&quot;Open GitHub / Google&quot;</span>
              </button>

              <button
                onClick={() => processVoiceCommand('Upload a document')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                <span>&quot;Upload a document&quot;</span>
              </button>

              <button
                onClick={() => processVoiceCommand('Summarize my document')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>&quot;Summarize document&quot;</span>
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
