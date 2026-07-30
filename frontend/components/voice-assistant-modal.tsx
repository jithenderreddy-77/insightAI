'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, Sparkles, Volume2, Zap, Minimize2, Maximize2 } from 'lucide-react';

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

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting';

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
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [recognitionAvailable, setRecognitionAvailable] = useState(true);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);

  // Draggable floating orb position
  const [orbPos, setOrbPos] = useState({ x: -1, y: -1 });
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const orbRef = useRef<HTMLDivElement>(null);

  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const shouldRestartRef = useRef(false);
  const automationTabRef = useRef<Window | null>(null);
  const hasGreetedRef = useRef(false);

  // Initialize orb position (bottom-right)
  useEffect(() => {
    if (orbPos.x === -1) {
      setOrbPos({
        x: typeof window !== 'undefined' ? window.innerWidth - 70 : 300,
        y: typeof window !== 'undefined' ? window.innerHeight - 140 : 500,
      });
    }
  }, [orbPos.x]);

  // --- DRAGGABLE ORB HANDLERS ---
  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: clientX - orbPos.x,
      y: clientY - orbPos.y,
    };
  }, [orbPos]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const newX = Math.max(0, Math.min(clientX - dragOffsetRef.current.x, window.innerWidth - 56));
    const newY = Math.max(0, Math.min(clientY - dragOffsetRef.current.y, window.innerHeight - 56));
    setOrbPos({ x: newX, y: newY });
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
    const onMouseUp = () => handleDragEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => handleDragEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  // --- OPEN URL INSTANTLY (no "Click Here" button) ---
  const safeOpenUrl = useCallback((url: string) => {
    try {
      if (automationTabRef.current && !automationTabRef.current.closed) {
        automationTabRef.current.location.href = url;
        try { automationTabRef.current.focus(); } catch {}
      } else {
        const win = window.open(url, 'insight_automation_tab');
        if (win) {
          automationTabRef.current = win;
        } else {
          window.location.assign(url);
        }
      }
    } catch {
      window.location.assign(url);
    }
  }, []);

  // --- TEXT-TO-SPEECH ---
  const speakVoiceResponse = useCallback((text: string, onComplete?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onComplete) onComplete();
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.15;
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

  // --- RESTART CONTINUOUS LISTENING ---
  const restartContinuousListening = useCallback(() => {
    if (!recognitionRef.current) return;
    isProcessingRef.current = false;
    shouldRestartRef.current = true;
    setAssistantState('waiting');
    setTranscript('');
    setSpokenText('');

    setTimeout(() => {
      if (!shouldRestartRef.current) return;
      try { recognitionRef.current.start(); } catch {}
    }, 200);
  }, []);

  // --- INSTANT CLIENT-SIDE FAST-PATH AUTOMATION ---
  const matchClientInstantAction = useCallback(
    (query: string): boolean => {
      const q = query.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
      if (!q) return false;

      // App Actions (don't close modal — stay in background)
      if (q.includes('upload') || q.includes('add file') || q.includes('add pdf') || q.includes('select document')) {
        setActionNotice('✅ Opening file picker...');
        onTriggerUpload();
        speakVoiceResponse('Opening document upload picker.');
        return true;
      }
      if (q.includes('new chat') || q.includes('start chat') || q.includes('clear chat') || q.includes('reset session')) {
        setActionNotice('✅ Starting new chat...');
        onNewChat();
        speakVoiceResponse('Starting a new chat session.');
        return true;
      }
      if (q.includes('history') || q.includes('past chat') || q.includes('saved chat')) {
        setActionNotice('✅ Opening history...');
        onOpenHistory();
        speakVoiceResponse('Opening your chat and file history.');
        return true;
      }
      if (q.includes('sign in') || q.includes('login') || q.includes('register') || q.includes('create account')) {
        setActionNotice('✅ Opening sign in...');
        onOpenAuth();
        speakVoiceResponse('Opening sign in window.');
        return true;
      }
      if (q.includes('install app') || q.includes('download app')) {
        setActionNotice('✅ App installer launched');
        onInstallApp();
        speakVoiceResponse('Launching app installer.');
        return true;
      }

      // Stop / Close assistant
      if (q === 'stop' || q === 'close' || q === 'exit' || q === 'quit' || q === 'shut down' || q === 'goodbye' || q === 'bye') {
        speakVoiceResponse('Goodbye! Closing Insight Voice.');
        setTimeout(() => onClose(), 1500);
        return true;
      }

      // Minimize
      if (q === 'minimize' || q === 'go to background' || q === 'hide') {
        setIsMinimized(true);
        speakVoiceResponse('Going to background. Tap the star to open me.');
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
        setActionNotice(`✅ WhatsApp: ${msg || 'Opened'}`);
        safeOpenUrl(url);
        speakVoiceResponse(msg ? `Opening WhatsApp to send message.` : 'Opening WhatsApp.');
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
        setActionNotice(`✅ Gmail Compose opened`);
        safeOpenUrl(url);
        speakVoiceResponse('Opening Gmail compose window.');
        return true;
      }

      // Popular Websites Direct Open
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
        stackoverflow: 'https://stackoverflow.com',
      };

      for (const [key, url] of Object.entries(sites)) {
        const regex = new RegExp(`^(open|go to|launch|open up)?\\s*${key}\\s*$`, 'i');
        if (regex.test(q)) {
          setActionNotice(`✅ ${key.charAt(0).toUpperCase() + key.slice(1)} opened`);
          safeOpenUrl(url);
          speakVoiceResponse(`Opening ${key.charAt(0).toUpperCase() + key.slice(1)}.`);
          return true;
        }
      }

      // YouTube search
      if (q.includes('youtube') || q.startsWith('play ') || q.includes('watch ')) {
        let search = q
          .replace(/^open\s+youtube\s*(and\s+)?(search\s+)?(for\s+)?(play\s+)?/gi, '')
          .replace(/^search\s+(on\s+)?youtube\s+(for\s+)?/gi, '')
          .replace(/^play\s+/g, '').replace(/^watch\s+/g, '')
          .replace(/\s+on\s+youtube$/gi, '').replace(/\byoutube\b/gi, '')
          .trim();
        if (!search) {
          setActionNotice('✅ YouTube opened');
          safeOpenUrl('https://www.youtube.com');
          speakVoiceResponse('Opening YouTube.');
        } else {
          setActionNotice(`✅ YouTube: "${search}"`);
          safeOpenUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`);
          speakVoiceResponse(`Searching YouTube for ${search}.`);
        }
        return true;
      }

      // Google search
      if (q.includes('google') || q.startsWith('search for ') || q.startsWith('search ')) {
        let search = q
          .replace(/^(open\s+)?google\s*(and\s+)?(search\s+)?(for\s+)?/gi, '')
          .replace(/^search\s+(google\s+)?(for\s+)?/gi, '')
          .trim();
        if (!search) {
          safeOpenUrl('https://www.google.com');
          speakVoiceResponse('Opening Google.');
        } else {
          safeOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(search)}`);
          speakVoiceResponse(`Searching Google for ${search}.`);
        }
        setActionNotice(`✅ Google: ${search || 'opened'}`);
        return true;
      }

      // Generic "open X.com" fallback
      if (q.startsWith('open ') || q.startsWith('go to ')) {
        const target = q.replace(/^(open|go to)\s+/g, '').trim();
        if (target.includes('.') && !target.includes(' ')) {
          const url = target.startsWith('http') ? target : `https://${target}`;
          setActionNotice(`✅ Opening ${target}`);
          safeOpenUrl(url);
          speakVoiceResponse(`Opening ${target}.`);
          return true;
        }
        // Treat as Google search
        const encoded = encodeURIComponent(target);
        setActionNotice(`✅ Searching: ${target}`);
        safeOpenUrl(`https://www.google.com/search?q=${encoded}`);
        speakVoiceResponse(`Searching for ${target}.`);
        return true;
      }

      return false;
    },
    [safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onClose]
  );

  // --- PROCESS VOICE COMMAND ---
  const processVoiceCommand = useCallback(
    async (spokenTranscript: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      shouldRestartRef.current = false;

      setAssistantState('thinking');
      setActionNotice(null);
      setCommandLog((prev) => [...prev.slice(-4), spokenTranscript]);

      try { recognitionRef.current?.stop(); } catch {}

      try {
        // Fast-path check (0ms latency)
        const handled = matchClientInstantAction(spokenTranscript);
        if (handled) return;

        // AI Intent Parser for complex / unrecognized queries
        const response = await fetch('/api/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: spokenTranscript, hasActiveDocuments }),
        });
        const data = await response.json();
        const speech = data.spokenResponse || 'Done.';

        if (data.actionType === 'OPEN_WEBSITE' && data.targetUrl) {
          setActionNotice(`✅ ${data.targetUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}`);
          safeOpenUrl(data.targetUrl);
          speakVoiceResponse(speech);
        } else if (data.actionType === 'APP_ACTION') {
          const a = data.appAction;
          if (a === 'upload_document') { onTriggerUpload(); }
          else if (a === 'new_chat') { onNewChat(); }
          else if (a === 'open_history') { onOpenHistory(); }
          else if (a === 'open_auth') { onOpenAuth(); }
          else if (a === 'install_app') { onInstallApp(); }
          setActionNotice(`✅ ${a || 'done'}`);
          speakVoiceResponse(speech);
        } else if (data.actionType === 'DOCUMENT_QA' && data.query) {
          setActionNotice(`✅ Querying document...`);
          onAskDocumentQuestion(data.query);
          speakVoiceResponse(speech);
        } else {
          speakVoiceResponse(speech);
        }
      } catch (err) {
        console.error('Voice command error:', err);
        speakVoiceResponse('Sorry, there was an issue. Try again.');
      } finally {
        isProcessingRef.current = false;
      }
    },
    [hasActiveDocuments, matchClientInstantAction, safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onAskDocumentQuestion]
  );

  // --- SPEECH RECOGNITION INIT ---
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) { setRecognitionAvailable(false); return; }

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const rec = new SpeechRecognitionAPI();
    rec.continuous = !isMobile;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => { if (!isProcessingRef.current) setAssistantState('listening'); };

    rec.onresult = (event: any) => {
      if (isProcessingRef.current) return;
      let finalText = '', interimText = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t; else interimText += t;
      }
      setTranscript(finalText || interimText);

      if (finalText) {
        const cleaned = finalText.trim();
        if (!cleaned || cleaned.length < 2) return;

        // Wake word check
        const wakePatterns = [/^(ok|okay|hey|hi)\s+insight\s*/i, /^insight\s*/i];
        let command = cleaned;
        let hasWake = false;
        for (const p of wakePatterns) {
          if (p.test(cleaned)) { command = cleaned.replace(p, '').trim(); hasWake = true; break; }
        }
        if (hasWake && !command) {
          setTranscript('Listening...');
          speakVoiceResponse("I'm listening. What would you like me to do?");
          return;
        }
        if (command.length > 1) processVoiceCommand(command);
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecognitionAvailable(false); setAssistantState('idle');
      }
    };

    rec.onend = () => {
      if (!isProcessingRef.current && shouldRestartRef.current) {
        setTimeout(() => { try { rec.start(); } catch {} }, 250);
      }
    };

    recognitionRef.current = rec;
    return () => { shouldRestartRef.current = false; try { rec.stop(); } catch {} };
  }, [processVoiceCommand, speakVoiceResponse]);

  // --- START WHEN MODAL OPENS ---
  useEffect(() => {
    if (isOpen && recognitionRef.current) {
      isProcessingRef.current = false;
      shouldRestartRef.current = true;
      setIsMinimized(false);
      setAssistantState('listening');
      setTranscript(''); setSpokenText(''); setActionNotice(null); setCommandLog([]);

      setTimeout(() => { try { recognitionRef.current.start(); } catch {} }, 200);

      if (!hasGreetedRef.current) {
        setTimeout(() => {
          speakVoiceResponse("Hi! I'm Insight Voice. Say any command and I'll handle it.");
        }, 500);
        hasGreetedRef.current = true;
      }
    }

    return () => {
      if (!isOpen) {
        shouldRestartRef.current = false;
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
        isProcessingRef.current = false;
        hasGreetedRef.current = false;
      }
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
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      try { recognitionRef.current.start(); } catch {}
    }
  };

  if (!isOpen) return null;

  // --- MINIMIZED FLOATING DRAGGABLE ORB ---
  if (isMinimized) {
    const isActive = assistantState === 'listening' || assistantState === 'waiting';
    return (
      <div
        ref={orbRef}
        className="fixed z-[9999] select-none touch-none"
        style={{ left: orbPos.x, top: orbPos.y }}
        onMouseDown={(e) => { e.preventDefault(); handleDragStart(e.clientX, e.clientY); }}
        onTouchStart={(e) => { if (e.touches[0]) handleDragStart(e.touches[0].clientX, e.touches[0].clientY); }}
      >
        <button
          onClick={() => { if (!isDraggingRef.current) setIsMinimized(false); }}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
            isActive
              ? 'bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-600 shadow-[0_0_30px_rgba(59,130,246,0.8)] animate-pulse'
              : assistantState === 'speaking'
              ? 'bg-gradient-to-tr from-fuchsia-500 via-pink-500 to-purple-600 shadow-[0_0_30px_rgba(236,72,153,0.8)]'
              : assistantState === 'thinking'
              ? 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 shadow-[0_0_30px_rgba(99,102,241,0.8)] animate-spin'
              : 'bg-gradient-to-tr from-slate-700 via-slate-800 to-slate-900 shadow-lg border border-slate-600'
          }`}
          title="Tap to expand Insight Voice"
        >
          <Sparkles className={`w-6 h-6 text-white ${isActive ? 'animate-pulse' : ''}`} />
        </button>

        {/* Glowing ring around orb */}
        <div className={`absolute inset-[-6px] rounded-full pointer-events-none ${
          isActive ? 'border-2 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.6)] animate-ping' : ''
        }`} />

        {/* Mini transcript badge */}
        {transcript && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-slate-900/95 border border-cyan-500/40 text-[10px] text-cyan-300 font-medium max-w-[150px] truncate shadow-lg">
            {transcript}
          </div>
        )}

        {/* Action notice badge */}
        {actionNotice && (
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-emerald-900/95 border border-emerald-500/40 text-[10px] text-emerald-300 font-bold max-w-[180px] truncate shadow-lg">
            {actionNotice}
          </div>
        )}
      </div>
    );
  }

  // --- FULL EXPANDED MODAL ---
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setIsMinimized(true)}>
      <div
        className="relative sm:max-w-md w-[92vw] rounded-3xl p-0 overflow-hidden border border-cyan-500/30 shadow-[0_0_80px_rgba(6,182,212,0.3)] bg-slate-950/95 backdrop-blur-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="p-4 px-6 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
            <span className="font-extrabold text-sm tracking-wide bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
              INSIGHT VOICE
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
              onClick={() => setIsMinimized(true)}
              title="Minimize to floating star"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
              onClick={onClose}
              title="Close assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Central Orb */}
        <div className="p-6 py-8 flex flex-col items-center justify-center gap-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-fuchsia-500/10 to-indigo-500/10 blur-3xl pointer-events-none" />

          <div className="relative cursor-pointer group flex items-center justify-center" onClick={toggleListening} title="Tap to speak / stop">
            <div className={`absolute rounded-full transition-all duration-700 ${
              assistantState === 'listening' || assistantState === 'waiting'
                ? 'w-44 h-44 border-2 border-cyan-400/60 shadow-[0_0_40px_rgba(34,211,238,0.6)] animate-ping'
                : assistantState === 'speaking'
                ? 'w-44 h-44 border-2 border-fuchsia-400/60 shadow-[0_0_40px_rgba(232,121,249,0.6)] animate-pulse'
                : assistantState === 'thinking'
                ? 'w-44 h-44 border-2 border-indigo-400/60 shadow-[0_0_40px_rgba(129,140,248,0.6)] animate-spin'
                : 'w-36 h-36 border border-slate-700/50 shadow-none'
            }`} />

            <div className={`w-28 h-28 rounded-full flex items-center justify-center shadow-2xl relative z-10 transition-transform duration-300 group-hover:scale-105 ${
              assistantState === 'listening'
                ? 'bg-gradient-to-tr from-cyan-500 via-indigo-500 to-fuchsia-500 shadow-[0_0_50px_rgba(34,211,238,0.8)]'
                : assistantState === 'waiting'
                ? 'bg-gradient-to-tr from-emerald-500 via-cyan-500 to-indigo-500 shadow-[0_0_50px_rgba(16,185,129,0.8)]'
                : assistantState === 'speaking'
                ? 'bg-gradient-to-tr from-fuchsia-600 via-pink-500 to-indigo-500 shadow-[0_0_50px_rgba(236,72,153,0.8)]'
                : assistantState === 'thinking'
                ? 'bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-500 shadow-[0_0_50px_rgba(99,102,241,0.8)] animate-pulse'
                : 'bg-gradient-to-tr from-slate-800 via-slate-900 to-indigo-950 shadow-lg border border-slate-700'
            }`}>
              {assistantState === 'listening' ? <Mic className="w-10 h-10 text-white animate-bounce" />
                : assistantState === 'waiting' ? <Mic className="w-10 h-10 text-white animate-pulse" />
                : assistantState === 'speaking' ? <Volume2 className="w-10 h-10 text-white animate-pulse" />
                : assistantState === 'thinking' ? <Sparkles className="w-10 h-10 text-white animate-spin" />
                : <MicOff className="w-9 h-9 text-slate-400 group-hover:text-cyan-400 transition-colors" />}
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col items-center gap-2 text-center max-w-xs relative z-10">
            <span className={`px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md ${
              assistantState === 'listening' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse'
                : assistantState === 'waiting' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : assistantState === 'speaking' ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
                : assistantState === 'thinking' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
              {assistantState === 'listening' && '🎙️ Listening — Speak Now...'}
              {assistantState === 'waiting' && '✅ Ready — Say next command'}
              {assistantState === 'thinking' && '⚡ Executing...'}
              {assistantState === 'speaking' && '🔊 Speaking...'}
              {assistantState === 'idle' && 'Tap Orb to Activate'}
            </span>

            {transcript && (
              <div className="p-2.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 text-xs font-medium text-cyan-200 w-full">
                &quot;{transcript}&quot;
              </div>
            )}
            {spokenText && assistantState === 'speaking' && (
              <p className="text-xs text-fuchsia-200 leading-relaxed font-semibold italic">{spokenText}</p>
            )}
            {actionNotice && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold">
                <Zap className="w-3.5 h-3.5" />{actionNotice}
              </div>
            )}
            {!recognitionAvailable && (
              <p className="text-xs text-rose-400 bg-rose-950/50 p-2 rounded-lg border border-rose-800">
                Enable mic permissions or use Chrome/Safari/Edge.
              </p>
            )}
          </div>

          {/* Recent Commands */}
          {commandLog.length > 0 && (
            <div className="w-full pt-2 border-t border-slate-800/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center mb-1.5">Recent</p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {commandLog.map((cmd, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[10px] text-slate-400 truncate max-w-[140px]">{cmd}</span>
                ))}
              </div>
            </div>
          )}

          {/* Hint */}
          <p className="text-[10px] text-slate-500 text-center">
            Say &quot;Open YouTube&quot;, &quot;Send WhatsApp message Hello&quot;, &quot;Compose Gmail&quot;, &quot;Minimize&quot;, or &quot;Stop&quot;
          </p>
        </div>
      </div>
    </div>
  );
}
