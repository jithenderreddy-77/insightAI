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
  const [assistantState, setAssistantState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting'>('idle');
  const [transcript, setTranscript] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [recognitionAvailable, setRecognitionAvailable] = useState<boolean>(true);
  const [commandLog, setCommandLog] = useState<string[]>([]);

  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const shouldRestartRef = useRef(false);
  const automationTabRef = useRef<Window | null>(null);

  // Popup-blocker safe tab opener (reuses dedicated automation tab for multi-command support)
  const safeOpenUrl = useCallback((url: string) => {
    setPendingUrl(url);
    try {
      if (automationTabRef.current && !automationTabRef.current.closed) {
        automationTabRef.current.location.href = url;
        try { automationTabRef.current.focus(); } catch {}
      } else {
        const win = window.open(url, 'insight_automation_tab');
        if (win) {
          automationTabRef.current = win;
        } else {
          // Fallback if popup blocker blocks _blank window
          window.location.assign(url);
        }
      }
    } catch {
      window.location.assign(url);
    }
  }, []);

  // Text-to-Speech synthesis
  const speakVoiceResponse = useCallback((text: string, onComplete?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onComplete) onComplete();
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Siri') || v.name.includes('Samantha'))
    ) || voices.find((v) => v.lang.startsWith('en'));
    if (preferredVoice) utterance.voice = preferredVoice;

    setAssistantState('speaking');
    setSpokenText(text);

    utterance.onend = () => {
      if (onComplete) onComplete();
      restartContinuousListening();
    };
    utterance.onerror = () => {
      if (onComplete) onComplete();
      restartContinuousListening();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // Restart continuous listening loop
  const restartContinuousListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isProcessingRef.current = false;
    shouldRestartRef.current = true;
    setAssistantState('waiting');
    setTranscript('');
    setSpokenText('');

    setTimeout(() => {
      if (!shouldRestartRef.current) return;
      try {
        recognitionRef.current.start();
      } catch {}
    }, 250);
  }, []);

  // Instant Client-Side Fast-Path Automation (Sub-second execution with punctuation cleaning)
  const matchClientInstantAction = useCallback(
    (query: string) => {
      // Clean punctuation (. , ! ? ; :) and extra spaces from transcript
      const q = query.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
      if (!q) return false;

      // App Actions
      if (q.includes('upload') || q.includes('add file') || q.includes('add pdf') || q.includes('select document')) {
        setActionNotice('✅ Opening file picker...');
        onTriggerUpload();
        speakVoiceResponse('Opening document upload picker.', () => onClose());
        return true;
      }
      if (q.includes('new chat') || q.includes('start chat') || q.includes('clear chat') || q.includes('reset session')) {
        setActionNotice('✅ Starting new chat...');
        onNewChat();
        speakVoiceResponse('Starting a new chat session.', () => onClose());
        return true;
      }
      if (q.includes('history') || q.includes('past chat') || q.includes('saved chat')) {
        setActionNotice('✅ Opening history...');
        onOpenHistory();
        speakVoiceResponse('Opening your chat and file history.', () => onClose());
        return true;
      }
      if (q.includes('sign in') || q.includes('login') || q.includes('register') || q.includes('create account')) {
        setActionNotice('✅ Opening sign in...');
        onOpenAuth();
        speakVoiceResponse('Opening sign in window.', () => onClose());
        return true;
      }
      if (q.includes('install app') || q.includes('download app')) {
        setActionNotice('✅ App installer launched');
        onInstallApp();
        speakVoiceResponse('Launching app installer.', () => onClose());
        return true;
      }

      // WhatsApp Messaging
      if (q.includes('whatsapp') && (q.includes('message') || q.includes('send') || q.includes('saying') || q.includes('text'))) {
        let msg = q
          .replace(/^(send\s+)?(a\s+)?(whatsapp\s+)?message\s+(on\s+whatsapp\s+)?(saying\s+)?/gi, '')
          .replace(/^open\s+whatsapp\s+(and\s+)?(send\s+)?/gi, '')
          .replace(/\s+on\s+whatsapp$/gi, '')
          .trim();
        const url = msg && msg !== 'whatsapp'
          ? `https://web.whatsapp.com/send?text=${encodeURIComponent(msg)}`
          : 'https://web.whatsapp.com';
        setActionNotice(`✅ Launching WhatsApp: ${msg || 'Web'}`);
        safeOpenUrl(url);
        speakVoiceResponse(`Opening WhatsApp ${msg ? 'to send message' : ''}`);
        return true;
      }

      // Gmail Compose
      if ((q.includes('gmail') || q.includes('email')) && (q.includes('send') || q.includes('compose') || q.includes('write') || q.includes('saying'))) {
        let msg = q
          .replace(/^(send\s+)?(a\s+)?(gmail|email)\s+(message\s+)?(saying\s+)?/gi, '')
          .replace(/^compose\s+(a\s+)?(gmail|email)\s+(saying\s+)?/gi, '')
          .replace(/^write\s+(a\s+)?(gmail|email)\s+(saying\s+)?/gi, '')
          .trim();
        const url = msg && msg !== 'gmail' && msg !== 'email'
          ? `https://mail.google.com/mail/?view=cm&fs=1&body=${encodeURIComponent(msg)}`
          : 'https://mail.google.com/mail/?view=cm&fs=1';
        setActionNotice(`✅ Launching Gmail Compose`);
        safeOpenUrl(url);
        speakVoiceResponse('Opening Gmail compose window.');
        return true;
      }

      // Popular Websites Direct Open (Regex Matching for flexible variations)
      const sites: Record<string, string> = {
        youtube: 'https://www.youtube.com',
        github: 'https://github.com',
        twitter: 'https://x.com',
        x: 'https://x.com',
        wikipedia: 'https://wikipedia.org',
        linkedin: 'https://linkedin.com',
        reddit: 'https://reddit.com',
        amazon: 'https://amazon.com',
        netflix: 'https://netflix.com',
        spotify: 'https://open.spotify.com',
        gmail: 'https://mail.google.com',
        whatsapp: 'https://web.whatsapp.com',
        instagram: 'https://instagram.com',
        chatgpt: 'https://chat.openai.com',
        facebook: 'https://facebook.com',
        google: 'https://www.google.com',
      };

      for (const [key, url] of Object.entries(sites)) {
        const regex = new RegExp(`^(open|go to|launch|open up)?\\s*${key}\\s*$`, 'i');
        if (regex.test(q)) {
          setActionNotice(`✅ Opening ${key.toUpperCase()}`);
          safeOpenUrl(url);
          speakVoiceResponse(`Opening ${key.charAt(0).toUpperCase() + key.slice(1)}.`);
          return true;
        }
      }

      return false;
    },
    [safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onClose]
  );

  // Process voice input and run automation actions
  const processVoiceCommand = useCallback(
    async (spokenTranscript: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      shouldRestartRef.current = false;

      setAssistantState('thinking');
      setActionNotice(null);
      setPendingUrl(null);
      setCommandLog((prev) => [...prev.slice(-4), spokenTranscript]);

      // Stop mic while processing to prevent feedback loop
      try { recognitionRef.current?.stop(); } catch {}

      try {
        // Fast-path instant execution check (0ms latency!)
        const handledInstantly = matchClientInstantAction(spokenTranscript);
        if (handledInstantly) {
          // Reset processing lock
          isProcessingRef.current = false;
          return;
        }

        // Full AI Intent Parser for complex queries / composition
        const response = await fetch('/api/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: spokenTranscript,
            hasActiveDocuments,
          }),
        });

        const data = await response.json();
        const speech = data.spokenResponse || 'Done.';

        if (data.actionType === 'OPEN_WEBSITE' && data.targetUrl) {
          setActionNotice(`✅ Launching: ${data.targetUrl}`);
          safeOpenUrl(data.targetUrl);
          speakVoiceResponse(speech);
        } else if (data.actionType === 'APP_ACTION') {
          const appAct = data.appAction;
          if (appAct === 'upload_document') {
            setActionNotice('✅ Opening file picker...');
            onTriggerUpload();
            speakVoiceResponse(speech, () => onClose());
          } else if (appAct === 'new_chat') {
            setActionNotice('✅ New chat started');
            onNewChat();
            speakVoiceResponse(speech, () => onClose());
          } else if (appAct === 'open_history') {
            setActionNotice('✅ History opened');
            onOpenHistory();
            speakVoiceResponse(speech, () => onClose());
          } else if (appAct === 'open_auth') {
            setActionNotice('✅ Sign in opened');
            onOpenAuth();
            speakVoiceResponse(speech, () => onClose());
          } else if (appAct === 'install_app') {
            setActionNotice('✅ App installer launched');
            onInstallApp();
            speakVoiceResponse(speech, () => onClose());
          } else {
            speakVoiceResponse(speech);
          }
        } else if (data.actionType === 'DOCUMENT_QA' && data.query) {
          setActionNotice(`✅ Querying: "${data.query}"`);
          onAskDocumentQuestion(data.query);
          speakVoiceResponse(speech, () => onClose());
        } else {
          speakVoiceResponse(speech);
        }
      } catch (err) {
        console.error('Error processing voice command:', err);
        speakVoiceResponse('Sorry, there was an issue. Please try again.');
      } finally {
        // ALWAYS unlock processing lock so future commands work
        isProcessingRef.current = false;
      }
    },
    [hasActiveDocuments, matchClientInstantAction, safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onAskDocumentQuestion, onClose]
  );

  // Initialize Speech Recognition (Mobile & Desktop Compatible)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setRecognitionAvailable(false);
      return;
    }

    const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const rec = new SpeechRecognitionAPI();

    rec.continuous = !isMobileDevice;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      if (!isProcessingRef.current) {
        setAssistantState('listening');
      }
    };

    rec.onresult = (event: any) => {
      if (isProcessingRef.current) return;

      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += t;
        } else {
          interimText += t;
        }
      }

      setTranscript(finalText || interimText);

      if (finalText) {
        const cleaned = finalText.trim();
        if (!cleaned || cleaned.length < 2) return;

        const wakeWordPatterns = [
          /^(ok|okay|hey|hi)\s+insight\s*/i,
          /^insight\s*/i,
        ];

        let command = cleaned;
        let hasWakeWord = false;

        for (const pattern of wakeWordPatterns) {
          if (pattern.test(cleaned)) {
            command = cleaned.replace(pattern, '').trim();
            hasWakeWord = true;
            break;
          }
        }

        if (hasWakeWord && !command) {
          setTranscript('Listening for your command...');
          speakVoiceResponse("I'm listening. What would you like me to do?");
          return;
        }

        if (command.length > 1) {
          processVoiceCommand(command);
        }
      }
    };

    rec.onerror = (event: any) => {
      console.log('[SpeechRecognition] Mobile/Desktop Notice:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecognitionAvailable(false);
        setAssistantState('idle');
      }
    };

    rec.onend = () => {
      if (!isProcessingRef.current && shouldRestartRef.current) {
        setTimeout(() => {
          try { rec.start(); } catch {}
        }, 300);
      }
    };

    recognitionRef.current = rec;

    return () => {
      shouldRestartRef.current = false;
      try { rec.stop(); } catch {}
    };
  }, [processVoiceCommand, speakVoiceResponse]);

  // Start listening when modal opens
  useEffect(() => {
    if (isOpen && recognitionRef.current) {
      isProcessingRef.current = false;
      shouldRestartRef.current = true;
      setAssistantState('listening');
      setTranscript('');
      setSpokenText('');
      setActionNotice(null);
      setPendingUrl(null);
      setCommandLog([]);

      setTimeout(() => {
        try { recognitionRef.current.start(); } catch {}
      }, 200);

      setTimeout(() => {
        speakVoiceResponse("Hi! I'm Insight Voice. Say a command or say Ok Insight to get started.");
      }, 500);
    }

    return () => {
      shouldRestartRef.current = false;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      isProcessingRef.current = false;
    };
  }, [isOpen, speakVoiceResponse]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (assistantState === 'listening' || assistantState === 'waiting') {
      shouldRestartRef.current = false;
      try { recognitionRef.current.stop(); } catch {}
      setAssistantState('idle');
    } else {
      isProcessingRef.current = false;
      shouldRestartRef.current = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      try { recognitionRef.current.start(); } catch {}
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
            <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">Say &quot;Ok Insight&quot;</span>
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
        <div className="p-8 py-10 flex flex-col items-center justify-center gap-6 relative overflow-hidden">
          {/* Ambient Background Aura */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-fuchsia-500/10 to-indigo-500/10 blur-3xl pointer-events-none" />

          {/* FUTURISTIC NEON SIRI ORB */}
          <div
            className="relative cursor-pointer group flex items-center justify-center"
            onClick={toggleListening}
            onTouchStart={toggleListening}
            title="Tap to speak / stop"
          >
            {/* Outer Glowing Pulsing Rings */}
            <div
              className={`absolute rounded-full transition-all duration-700 ${
                assistantState === 'listening' || assistantState === 'waiting'
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
                assistantState === 'listening' || assistantState === 'waiting'
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
                  : assistantState === 'waiting'
                  ? 'bg-gradient-to-tr from-emerald-500 via-cyan-500 to-indigo-500 shadow-[0_0_60px_rgba(16,185,129,0.8)]'
                  : assistantState === 'speaking'
                  ? 'bg-gradient-to-tr from-fuchsia-600 via-pink-500 to-indigo-500 shadow-[0_0_60px_rgba(236,72,153,0.8)]'
                  : assistantState === 'thinking'
                  ? 'bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 shadow-[0_0_60px_rgba(99,102,241,0.8)] animate-pulse'
                  : 'bg-gradient-to-tr from-slate-800 via-slate-900 to-indigo-950 shadow-lg border border-slate-700'
              }`}
            >
              {assistantState === 'listening' ? (
                <Mic className="w-12 h-12 text-white animate-bounce" />
              ) : assistantState === 'waiting' ? (
                <Mic className="w-12 h-12 text-white animate-pulse" />
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
                  : assistantState === 'waiting'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                  : assistantState === 'speaking'
                  ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
                  : assistantState === 'thinking'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {assistantState === 'listening' && '🎙️ Listening — Speak Now...'}
              {assistantState === 'waiting' && '✅ Ready — Say next command'}
              {assistantState === 'thinking' && '⚡ Executing Automation...'}
              {assistantState === 'speaking' && '🔊 Speaking...'}
              {assistantState === 'idle' && 'Tap Orb to Activate'}
            </span>

            {/* Real-time Voice Transcript */}
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

            {pendingUrl && (
              <button
                onClick={() => safeOpenUrl(pendingUrl)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-extrabold text-xs shadow-lg transition-transform hover:scale-105 animate-bounce"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Click Here to Launch ({pendingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 25)})</span>
              </button>
            )}

            {!recognitionAvailable && (
              <p className="text-xs text-rose-400 bg-rose-950/50 p-2 rounded-lg border border-rose-800">
                Speech recognition unavailable. Please enable mic permissions or use Chrome/Safari/Edge.
              </p>
            )}
          </div>

          {/* Command History Log */}
          {commandLog.length > 0 && (
            <div className="w-full pt-2 border-t border-slate-800/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center mb-1.5">
                Recent Commands
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {commandLog.map((cmd, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[10px] text-slate-400 truncate max-w-[140px]">
                    {cmd}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick Voice Command Hints */}
          <div className="w-full pt-2 border-t border-slate-800/80">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center mb-2.5">
              Try Saying:
            </p>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 font-medium">
              <button
                onClick={() => processVoiceCommand('Send WhatsApp message Hello')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>&quot;Send WhatsApp message...&quot;</span>
              </button>

              <button
                onClick={() => processVoiceCommand('Compose Gmail saying Meeting at 5pm')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <Globe className="w-3 h-3 text-fuchsia-400 shrink-0" />
                <span>&quot;Compose Gmail...&quot;</span>
              </button>

              <button
                onClick={() => processVoiceCommand('Open YouTube')}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left truncate transition-colors flex items-center gap-1.5"
              >
                <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                <span>&quot;Open YouTube / Google&quot;</span>
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
