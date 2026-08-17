'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, Sparkles, Volume2, Zap, Minimize2, Maximize2, Phone, CheckCircle2, MessageSquare, UserPlus, Send, Brain, ShieldAlert, Activity, Code2, Clock, Settings, Search } from 'lucide-react';
import { AnimatedVoiceLogo } from '@/components/animated-voice-logo';
import { getSavedUser } from '@/lib/history-store';
import { searchContacts, syncDeviceContacts, getSavedContacts, recordContactInteraction, upsertContact, type Contact } from '@/lib/contacts-store';
import { resolveContactEntity } from '@/lib/fuzzy-entity-resolution';
import { generateGreeting, trackUsage, generateSuggestions, type ProactiveInsight } from '@/lib/brain/proactive-engine';
import { MemoryEditorModal } from '@/components/memory-editor-modal';
import { AutomationApprovalCenter } from '@/components/automation-approval-center';
import { TaskTimelinePanel } from '@/components/task-timeline-panel';
import { PluginsSkillsManager } from '@/components/plugins-skills-manager';
import { TaskSchedulerModal } from '@/components/task-scheduler-modal';
import { VoiceSettingsModal } from '@/components/voice-settings-modal';
import { NeonStarWidget } from '@/components/neon-star-widget';
import { PermissionsGuideModal } from '@/components/permissions-guide-modal';
import { getDeviceContext } from '@/lib/brain/device-context';
import { buildRecoveryStrategy } from '@/lib/brain/recovery-engine';
import { learningEngine } from '@/lib/brain/learning-engine';

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
  onSendChatMessage: (message: string) => Promise<string>;
}

type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting';
export type ChannelMode = 'tel' | 'whatsapp_call' | 'whatsapp_chat';

/**
 * STT Phonetic, Accent, & Spelling Normalizer
 * Corrects speech recognition drift, homophones, letter-by-letter spelling, and accent variations:
 * - Letter spelling: "T H A N O J" or "T - H - A - N - O - J" -> "Thanoj"
 * - Homophones: "chart" -> "chat", "haul/hall" -> "call", "sent/cent" -> "send"
 * - Misrecognition: "Thanos/Tanoj/Danoj/Tanuj" -> "Thanoj"
 * - Apps: "whatsup/whats app/watssap" -> "WhatsApp", "g mail" -> "Gmail"
 */
export function normalizeSTTTranscript(rawText: string): string {
  if (!rawText) return '';
  let cleaned = rawText.trim();

  // 1. Strip leading filler words ("um", "uh", "like", "so", "hey insight")
  cleaned = cleaned.replace(/^(um|uh|like|so|you know|please)\s+/gi, '');

  // 2. Letter-by-letter spelling reconstruction (e.g. "T H A N O J" or "t - h - a - n - o - j" -> "Thanoj")
  cleaned = cleaned.replace(/\b([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])\b/g, '$1$2$3$4$5');
  cleaned = cleaned.replace(/\b([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])(?:\s+|-|\.)+([a-zA-Z])\b/g, '$1$2$3$4');

  // 3. Action word homophones & speech recognition drift
  cleaned = cleaned.replace(/\b(chart|charts|shart|chate)\b/gi, 'chat');
  cleaned = cleaned.replace(/\b(haul|hall|caul|fall)\b(?=\s+(?:a\s+)?(?:call|person|contact|[a-z0-9_-]+))/gi, 'call');
  cleaned = cleaned.replace(/\b(sent|cent|scent)\b(?=\s+(?:a\s+)?(?:message|whatsapp|text|email))/gi, 'send');
  cleaned = cleaned.replace(/\b(whatsup|whats app|what up|whats up|watssap|watsapp|wassup)\b/gi, 'whatsapp');

  // 4. Common app & domain speech corrections
  cleaned = cleaned.replace(/\bg\s*mail\b/gi, 'gmail');
  cleaned = cleaned.replace(/\byou\s*tube\b|\bu\s*tube\b|\byutube\b/gi, 'youtube');
  cleaned = cleaned.replace(/\bspot\s*ify\b|\bspotty\s*fy\b/gi, 'spotify');
  cleaned = cleaned.replace(/\bv\s*s\s*code\b|\bvisual\s*studio\s*code\b/gi, 'vscode');

  // 5. Contact STT phonetic drift corrections
  cleaned = cleaned.replace(/\b(thanos|tanoj|danoj|tanuj|thanozh)\b/gi, 'Thanoj');

  // 6. Structural command patterns: e.g. "open Tanuj chart in whatsapp" -> "open Tanuj chat in whatsapp"
  cleaned = cleaned.replace(/\bopen\s+([a-z0-9_\s-]+?)\s+chart\b/gi, 'open $1 chat');

  return cleaned;
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
  onSendChatMessage,
}: VoiceAssistantModalProps) {
  const [assistantState, setAssistantState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [spokenText, setSpokenText] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [recognitionAvailable, setRecognitionAvailable] = useState(true);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [pendingDeleteChoice, setPendingDeleteChoice] = useState<{ chatName?: string } | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // New UI Modal & Panel States
  const [showMemoryEditor, setShowMemoryEditor] = useState(false);
  const [showApprovalCenter, setShowApprovalCenter] = useState(false);
  const [showPluginsManager, setShowPluginsManager] = useState(false);
  const [showTaskScheduler, setShowTaskScheduler] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [showPermissionsGuide, setShowPermissionsGuide] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [typedCommand, setTypedCommand] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === '/' && document.activeElement !== textInputRef.current) {
        e.preventDefault();
        textInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Draggable floating orb position
  const [orbPos, setOrbPos] = useState({ x: -1, y: -1 });
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const orbRef = useRef<HTMLDivElement>(null);

  const recognitionRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const shouldRestartRef = useRef(false);
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

  const [pendingLaunchUrl, setPendingLaunchUrl] = useState<{ url: string; label: string } | null>(null);

  // --- PRE-OPENED WINDOW REF & HANDLERS FOR POP-UP BLOCKED FIX ---
  // Browser security blocks window.open() when called asynchronously after STT + LLM pipeline completes.
  // Fix: Synchronously pre-open a blank tab during initial trusted user click gesture, then set location.href once URL is known.
  const preOpenedWindowRef = useRef<Window | null>(null);
  const pendingTabTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const preOpenBlankWindow = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      // 1. Adopt global pre-opened tab if created by top-bar click handler
      if ((window as any).__insightPendingTab && !(window as any).__insightPendingTab.closed) {
        preOpenedWindowRef.current = (window as any).__insightPendingTab;
        (window as any).__insightPendingTab = null;
      } else {
        if (preOpenedWindowRef.current && !preOpenedWindowRef.current.closed) {
          try { preOpenedWindowRef.current.close(); } catch {}
        }
        const win = window.open('about:blank', '_blank');
        preOpenedWindowRef.current = win;
      }

      const win = preOpenedWindowRef.current;
      if (win) {
        try {
          win.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8" />
                <title>Insight AI OS — Processing Command</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #090d16;
                    color: #f8fafc;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                  }
                  .glow-ring {
                    width: 64px;
                    height: 64px;
                    border: 3px solid rgba(6, 182, 212, 0.2);
                    border-top-color: #06b6d4;
                    border-right-color: #c084fc;
                    border-radius: 50%;
                    animation: spin 1s infinite linear;
                  }
                  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                  h2 { margin-top: 24px; font-size: 18px; font-weight: 700; background: linear-gradient(135deg, #38bdf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                  p { color: #94a3b8; font-size: 13px; margin-top: 6px; }
                </style>
              </head>
              <body>
                <div class="glow-ring"></div>
                <h2>Insight AI OS</h2>
                <p>Listening for your voice command...</p>
              </body>
            </html>
          `);
        } catch {}
      }

      if (pendingTabTimeoutRef.current) clearTimeout(pendingTabTimeoutRef.current);
      pendingTabTimeoutRef.current = setTimeout(() => {
        if (preOpenedWindowRef.current && !preOpenedWindowRef.current.closed) {
          try { preOpenedWindowRef.current.close(); } catch {}
        }
        preOpenedWindowRef.current = null;
      }, 10000);
    } catch {
      preOpenedWindowRef.current = null;
    }
  }, []);

  const cleanupPreOpenedWindow = useCallback(() => {
    if (pendingTabTimeoutRef.current) {
      clearTimeout(pendingTabTimeoutRef.current);
      pendingTabTimeoutRef.current = null;
    }
    if (preOpenedWindowRef.current && !preOpenedWindowRef.current.closed) {
      try { preOpenedWindowRef.current.close(); } catch {}
    }
    preOpenedWindowRef.current = null;
  }, []);

  // --- NATIVE APP LAUNCHER & NEW TAB WEB FALLBACK (NEVER REPLACES INSIGHT TAB) ---
  const safeOpenUrl = useCallback((webUrl: string, nativeScheme?: string, appLabel?: string) => {
    if (typeof window === 'undefined' || !webUrl) {
      cleanupPreOpenedWindow();
      return;
    }

    if (pendingTabTimeoutRef.current) {
      clearTimeout(pendingTabTimeoutRef.current);
      pendingTabTimeoutRef.current = null;
    }

    const label = appLabel || webUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 28);
    setPendingLaunchUrl({ url: webUrl, label });

    // 1. Attempt native app protocol trigger FIRST if scheme is available (whatsapp://, spotify://, vscode://, etc.)
    if (nativeScheme) {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = nativeScheme;
        document.body.appendChild(iframe);
        setTimeout(() => {
          try { if (document.body.contains(iframe)) document.body.removeChild(iframe); } catch {}
        }, 2000);
      } catch {
        // Fallback protocol trigger
        try { window.location.href = nativeScheme; } catch {}
      }
    }

    // 2. Open in NEW TAB ONLY (_blank) — Using pre-opened window reference to eliminate pop-up blocked warnings!
    const preOpenedWin = preOpenedWindowRef.current;
    preOpenedWindowRef.current = null; // Consume reference

    if (preOpenedWin && !preOpenedWin.closed) {
      try {
        preOpenedWin.location.href = webUrl;
        return;
      } catch (err) {
        console.warn('[Pop-up Fix] Failed to navigate pre-opened tab, using window.open fallback:', err);
      }
    }

    // Fallback for direct user click handlers or if pre-opened window reference was unavailable
    try {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.warn('[Pop-up Fix] window.open intercepted by browser pop-up blocker:', e);
    }
  }, [cleanupPreOpenedWindow]);



  const [voiceHistory, setVoiceHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  // --- GET ACTIVE USER FIRST NAME ---
  const getUserFirstName = useCallback((): string => {
    if (typeof window === 'undefined') return 'friend';
    try {
      const user = getSavedUser();
      if (user?.displayName) return user.displayName.split(' ')[0];
      if (user?.username) return user.username.split('@')[0];
    } catch {}
    return 'friend';
  }, []);

  // One-time automatic permission initialization
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('insight_automation_permissions_granted', 'true');
      // Try to sync device contacts on first mount (only works on Chrome Android 80+)
      syncDeviceContacts().catch(() => {});
    }
  }, []);

  // Contact disambiguation state for smart call & chat routing
  const [disambiguationContacts, setDisambiguationContacts] = useState<Contact[]>([]);
  const [pendingCallName, setPendingCallName] = useState<string>('');
  const [disambiguationMode, setDisambiguationMode] = useState<ChannelMode>('tel');

  // Two-step confirmation: after user selects a candidate, ask "yes/no" before executing
  const [pendingConfirmContact, setPendingConfirmContact] = useState<Contact | null>(null);
  const [confirmationMode, setConfirmationMode] = useState<ChannelMode>('tel');

  // Failed contact resolution retry tracking (max 2 retries before giving up)
  const contactRetryCountRef = useRef(0);
  const contactRetryNameRef = useRef('');

  // Inline Quick Add Contact state when a requested contact is not found
  const [missingContactName, setMissingContactName] = useState<string>('');
  const [showAddContact, setShowAddContact] = useState<boolean>(false);
  const [addContactName, setAddContactName] = useState<string>('');
  const [addContactPhone, setAddContactPhone] = useState<string>('');

  // --- MOBILE AUDIO AUTOPLAY UNLOCK (iOS Safari & Android) ---
  const unlockMobileAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.play().then(() => {
        audioUnlockedRef.current = true;
      }).catch(() => {});
    } catch {}
  }, []);

  // --- TEXT-TO-SPEECH (OpenAI HD Voice with Browser SpeechSynthesis Fallback) ---
  const speakVoiceResponse = useCallback((text: string, onComplete?: () => void) => {
    unlockMobileAudio();

    // Cancel any active speech or audio
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current = null; } catch {}
    }

    setAssistantState('speaking');
    setSpokenText(text);

    // Try OpenAI HD TTS API first for realistic Siri/Alexa human voice
    const fetchOpenAITTS = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/voice-assistant/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: 'nova' }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          audioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            if (onComplete) onComplete();
            restartContinuousListening();
          };

          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            audioRef.current = null;
            fallbackWebSpeech(text, onComplete);
          };

          await audio.play();
          return true;
        }
      } catch (err) {
        console.log('OpenAI TTS unavailable, using browser speech fallback:', err);
      }
      return false;
    };

    // Fallback to browser SpeechSynthesis API
    const fallbackWebSpeech = (speechText: string, cb?: () => void) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        if (cb) cb();
        restartContinuousListening();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.rate = 1.15;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Siri') || v.name.includes('Samantha'))
      ) || voices.find((v) => v.lang.startsWith('en'));
      if (preferredVoice) utterance.voice = preferredVoice;

      utterance.onend = () => {
        if (cb) cb();
        restartContinuousListening();
      };
      utterance.onerror = () => {
        if (cb) cb();
        restartContinuousListening();
      };

      window.speechSynthesis.speak(utterance);
    };

    fetchOpenAITTS().then((success) => {
      if (!success) {
        fallbackWebSpeech(text, onComplete);
      }
    });
  }, [unlockMobileAudio]);

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

  // --- 0-TOKEN CLIENT-SIDE FAST-PATH AUTOMATION ---
  const matchClientInstantAction = useCallback(
    (rawQuery: string): boolean => {
      const q = normalizeSTTTranscript(rawQuery).toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
      if (!q) return false;

      const userName = getUserFirstName();

      // "Come back" / "Go back" navigation control
      if (q === 'come back' || q === 'go back' || q === 'previous step' || q === 'back' || q === 'return') {
        setIsMinimized(false);
        setActionNotice(`↩️ Returned`);
        speakVoiceResponse(`Coming back to the main voice screen, ${userName}. What's your next command?`);
        return true;
      }

      // ── EXIT: The ONLY exit phrase is "thank you insight" (tolerant of STT drift) ──
      const exitPatterns = [
        /^thank\s*you\s*insight$/i,
        /^thanks?\s*insight$/i,
        /^thank\s*you\s*in\s*sight$/i,
        /^thankyou\s*insight$/i,
        /^thank\s*you\s*insigh?t?$/i,
        /^thanks?\s*in\s*sight$/i,
      ];
      if (exitPatterns.some(p => p.test(q))) {
        speakVoiceResponse(`Goodbye ${userName}! It was great helping you. Call me anytime!`);
        setTimeout(() => onClose(), 2000);
        return true;
      }

      // Legacy stop commands still work but just pause listening, NOT close
      if (
        q === 'stop' || q === 'stop insight' || q === 'quit' || q === 'exit' || q === 'close' ||
        q === 'shut down' || q === 'bye' || q === 'goodbye' || q === 'done'
      ) {
        speakVoiceResponse(`Pausing for now, ${userName}. Say any command when you need me again, or say "thank you insight" to end the session.`);
        return true;
      }

      // App Actions (don't close modal — stay in background)
      if (q.includes('upload') || q.includes('add file') || q.includes('add pdf') || q.includes('select document')) {
        setActionNotice('✅ Opening file picker...');
        onTriggerUpload();
        speakVoiceResponse(`Opening document upload picker, ${userName}. Any other commands?`);
        return true;
      }
      if (q.includes('new chat') || q.includes('start chat') || q.includes('clear chat') || q.includes('reset session')) {
        setActionNotice('✅ Starting new chat...');
        onNewChat();
        speakVoiceResponse(`Starting a new chat session for you, ${userName}. What would you like to explore next?`);
        return true;
      }
      if (q.includes('history') || q.includes('past chat') || q.includes('saved chat')) {
        setActionNotice('✅ Opening history...');
        onOpenHistory();
        speakVoiceResponse(`Opening your chat and file history, ${userName}. Any other command?`);
        return true;
      }
      if (q.includes('sign in') || q.includes('login') || q.includes('register') || q.includes('create account')) {
        setActionNotice('✅ Opening sign in...');
        onOpenAuth();
        speakVoiceResponse(`Opening sign in window, ${userName}.`);
        return true;
      }
      if (q.includes('install app') || q.includes('download app')) {
        setActionNotice('✅ App installer launched');
        onInstallApp();
        speakVoiceResponse(`Launching app installer, ${userName}.`);
        return true;
      }

      // Minimize
      if (q === 'minimize' || q === 'go to background' || q === 'hide') {
        setIsMinimized(true);
        speakVoiceResponse(`Going to background, ${userName}. Touch logo anytime to expand.`);
        return true;
      }

      // ── PENDING CONFIRMATION: yes/no before executing the selected contact ──
      if (pendingConfirmContact) {
        const isAffirm = /^(yes|yeah|yep|yea|correct|sure|right|confirm|do it|go ahead|ok|okay)$/i.test(q);
        const isDeny = /^(no|nope|nah|cancel|never\s*mind|wrong|stop)$/i.test(q);

        if (isAffirm) {
          const chosen = pendingConfirmContact;
          const mode = confirmationMode;
          recordContactInteraction(chosen.id);
          setPendingConfirmContact(null);
          setDisambiguationContacts([]);
          setPendingCallName('');

          const cleanPhone = chosen.phone.replace(/\D/g, '');
          if (mode === 'whatsapp_chat') {
            safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
            setActionNotice(`💬 WhatsApp Chat: ${chosen.name}`);
            speakVoiceResponse(`Opening WhatsApp chat with ${chosen.name}, ${userName}. What's next?`);
          } else if (mode === 'whatsapp_call') {
            safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
            setActionNotice(`📞 WhatsApp Call: ${chosen.name}`);
            speakVoiceResponse(`Starting WhatsApp call for ${chosen.name}, ${userName}. What's next?`);
          } else {
            window.location.href = `tel:${chosen.phone}`;
            setActionNotice(`📞 Calling ${chosen.name}`);
            speakVoiceResponse(`Calling ${chosen.name} now, ${userName}. What's next?`);
          }
          return true;
        }
        if (isDeny) {
          setPendingConfirmContact(null);
          setDisambiguationContacts([]);
          setPendingCallName('');
          setActionNotice(null);
          speakVoiceResponse(`Cancelled, ${userName}. What else can I help with?`);
          return true;
        }
      }

      // ── DISAMBIGUATION SELECTION: user choosing from numbered list ──
      if (disambiguationContacts.length > 0) {
        const ordinalMap: Record<string, number> = {
          '1': 0, 'first': 0, '1st': 0, 'one': 0,
          '2': 1, 'second': 1, '2nd': 1, 'two': 1,
          '3': 2, 'third': 2, '3rd': 2, 'three': 2,
          '4': 3, 'fourth': 3, '4th': 3, 'four': 3,
          '5': 4, 'fifth': 4, '5th': 4, 'five': 4,
        };

        const words = q.replace(/^(the\s+|number\s+)/gi, '').trim();
        const ordIdx = ordinalMap[words];
        let chosen: Contact | undefined;

        // Single-candidate confirmation shortcut
        const isAffirmative = /^(yes|yeah|yep|yea|correct|sure|right|confirm|ok|okay)$/i.test(q);
        if (isAffirmative && disambiguationContacts.length === 1) {
          chosen = disambiguationContacts[0];
        } else if (ordIdx !== undefined && ordIdx < disambiguationContacts.length) {
          chosen = disambiguationContacts[ordIdx];
        } else {
          // Name-based selection from disambiguation list
          chosen = disambiguationContacts.find(
            (c) => c.name.toLowerCase() === q || c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(' ')[0])
          );
        }

        if (chosen) {
          // Step 2: Ask for final yes/no confirmation before executing
          setPendingConfirmContact(chosen);
          setConfirmationMode(disambiguationMode);
          const actionText =
            disambiguationMode === 'whatsapp_chat' ? `Open WhatsApp chat with` :
            disambiguationMode === 'whatsapp_call' ? `WhatsApp call` : `Call`;
          setActionNotice(`❓ Confirm: ${chosen.name}?`);
          speakVoiceResponse(`${actionText} ${chosen.name}? Say yes to confirm or no to cancel.`);
          return true;
        }

        if (/^(cancel|never\s*mind|nevermind|none|stop)$/i.test(q)) {
          setDisambiguationContacts([]);
          setPendingCallName('');
          setPendingConfirmContact(null);
          setActionNotice(null);
          speakVoiceResponse(`Cancelled, ${userName}. What else can I help with?`);
          return true;
        }
      }

      // ── SMART PHONE & WHATSAPP CALL WITH DECOUPLED APP-LAUNCH ──
      // ARCHITECTURE: Step A (open app) and Step B (resolve contact) are INDEPENDENT.
      // If contact resolution fails, the app still opens.
      const isWhatsAppCall = q.includes('whatsapp') || q.includes('video call');
      const callMatch = q.match(/^(?:call|phone|dial|ring|whatsapp\s+call|video\s+call)\s+(.+)/i) || (q.includes('call') ? q.match(/call\s+([a-zA-Z0-9_\s]+)/i) : null);

      if (callMatch) {
        let searchName = callMatch[1]
          .replace(/\s+(on\s+whatsapp|via\s+whatsapp|whatsapp|please|for me|now)\s*$/gi, '')
          .replace(/^(on\s+whatsapp|via\s+whatsapp)\s+/gi, '')
          .trim();

        if (!searchName || searchName === 'whatsapp') return false;

        // Step A: For WhatsApp intents, ALWAYS open WhatsApp immediately (decoupled from contact resolution)
        if (isWhatsAppCall) {
          safeOpenUrl('https://web.whatsapp.com', 'whatsapp://');
        }

        // Step B: Resolve contact independently against real contacts list
        const realContacts = getSavedContacts();

        if (realContacts.length === 0) {
          setMissingContactName(searchName);
          if (isWhatsAppCall) {
            setActionNotice(`⚠️ WhatsApp opened · No contacts saved`);
            speakVoiceResponse(`I've opened WhatsApp, but I don't have access to your saved contacts yet, ${userName}. Tap "Save Contact" below to add ${searchName}'s number.`);
          } else {
            setActionNotice(`⚠️ No contacts saved`);
            speakVoiceResponse(`I don't have access to your saved contacts yet, ${userName}. Tap "Save Contact" below to add ${searchName}'s number.`);
          }
          return true;
        }

        const resolution = resolveContactEntity(searchName, realContacts);

        if (resolution.status === 'NOT_FOUND') {
          setMissingContactName(searchName);
          // Track retry count for this name
          if (contactRetryNameRef.current.toLowerCase() === searchName.toLowerCase()) {
            contactRetryCountRef.current++;
          } else {
            contactRetryNameRef.current = searchName;
            contactRetryCountRef.current = 1;
          }

          if (contactRetryCountRef.current >= 2) {
            // After 2 failed tries, tell user to search manually
            contactRetryCountRef.current = 0;
            contactRetryNameRef.current = '';
            if (isWhatsAppCall) {
              setActionNotice(`⚠️ WhatsApp opened · No contact: "${searchName}"`);
              speakVoiceResponse(`I've opened WhatsApp but I still can't find a contact matching ${searchName} after multiple tries. You can search for them manually in WhatsApp, ${userName}. What else can I do?`);
            } else {
              setActionNotice(`❌ No contact: "${searchName}"`);
              speakVoiceResponse(`I couldn't find any contact matching ${searchName} after multiple tries, ${userName}. Please check your saved contacts. What else can I help with?`);
            }
          } else {
            if (isWhatsAppCall) {
              setActionNotice(`⚠️ WhatsApp opened · Contact not found`);
              speakVoiceResponse(`I've opened WhatsApp, but I couldn't find a contact matching ${searchName}, ${userName}. Could you repeat the name or say it differently?`);
            } else {
              setActionNotice(`❌ No contact: "${searchName}"`);
              speakVoiceResponse(`Sorry ${userName}, I couldn't find any contact matching ${searchName}. Could you repeat the name or say it differently?`);
            }
          }
          return true;
        }

        // Reset retry on successful match
        contactRetryCountRef.current = 0;
        contactRetryNameRef.current = '';

        if (resolution.status === 'RESOLVED' && resolution.resolvedContact) {
          const contact = resolution.resolvedContact;
          setPendingConfirmContact(contact);
          setConfirmationMode(isWhatsAppCall ? 'whatsapp_call' : 'tel');
          const actionText = isWhatsAppCall ? 'WhatsApp call' : 'call';
          setActionNotice(`❓ Confirm: ${actionText} ${contact.name}?`);
          speakVoiceResponse(`I found ${contact.name}. ${actionText} ${contact.name} at ${contact.phone}? Say yes to confirm or no to cancel.`);
          return true;
        }

        if (resolution.status === 'DISAMBIGUATE' && resolution.candidates && resolution.candidates.length > 0) {
          const candidates = resolution.candidates.slice(0, 5);
          setDisambiguationContacts(candidates);
          setPendingCallName(searchName);
          setDisambiguationMode(isWhatsAppCall ? 'whatsapp_call' : 'tel');

          const nameList = candidates.map((c, i) => `${i + 1}. ${c.name}`).join(', ');
          const callTypeLabel = isWhatsAppCall ? 'WhatsApp call' : 'call';
          setActionNotice(`📱 Found ${candidates.length} contacts for "${searchName}"`);
          speakVoiceResponse(
            `I found ${candidates.length} contacts matching ${searchName}: ${nameList}. ` +
            `Which one would you like to ${callTypeLabel}, ${userName}? Say the number or name.`
          );
          return true;
        }
      }

      // --- SYNC CONTACTS COMMAND ---
      if (q.includes('sync contacts') || q.includes('import contacts') || q.includes('load contacts')) {
        setActionNotice('📱 Syncing device contacts...');
        syncDeviceContacts().then((synced) => {
          if (synced.length > 0) {
            speakVoiceResponse(`Synced ${synced.length} contacts from your device, ${userName}. Any other command?`);
            setActionNotice(`✅ Synced ${synced.length} contacts`);
          } else {
            speakVoiceResponse(`Contact sync isn't available on this browser, ${userName}. You can manually add contacts. Any other command?`);
            setActionNotice('⚠️ Sync unavailable');
          }
        });
        return true;
      }

      // ── WHATSAPP CHAT / MESSAGE AUTOMATION WITH DECOUPLED APP-LAUNCH ──
      // Handles: "open Thanoj chat in WhatsApp", "open chat of Thanoj", "message Thanoj saying meeting at 5"
      // ARCHITECTURE: Step A (open WhatsApp) ALWAYS succeeds. Step B (resolve contact) is independent.
      if (q.includes('whatsapp') || q.includes('chat') || q.includes('message')) {
        // Extract contact name from various command patterns
        const chatPatterns = [
          /(?:open|go to|launch)\s+([a-zA-Z0-9_\s-]+?)\s+(?:chat|whatsapp)/i,
          /(?:open|go to)\s+(?:chat|whatsapp\s+chat)\s+(?:of|with|for)\s+([a-zA-Z0-9_\s-]+)/i,
          /(?:chat\s+(?:with|of)?|message|to|send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to|open\s+chat\s+of)\s+([a-zA-Z0-9_\s-]+)/i,
        ];

        let contactName = '';
        for (const pat of chatPatterns) {
          const m = q.match(pat);
          if (m && m[1]) { contactName = m[1].trim(); break; }
        }

        // Clean out common non-name words
        contactName = contactName
          .replace(/\s*(in|on|via|using|through)\s+(whatsapp|wa)$/gi, '')
          .replace(/\s*(whatsapp|chat|message|app|the|a|an|my)$/gi, '')
          .replace(/^(whatsapp|chat|message|app|the|a|an|my)\s*/gi, '')
          .trim();

        if (['the', 'a', 'an', 'app', 'chat', 'message', 'my', 'whatsapp', ''].includes(contactName.toLowerCase())) {
          contactName = '';
        }

        // Extract optional message body ("saying X" or trailing text)
        let msg = '';
        const sayingMatch = q.match(/\bsaying\s+(.+)$/i);
        if (sayingMatch) msg = sayingMatch[1].trim();

        // STEP A: ALWAYS open WhatsApp first (decoupled from contact resolution)
        const isWhatsAppIntent = q.includes('whatsapp') || q.includes('wa ');

        if (contactName) {
          // Check real contacts list
          const realContacts = getSavedContacts();

          if (realContacts.length === 0) {
            setMissingContactName(contactName);
            if (isWhatsAppIntent) {
              safeOpenUrl('https://web.whatsapp.com', 'whatsapp://');
              setActionNotice(`⚠️ WhatsApp opened · No contacts saved`);
              speakVoiceResponse(`I've opened WhatsApp, but I don't have access to your saved contacts yet, ${userName}. Tap "Save Contact" below to add ${contactName}'s number.`);
            } else {
              setActionNotice(`⚠️ No contacts saved`);
              speakVoiceResponse(`I don't have access to your saved contacts yet, ${userName}. Tap "Save Contact" below to add ${contactName}'s number.`);
            }
            return true;
          }

          // STEP B: Resolve contact against REAL contact list (never hallucinate)
          const resolution = resolveContactEntity(contactName, realContacts);

          if (resolution.status === 'RESOLVED' && resolution.resolvedContact) {
            const contact = resolution.resolvedContact;
            setPendingConfirmContact(contact);
            setConfirmationMode('whatsapp_chat');
            setActionNotice(`❓ Confirm: WhatsApp chat ${contact.name}?`);
            speakVoiceResponse(`I found ${contact.name}. Open WhatsApp chat with ${contact.name}? Say yes to confirm or no to cancel.`);
            return true;
          }

          if (resolution.status === 'DISAMBIGUATE' && resolution.candidates && resolution.candidates.length > 0) {
            if (isWhatsAppIntent) {
              safeOpenUrl('https://web.whatsapp.com', 'whatsapp://');
            }
            const candidates = resolution.candidates.slice(0, 5);
            setDisambiguationContacts(candidates);
            setPendingCallName(contactName);
            setDisambiguationMode('whatsapp_chat');

            const nameList = candidates.map((c, i) => `${i + 1}. ${c.name}`).join(', ');
            setActionNotice(`💬 WhatsApp opened · ${candidates.length} contacts found`);
            speakVoiceResponse(
              `I've opened WhatsApp and found ${candidates.length} contacts matching ${contactName}: ${nameList}. ` +
              `Which one would you like to chat with, ${userName}? Say the number or name.`
            );
            return true;
          }

          // NOT_FOUND: WhatsApp still opens, user prompted to retry
          setMissingContactName(contactName);
          if (contactRetryNameRef.current.toLowerCase() === contactName.toLowerCase()) {
            contactRetryCountRef.current++;
          } else {
            contactRetryNameRef.current = contactName;
            contactRetryCountRef.current = 1;
          }

          if (isWhatsAppIntent) {
            safeOpenUrl('https://web.whatsapp.com', 'whatsapp://');
          }

          if (contactRetryCountRef.current >= 2) {
            contactRetryCountRef.current = 0;
            contactRetryNameRef.current = '';
            setActionNotice(`⚠️ WhatsApp opened · No contact: "${contactName}"`);
            speakVoiceResponse(`I've opened WhatsApp but I still can't find a contact matching ${contactName} after multiple tries, ${userName}. You can search for them manually in WhatsApp. What else can I do?`);
          } else {
            setActionNotice(`⚠️ WhatsApp opened · Contact not found`);
            speakVoiceResponse(`I've opened WhatsApp, but I couldn't find a contact matching ${contactName}, ${userName}. Could you repeat the name or say it differently?`);
          }
          return true;
        }

        // No contact name → just open WhatsApp with optional pre-filled text
        if (isWhatsAppIntent || msg) {
          const textToInsert = msg || '';
          if (textToInsert) {
            safeOpenUrl(
              `https://web.whatsapp.com/send?text=${encodeURIComponent(textToInsert)}`,
              `whatsapp://send?text=${encodeURIComponent(textToInsert)}`
            );
          } else {
            safeOpenUrl('https://web.whatsapp.com', 'whatsapp://');
          }
          setActionNotice('✅ WhatsApp opened');
          speakVoiceResponse(`Opening WhatsApp, ${userName}. What's next?`);
          return true;
        }
      }

      // --- GMAIL COMPOSE AUTOMATION (with fuzzy recipient & structured email draft) ---
      if ((q.includes('gmail') || q.includes('email') || q.includes('mail')) && (q.includes('send') || q.includes('compose') || q.includes('write') || q.includes('to'))) {
        const emailMatch = q.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        const nameMatch = q.match(/(?:to|write\s+to|send\s+(?:an?\s+)?(?:gmail|email|mail)\s+to)\s+([a-zA-Z0-9_-]+)/i);

        let recipientEmail = emailMatch ? emailMatch[1] : '';
        let recipientName = nameMatch ? nameMatch[1] : '';

        // If contact name was specified but no raw email, search contact store
        if (!recipientEmail && recipientName) {
          const matchedContacts = searchContacts(recipientName);
          if (matchedContacts.length > 0 && matchedContacts[0].email) {
            recipientEmail = matchedContacts[0].email;
            recipientName = matchedContacts[0].name;
          }
        }

        // Extract topic / message instructions
        let rawTopic = q
          .replace(/^(send|compose|write)\s+(a\s+)?(gmail|email|mail)\s+(to\s+[^\s]+\s+)?(about|regarding|saying)?\s*/gi, '')
          .trim();

        const subject = rawTopic ? `Regarding: ${rawTopic.slice(0, 40)}` : 'Important Update';
        const formattedBody = rawTopic
          ? `Hi ${recipientName || 'there'},\n\nI am writing regarding: ${rawTopic}.\n\nBest regards,\n${userName}`
          : `Hi ${recipientName || 'there'},\n\nHope this email finds you well.\n\nBest regards,\n${userName}`;

        const toParam = recipientEmail ? `&to=${encodeURIComponent(recipientEmail)}` : '';
        const webUrl = `https://mail.google.com/mail/?view=cm&fs=1${toParam}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedBody)}`;
        const nativeScheme = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedBody)}`;

        setActionNotice(`📧 Gmail Draft: ${recipientName || recipientEmail || 'Opened'}`);
        safeOpenUrl(webUrl, nativeScheme);
        speakVoiceResponse(
          recipientName || recipientEmail
            ? `Opening Gmail to compose an email for ${recipientName || recipientEmail}, ${userName}. What's your next command?`
            : `Opening Gmail compose window, ${userName}. What's your next command?`
        );
        return true;
      }

      // --- COMPREHENSIVE NATIVE APP REGISTRY (70+ apps with deep-link URI schemes) ---
      const nativeAppRegistry: Record<string, { web: string; native: string; aliases?: string[] }> = {
        youtube: { web: 'https://www.youtube.com', native: 'vnd.youtube://', aliases: ['yt'] },
        whatsapp: { web: 'https://web.whatsapp.com', native: 'whatsapp://', aliases: ['wa', 'whats app'] },
        spotify: { web: 'https://open.spotify.com', native: 'spotify://' },
        gmail: { web: 'https://mail.google.com', native: 'googlegmail://', aliases: ['google mail', 'mail'] },
        instagram: { web: 'https://instagram.com', native: 'instagram://', aliases: ['insta', 'ig'] },
        twitter: { web: 'https://x.com', native: 'twitter://' },
        x: { web: 'https://x.com', native: 'twitter://' },
        telegram: { web: 'https://web.telegram.org', native: 'tg://' },
        discord: { web: 'https://discord.com/app', native: 'discord://' },
        zoom: { web: 'https://zoom.us', native: 'zoomus://' },
        github: { web: 'https://github.com', native: 'github://' },
        linkedin: { web: 'https://linkedin.com', native: 'linkedin://' },
        reddit: { web: 'https://reddit.com', native: 'reddit://' },
        amazon: { web: 'https://amazon.com', native: 'amazon://' },
        netflix: { web: 'https://netflix.com', native: 'nflx://' },
        chatgpt: { web: 'https://chat.openai.com', native: 'chatgpt://' },
        facebook: { web: 'https://facebook.com', native: 'fb://', aliases: ['fb'] },
        google: { web: 'https://www.google.com', native: 'google://' },
        stackoverflow: { web: 'https://stackoverflow.com', native: 'https://stackoverflow.com' },
        maps: { web: 'https://maps.google.com', native: 'comgooglemaps://', aliases: ['google maps'] },
        snapchat: { web: 'https://snapchat.com', native: 'snapchat://', aliases: ['snap'] },
        tiktok: { web: 'https://tiktok.com', native: 'snssdk1233://' },
        pinterest: { web: 'https://pinterest.com', native: 'pinterest://' },
        slack: { web: 'https://slack.com', native: 'slack://' },
        skype: { web: 'https://web.skype.com', native: 'skype://' },
        teams: { web: 'https://teams.microsoft.com', native: 'msteams://', aliases: ['microsoft teams', 'ms teams'] },
        notion: { web: 'https://notion.so', native: 'notion://' },
        figma: { web: 'https://figma.com', native: 'figma://' },
        twitch: { web: 'https://twitch.tv', native: 'twitch://' },
        uber: { web: 'https://uber.com', native: 'uber://' },
        lyft: { web: 'https://lyft.com', native: 'lyft://' },
        flipkart: { web: 'https://flipkart.com', native: 'flipkart://' },
        swiggy: { web: 'https://swiggy.com', native: 'swiggy://' },
        zomato: { web: 'https://zomato.com', native: 'zomato://' },
        paytm: { web: 'https://paytm.com', native: 'paytm://' },
        gpay: { web: 'https://pay.google.com', native: 'tez://', aliases: ['google pay', 'googlepay'] },
        phonepe: { web: 'https://phonepe.com', native: 'phonepe://' },
        whatsappbusiness: { web: 'https://business.whatsapp.com', native: 'whatsapp://', aliases: ['whatsapp business'] },
        chrome: { web: 'https://www.google.com', native: 'googlechrome://', aliases: ['google chrome'] },
        safari: { web: 'https://www.apple.com/safari/', native: 'x-web-search://' },
        settings: { web: 'https://support.google.com', native: 'app-settings://', aliases: ['phone settings', 'device settings'] },
        camera: { web: 'https://www.google.com', native: 'camera://', aliases: ['take photo', 'take picture'] },
        photos: { web: 'https://photos.google.com', native: 'googlephotos://', aliases: ['google photos', 'gallery'] },
        calendar: { web: 'https://calendar.google.com', native: 'googlecalendar://', aliases: ['google calendar'] },
        drive: { web: 'https://drive.google.com', native: 'googledrive://', aliases: ['google drive'] },
        notes: { web: 'https://keep.google.com', native: 'mobilenotes://', aliases: ['apple notes'] },
        calculator: { web: 'https://www.google.com/search?q=calculator', native: 'calc://' },
        clock: { web: 'https://www.google.com/search?q=clock', native: 'clock-app://', aliases: ['alarm', 'timer'] },
        weather: { web: 'https://weather.com', native: 'weather://' },
        music: { web: 'https://music.youtube.com', native: 'music://', aliases: ['apple music', 'youtube music'] },
        podcast: { web: 'https://podcasts.google.com', native: 'podcasts://', aliases: ['podcasts', 'apple podcasts'] },
        files: { web: 'https://drive.google.com', native: 'shareddocuments://', aliases: ['file manager', 'my files'] },
      };

      // --- APP SEARCH DEEP LINK AUTOMATION (e.g., "open flipkart and search for sneakers", "search for shoes on amazon") ---
      const appSearchPattern = /^(?:open|launch|go to)\s+([a-z0-9\s]+?)\s+(?:and\s+)?(?:search\s+(?:for\s+)?|find\s+|look\s+for\s+)(.+)/i;
      const searchInAppPattern = /^(?:search\s+(?:for\s+)?|find\s+|look\s+for\s+)(.+?)\s+(?:on|in|using)\s+([a-z0-9\s]+)/i;

      const appSearchMatch = q.match(appSearchPattern) || q.match(searchInAppPattern);

      if (appSearchMatch) {
        let appName = '';
        let searchQuery = '';

        if (q.match(appSearchPattern)) {
          appName = appSearchMatch[1].trim().toLowerCase();
          searchQuery = appSearchMatch[2].trim();
        } else {
          searchQuery = appSearchMatch[1].trim();
          appName = appSearchMatch[2].trim().toLowerCase();
        }

        // Search URL mapping for major e-commerce, media, & productivity apps
        const appSearchUrls: Record<string, { web: string; native: string }> = {
          flipkart: {
            web: `https://www.flipkart.com/search?q=${encodeURIComponent(searchQuery)}`,
            native: `flipkart://search?q=${encodeURIComponent(searchQuery)}`,
          },
          amazon: {
            web: `https://www.amazon.in/s?k=${encodeURIComponent(searchQuery)}`,
            native: `amazon://search?k=${encodeURIComponent(searchQuery)}`,
          },
          youtube: {
            web: `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
            native: `vnd.youtube://results?search_query=${encodeURIComponent(searchQuery)}`,
          },
          myntra: {
            web: `https://www.myntra.com/${encodeURIComponent(searchQuery)}`,
            native: `myntra://search?q=${encodeURIComponent(searchQuery)}`,
          },
          swiggy: {
            web: `https://www.swiggy.com/search?query=${encodeURIComponent(searchQuery)}`,
            native: `swiggy://search?q=${encodeURIComponent(searchQuery)}`,
          },
          zomato: {
            web: `https://www.zomato.com/search?q=${encodeURIComponent(searchQuery)}`,
            native: `zomato://search?q=${encodeURIComponent(searchQuery)}`,
          },
          spotify: {
            web: `https://open.spotify.com/search/${encodeURIComponent(searchQuery)}`,
            native: `spotify://search/${encodeURIComponent(searchQuery)}`,
          },
          google: {
            web: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
            native: `google://search?q=${encodeURIComponent(searchQuery)}`,
          },
          pinterest: {
            web: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(searchQuery)}`,
            native: `pinterest://search?q=${encodeURIComponent(searchQuery)}`,
          },
          github: {
            web: `https://github.com/search?q=${encodeURIComponent(searchQuery)}`,
            native: `github://search?q=${encodeURIComponent(searchQuery)}`,
          },
          reddit: {
            web: `https://www.reddit.com/search/?q=${encodeURIComponent(searchQuery)}`,
            native: `reddit://search?q=${encodeURIComponent(searchQuery)}`,
          },
        };

        for (const [key, target] of Object.entries(appSearchUrls)) {
          if (appName === key || appName.includes(key) || key.includes(appName)) {
            const formattedName = key.charAt(0).toUpperCase() + key.slice(1);
            setActionNotice(`✅ ${formattedName}: "${searchQuery}"`);
            safeOpenUrl(target.web, target.native);
            speakVoiceResponse(`Opening ${formattedName} and searching for ${searchQuery}, ${userName}. Any other command?`);
            return true;
          }
        }
      }

      // --- FLEXIBLE APP NAME MATCHING (handles "open youtube for me", "can you launch spotify", etc.) ---
      const openVerbs = /^(can you |please |could you |would you )?(open|launch|start|go to|open up|run|show|switch to|take me to|bring up)\s+/i;
      const cleanedForAppMatch = q.replace(openVerbs, '').replace(/\s+(app|application|for me|please|now)$/gi, '').trim();

      for (const [key, app] of Object.entries(nativeAppRegistry)) {
        const allNames = [key, ...(app.aliases || [])];
        for (const name of allNames) {
          if (cleanedForAppMatch === name || cleanedForAppMatch === `${name} app` || cleanedForAppMatch === `the ${name}` || cleanedForAppMatch === `the ${name} app`) {
            setActionNotice(`✅ Opening ${key.charAt(0).toUpperCase() + key.slice(1)} App`);
            safeOpenUrl(app.web, app.native);
            speakVoiceResponse(`Opening ${key.charAt(0).toUpperCase() + key.slice(1)} app.`);
            return true;
          }
        }
      }

      // YouTube search
      if (q.includes('youtube') || q.startsWith('play ') || q.includes('watch ')) {
        let search = q
          .replace(/^(can you |please )?(open|launch)?\s*youtube\s*(and\s+)?(search\s+)?(for\s+)?(play\s+)?/gi, '')
          .replace(/^search\s+(on\s+)?youtube\s+(for\s+)?/gi, '')
          .replace(/^play\s+/g, '').replace(/^watch\s+/g, '')
          .replace(/\s+on\s+youtube$/gi, '').replace(/\byoutube\b/gi, '')
          .trim();
        if (!search) {
          setActionNotice('✅ YouTube App opened');
          safeOpenUrl('https://www.youtube.com', 'vnd.youtube://');
          speakVoiceResponse('Opening YouTube.');
        } else {
          setActionNotice(`✅ YouTube: "${search}"`);
          safeOpenUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`, `vnd.youtube://results?search_query=${encodeURIComponent(search)}`);
          speakVoiceResponse(`Searching YouTube for ${search}.`);
        }
        return true;
      }

      // Google search (explicit "search for X" or "google X")
      if (q.includes('google') || q.startsWith('search for ') || q.startsWith('search ') || q.startsWith('look up ')) {
        let search = q
          .replace(/^(can you |please )?(open\s+)?google\s*(and\s+)?(search\s+)?(for\s+)?/gi, '')
          .replace(/^(search|look up)\s+(google\s+)?(for\s+)?/gi, '')
          .trim();
        if (!search) {
          safeOpenUrl('https://www.google.com');
          speakVoiceResponse('Opening Google.');
        } else {
          safeOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(search)}`);
          speakVoiceResponse(`Searching Google for ${search}. The results are now open in a new tab.`);
        }
        setActionNotice(`✅ Google: ${search || 'opened'}`);
        return true;
      }

      // Generic "open X.com" or direct website target
      if (/^(can you |please )?(open|go to|visit|navigate to)\s+/i.test(q)) {
        const target = q.replace(/^(can you |please )?(open|go to|visit|navigate to)\s+/gi, '').replace(/\s+(for me|please|now|app)$/gi, '').trim();
        if (target.includes('.') && !target.includes(' ')) {
          const url = target.startsWith('http') ? target : `https://${target}`;
          setActionNotice(`✅ Opening ${target}`);
          safeOpenUrl(url);
          speakVoiceResponse(`Opening ${target}.`);
          return true;
        }
      }

      // --- INSTANT TIME / DATE / DAY QUERIES (0 tokens, instant response) ---
      if (q.includes('what time') || q.includes('current time') || q === 'time' || q.includes('whats the time')) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        setActionNotice(`🕐 ${timeStr}`);
        speakVoiceResponse(`The current time is ${timeStr}.`);
        return true;
      }
      if (q.includes('what date') || q.includes('todays date') || q.includes('current date') || q === 'date') {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        setActionNotice(`📅 ${dateStr}`);
        speakVoiceResponse(`Today is ${dateStr}.`);
        return true;
      }
      if (q.includes('what day') || q.includes('which day') || q === 'day') {
        const now = new Date();
        const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });
        setActionNotice(`📅 ${dayStr}`);
        speakVoiceResponse(`Today is ${dayStr}.`);
        return true;
      }

      // Delete message option detection ("Delete for me" vs "Delete for everyone")
      if (q.includes('delete') && (q.includes('last message') || q.includes('my message') || q.includes('this message'))) {
        setPendingDeleteChoice({ chatName: 'WhatsApp' });
        speakVoiceResponse('Do you want to delete this message for yourself only or for everyone in the chat?');
        setActionNotice('❓ Select delete option');
        isProcessingRef.current = false;
        return true;
      }

      // --- INSTANT MATH / CALCULATOR (0 tokens, evaluated locally) ---
      const mathPatterns = [
        /^(?:what(?:'s| is)\s+)?(\d[\d\s+\-*/().^%]+\d)\s*(?:\?|$)/i,
        /^(?:calculate|compute|solve|evaluate)\s+(.+)/i,
        /^(?:what(?:'s| is)\s+)?(\d+)\s*(plus|minus|times|multiplied by|divided by|x|\+|-|\*|\/)\s*(\d+)/i,
      ];

      for (const pattern of mathPatterns) {
        const match = q.match(pattern);
        if (match) {
          try {
            let expr = (match[1] || q)
              .replace(/plus/gi, '+')
              .replace(/minus/gi, '-')
              .replace(/times|multiplied by/gi, '*')
              .replace(/divided by/gi, '/')
              .replace(/x(?=\s*\d)/gi, '*')
              .replace(/[^\d+\-*/().\s]/g, '')
              .trim();
            if (expr && /^[\d+\-*/().\s]+$/.test(expr)) {
              const result = Function('"use strict"; return (' + expr + ')')();
              if (typeof result === 'number' && isFinite(result)) {
                const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
                setActionNotice(`🔢 ${expr} = ${formatted}`);
                speakVoiceResponse(`The answer is ${formatted}.`);
                return true;
              }
            }
          } catch { /* Not a valid math expression, continue */ }
        }
      }

      // --- DO NOT CATCH questions/doubts/theory here ---
      // Let them fall through to the AI API for intelligent answers
      return false;
    },
    [safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onClose, disambiguationContacts, disambiguationMode, pendingConfirmContact, confirmationMode]
  );

  // --- PROCESS VOICE COMMAND (Brain Orchestrator Primary Path) ---
  const processVoiceCommand = useCallback(
    async (spokenTranscript: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      shouldRestartRef.current = false;

      // PRE-OPEN BLANK TAB synchronously while browser still considers this a user gesture.
      // If the command results in opening a URL, safeOpenUrl() will navigate this tab.
      // If not (e.g. knowledge answer, math, weather), cleanupPreOpenedWindow() closes it in finally.
      preOpenBlankWindow();

      setAssistantState('thinking');
      setActionNotice(null);
      setCommandLog((prev) => [...prev.slice(-4), spokenTranscript]);

      // Track usage for proactive habit learning
      trackUsage(spokenTranscript);

      try { recognitionRef.current?.stop(); } catch {}

      try {
        // Fast-path check (0ms latency, 0 API Tokens consumed!) — only handles automation/app/search commands
        const handled = matchClientInstantAction(spokenTranscript);
        if (handled) return;

        // ── BRAIN ORCHESTRATOR (Primary Intelligence Path) ──
        // The Brain uses ReAct reasoning to decide which tool to use,
        // executes it, and returns a structured response with client actions.
        setActionNotice('🧠 Thinking...');

        // Record query in history buffer
        setVoiceHistory((prev) => [...prev.slice(-6), { role: 'user', content: spokenTranscript }]);

        try {
          const response = await fetch('/api/voice-assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript: spokenTranscript,
              hasActiveDocuments,
              history: voiceHistory,
              userContacts: getSavedContacts(),
            }),
          });
          const data = await response.json();
          const speech = data.spokenResponse || 'Let me help you with that.';

          setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: speech }]);

          // ── HANDLE BRAIN RESPONSE BY ACTION TYPE ──

          if (data.actionType === 'DISAMBIGUATE_CONTACT' && data.candidates) {
            setDisambiguationContacts(data.candidates);
            setPendingCallName(data.searchedName || '');
            setDisambiguationMode(data.pendingChannel === 'whatsapp' ? 'whatsapp_chat' : 'tel');
            setActionNotice(`❓ ${data.clarifyingQuestion || 'Disambiguating contact'}`);
            if (data.appToOpen) safeOpenUrl(data.appToOpen, data.channel === 'whatsapp' ? 'whatsapp://' : undefined);
          } else if (data.actionType === 'CONTACT_NOT_FOUND') {
            if (data.appToOpen) {
              safeOpenUrl(data.appToOpen, data.channel === 'whatsapp' ? 'whatsapp://' : undefined);
              setActionNotice(`⚠️ ${data.channel === 'whatsapp' ? 'WhatsApp' : 'App'} opened · Contact not found`);
            } else {
              setActionNotice(`❌ No contact: "${data.searchedName || ''}"`);
            }
          } else if (data.actionType === 'OPEN_WEBSITE' && data.targetUrl) {
            setActionNotice(`✅ ${data.targetUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}`);
            if (data.resolvedContact) recordContactInteraction(data.resolvedContact.id);
            safeOpenUrl(data.targetUrl);
          } else if (data.actionType === 'PHONE_CALL' && data.phoneNumber) {
            setActionNotice(`📞 Calling ${data.resolvedContact?.name || data.phoneNumber}`);
            safeOpenUrl(`tel:${data.phoneNumber}`);
          } else if (data.actionType === 'APP_ACTION') {
            const a = data.appAction;
            if (a === 'upload_document') { onTriggerUpload(); }
            else if (a === 'new_chat') { setVoiceHistory([]); onNewChat(); }
            else if (a === 'open_history') { onOpenHistory(); }
            else if (a === 'open_auth') { onOpenAuth(); }
            else if (a === 'install_app') { onInstallApp(); }
          } else if (data.actionType === 'SHOPPING' || data.transaction) {
            const tx = data.transaction;
            const payload = data.transactionPayload || {};
            const platform = tx?.platform || 'Amazon';
            const url = payload.url || payload.cartUrl || (platform === 'Flipkart' ? 'https://www.flipkart.com' : 'https://www.amazon.in');
            const nativeScheme = platform === 'Flipkart' ? 'flipkart://' : 'amazon://';

            setActionNotice(`🛒 ${platform}: ${tx?.state || 'Processing'}`);
            safeOpenUrl(url, nativeScheme, platform);

            // Also post message to main chat window so the TransactionPreviewCard is visible
            if (onSendChatMessage) {
              const previewMarker = tx ? `\n\n<!--TRANSACTION_PREVIEW:${JSON.stringify(tx)}-->` : '';
              onSendChatMessage(`${spokenTranscript}${previewMarker}`);
            }
          } else if (data.actionType === 'DOCUMENT_QA') {
            // Route to the chat pipeline for full RAG response
            try {
              const aiResponse = await onSendChatMessage(spokenTranscript);
              if (aiResponse && aiResponse.length > 0) {
                const sentences = aiResponse.replace(/[#*`>\-|]/g, '').split(/[.!?]+/).filter((s: string) => s.trim().length > 5);
                const spokenPart = sentences.slice(0, 3).join('. ').trim();
                const finalSpeech = spokenPart.length > 10 ? spokenPart + '.' : aiResponse.slice(0, 200);
                setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: finalSpeech }]);
                setActionNotice('✅ Answered from document');
                speakVoiceResponse(finalSpeech);
                return;
              }
            } catch {
              // Fall through to speak the Brain's response
            }
          } else if (data.actionType === 'KNOWLEDGE_ANSWER' && !data.liveDataUsed) {
            // For pure knowledge questions, try the chat pipeline for richer answers
            try {
              const aiResponse = await onSendChatMessage(spokenTranscript);
              if (aiResponse && aiResponse.length > 0) {
                const sentences = aiResponse.replace(/[#*`>\-|]/g, '').split(/[.!?]+/).filter((s: string) => s.trim().length > 5);
                const spokenPart = sentences.slice(0, 3).join('. ').trim();
                const finalSpeech = spokenPart.length > 10 ? spokenPart + '.' : aiResponse.slice(0, 200);
                setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: finalSpeech }]);
                setActionNotice('✅ Answered in chat');
                speakVoiceResponse(finalSpeech);
                return;
              }
            } catch {
              // Fall through to speak the Brain's response
            }
          }

          setActionNotice(prev => prev || `✅ Answered`);
          speakVoiceResponse(speech);
        } catch (brainErr) {
          console.error('Brain orchestrator error:', brainErr);
          // Last resort fallback — try direct chat
          try {
            const aiResponse = await onSendChatMessage(spokenTranscript);
            if (aiResponse && aiResponse.length > 0) {
              const sentences = aiResponse.replace(/[#*`>\-|]/g, '').split(/[.!?]+/).filter((s: string) => s.trim().length > 5);
              const spokenPart = sentences.slice(0, 3).join('. ').trim();
              const finalSpeech = spokenPart.length > 10 ? spokenPart + '.' : aiResponse.slice(0, 200);
              setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: finalSpeech }]);
              speakVoiceResponse(finalSpeech);
            } else {
              speakVoiceResponse('Sorry, I couldn\'t process that. Please try again.');
            }
          } catch {
            speakVoiceResponse('Sorry, I encountered an issue. Please try again.');
          }
        }
      } catch (err) {
        console.error('Voice command error:', err);
        speakVoiceResponse('Sorry, there was an issue. Please try again.');
      } finally {
        // Close pre-opened blank tab if no URL navigation consumed it (e.g. knowledge answer, time query)
        cleanupPreOpenedWindow();
        isProcessingRef.current = false;
      }
    },
    [hasActiveDocuments, matchClientInstantAction, preOpenBlankWindow, cleanupPreOpenedWindow, safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onAskDocumentQuestion, onSendChatMessage]
  );

  // --- SPEECH RECOGNITION INIT (Optimized for Laptop & Mobile browsers) ---
  const interimTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) { setRecognitionAvailable(false); return; }

    const rec = new SpeechRecognitionAPI();
    // Using continuous = false on ALL devices ensures Chrome Desktop & Mobile fire onresult / onend reliably
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => {
      if (!isProcessingRef.current) setAssistantState('listening');
    };

    rec.onresult = (event: any) => {
      if (isProcessingRef.current) return;
      let finalText = '', interimText = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t; else interimText += t;
      }

      const activeText = (finalText || interimText).trim();
      setTranscript(activeText);

      // Clear any pending silence timer
      if (interimTimerRef.current) clearTimeout(interimTimerRef.current);

      const targetText = finalText.trim() || interimText.trim();
      if (!targetText || targetText.length < 2) return;

      const handleSpeechCommand = (text: string) => {
        const cleaned = normalizeSTTTranscript(text);
        if (!cleaned || cleaned.length < 2 || isProcessingRef.current) return;

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
      };

      if (finalText) {
        handleSpeechCommand(finalText);
      } else if (interimText && interimText.length > 3) {
        // Configurable 1.8s silence endpointing threshold to accommodate natural speech pauses
        const SILENCE_ENDPOINT_MS = 1800;

        // Check if the current phrase ends with an incomplete grammar signal (preposition/conjunction)
        const isIncompletePhrase = /\b(the|a|an|and|or|to|with|for|of|in|on|at|is|are|was|were|about|chat|send)\s*$/i.test(interimText.trim());
        const effectiveTimeout = isIncompletePhrase ? SILENCE_ENDPOINT_MS + 1000 : SILENCE_ENDPOINT_MS;

        // Visual cue: show "Still listening..." during natural speech pauses
        setActionNotice('🎙️ Still listening...');

        interimTimerRef.current = setTimeout(() => {
          if (!isProcessingRef.current && interimText.trim().length > 2) {
            handleSpeechCommand(interimText);
          }
        }, effectiveTimeout);
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setRecognitionAvailable(false);
        setAssistantState('idle');
      } else if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'network') {
        // Auto-retry on transient errors on laptops & mobiles
        if (!isProcessingRef.current && shouldRestartRef.current) {
          setTimeout(() => { try { rec.start(); } catch {} }, 400);
        }
      }
    };

    rec.onend = () => {
      if (!isProcessingRef.current && shouldRestartRef.current) {
        setTimeout(() => { try { rec.start(); } catch {} }, 200);
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
          const u = getUserFirstName();
          speakVoiceResponse(generateGreeting(u));
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
      cleanupPreOpenedWindow();
      setAssistantState('idle');
    } else {
      preOpenBlankWindow();
      isProcessingRef.current = false;
      shouldRestartRef.current = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      try { recognitionRef.current.start(); } catch {}
    }
  };


  if (!isOpen) return null;

  // --- MINIMIZED MOVABLE NEON STAR WIDGET ---
  if (isMinimized) {
    return (
      <NeonStarWidget
        assistantState={assistantState}
        onActivate={() => {
          unlockMobileAudio();
          setIsMinimized(false);
          if (assistantState === 'idle') toggleListening();
        }}
        onClose={onClose}
      />
    );
  }

  // --- FULL EXPANDED MODAL ---
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setIsMinimized(true)}>
      <div
        className="relative sm:max-w-md w-[92vw] rounded-3xl p-0 overflow-hidden border border-cyan-500/30 shadow-[0_0_80px_rgba(6,182,212,0.3)] bg-slate-950/95 backdrop-blur-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar with OS Action Tools */}
        <div className="p-3 px-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-2">
            <AnimatedVoiceLogo size="sm" state={assistantState} />
            <span className="font-extrabold text-xs tracking-wider bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
              INSIGHT AI OS
            </span>
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowMemoryEditor(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 hover:bg-slate-800 transition-all"
              title="Memory Viewer & Editor"
            >
              <Brain className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowApprovalCenter(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-all"
              title="Automation Approval Center"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTimeline((prev) => !prev)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-all"
              title="Task Timeline & Agent Monitor"
            >
              <Activity className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowPluginsManager(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-all"
              title="Plugins & Skills Manager"
            >
              <Code2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTaskScheduler(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-pink-400 hover:bg-slate-800 transition-all"
              title="Task Scheduler & Reminders"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowVoiceSettings(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-all"
              title="Voice & OS Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            <div className="w-px h-4 bg-slate-800 my-auto mx-1" />

            <button
              className="h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
              onClick={() => setIsMinimized(true)}
              title="Minimize to floating logo"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
            <button
              className="h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
              onClick={onClose}
              title="Close assistant"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Task Timeline Panel Drawer */}
        {showTimeline && (
          <div className="p-3 border-b border-slate-800 bg-slate-950/80 animate-in slide-in-from-top duration-200">
            <TaskTimelinePanel />
          </div>
        )}

        {/* Central Animated Voice Logo & Dual Command Bar */}
        <div className="p-6 py-6 flex flex-col items-center justify-center gap-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-fuchsia-500/10 to-indigo-500/10 blur-3xl pointer-events-none" />

          <AnimatedVoiceLogo
            size="xl"
            state={assistantState}
            onClick={() => { unlockMobileAudio(); toggleListening(); }}
          />

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
              {assistantState === 'idle' && 'Tap Logo to Activate'}
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

          {/* Popup-Blocker Bypass 1-Click Launch Card */}
          {pendingLaunchUrl && (
            <div className="w-full p-3 rounded-2xl bg-gradient-to-r from-cyan-950/80 to-indigo-950/80 border border-cyan-500/50 text-left space-y-2 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" /> Web Application Ready
                </span>
                <span className="text-[10px] text-slate-400 font-mono">1-Click Launch</span>
              </div>
              <p className="text-xs text-slate-300">
                Click below to open <span className="font-semibold text-cyan-200">{pendingLaunchUrl.label}</span> (bypasses browser pop-up blockers):
              </p>
              <div className="flex gap-2 pt-0.5">
                <a
                  href={pendingLaunchUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setPendingLaunchUrl(null)}
                  className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold text-center shadow-lg transition-all flex items-center justify-center gap-1.5"
                >
                  🚀 Open {pendingLaunchUrl.label} Now
                </a>
                <button
                  onClick={() => setPendingLaunchUrl(null)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-semibold"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Pending Delete Choice Card */}
          {pendingDeleteChoice && (
            <div className="w-full p-3.5 rounded-2xl bg-slate-900/95 border border-rose-500/50 text-left space-y-3 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                  <X className="w-4 h-4 text-rose-400" /> Delete Message Options
                </span>
                <span className="text-[10px] text-slate-400">Select option</span>
              </div>
              <p className="text-xs text-slate-300">Do you want to delete this message for yourself only or for everyone in the chat?</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setPendingDeleteChoice(null);
                    setActionNotice('🗑️ Deleted for me');
                    speakVoiceResponse('Message deleted for you.');
                  }}
                  className="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all"
                >
                  Delete For Me
                </button>
                <button
                  onClick={() => {
                    setPendingDeleteChoice(null);
                    setActionNotice('🗑️ Deleted for everyone');
                    speakVoiceResponse('Message deleted for everyone in the chat.');
                  }}
                  className="flex-1 py-1.5 rounded-xl bg-rose-600/40 hover:bg-rose-600/60 border border-rose-500/50 text-rose-300 text-xs font-bold transition-all"
                >
                  Delete For Everyone
                </button>
              </div>
            </div>
          )}

          {/* Pending Confirmation Card (yes/no before executing) */}
          {pendingConfirmContact && (
            <div className="w-full p-3 rounded-2xl bg-slate-900/90 border border-emerald-500/40 text-left space-y-2 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Action
                </span>
                <span className="text-[10px] text-slate-400">Say yes or no</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700">
                <div className="flex items-center gap-2">
                  {confirmationMode === 'whatsapp_chat' ? (
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Phone className="w-4 h-4 text-cyan-400" />
                  )}
                  <span className="text-xs font-bold text-slate-200">
                    {confirmationMode === 'whatsapp_chat' ? '💬 WhatsApp Chat' : confirmationMode === 'whatsapp_call' ? '📞 WhatsApp Call' : '📞 Phone Call'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-cyan-300 mt-1">{pendingConfirmContact.name}</p>
                <p className="text-[11px] font-mono text-cyan-400/90 mt-0.5">{pendingConfirmContact.phone}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const chosen = pendingConfirmContact;
                    const mode = confirmationMode;
                    recordContactInteraction(chosen.id);
                    setPendingConfirmContact(null);
                    setDisambiguationContacts([]);
                    setPendingCallName('');
                    const cleanPhone = chosen.phone.replace(/\D/g, '');
                    if (mode === 'whatsapp_chat') {
                      safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
                      setActionNotice(`💬 WhatsApp Chat: ${chosen.name}`);
                      speakVoiceResponse(`Opening WhatsApp chat with ${chosen.name}. What's next?`);
                    } else if (mode === 'whatsapp_call') {
                      safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
                      setActionNotice(`📞 WhatsApp Call: ${chosen.name}`);
                      speakVoiceResponse(`Starting WhatsApp call for ${chosen.name}. What's next?`);
                    } else {
                      window.location.href = `tel:${chosen.phone}`;
                      setActionNotice(`📞 Calling ${chosen.name}`);
                      speakVoiceResponse(`Calling ${chosen.name} now. What's next?`);
                    }
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1"
                >
                  {confirmationMode === 'whatsapp_chat' ? '💬 Yes, Open Chat' : '✅ Yes'}
                </button>
                <button
                  onClick={() => {
                    setPendingConfirmContact(null);
                    setDisambiguationContacts([]);
                    setPendingCallName('');
                    setActionNotice(null);
                    speakVoiceResponse(`Cancelled. What else can I help with?`);
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/40 text-rose-300 text-xs font-bold transition-all"
                >
                  ❌ Cancel
                </button>
              </div>
            </div>
          )}

          {/* Contact Disambiguation List Card */}
          {disambiguationContacts.length > 0 && !pendingConfirmContact && (
            <div className="w-full p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-left space-y-2 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  {disambiguationMode === 'whatsapp_chat' ? (
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Phone className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  {disambiguationMode === 'whatsapp_chat' ? 'WhatsApp Chat Contacts' : disambiguationMode === 'whatsapp_call' ? 'WhatsApp Call Contacts' : 'Phone Contacts'} ({disambiguationContacts.length})
                </span>
                <span className="text-[10px] text-slate-400">Say number or tap</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {disambiguationContacts.map((c, i) => (
                  <button
                    key={c.id || i}
                    onClick={() => {
                      setPendingConfirmContact(c);
                      setConfirmationMode(disambiguationMode);
                      const actionText =
                        disambiguationMode === 'whatsapp_chat' ? `Open WhatsApp chat with` :
                        disambiguationMode === 'whatsapp_call' ? `WhatsApp call` : `Call`;
                      setActionNotice(`❓ Confirm: ${c.name}?`);
                      speakVoiceResponse(`${actionText} ${c.name}? Say yes to confirm or no to cancel.`);
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-800/80 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/50 transition-all text-xs group"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px] font-bold">
                        {i + 1}
                      </span>
                      <span className="font-semibold text-slate-200 group-hover:text-cyan-200 truncate">{c.name}</span>
                      {c.label && <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">{c.label}</span>}
                    </div>
                    <span className="text-[11px] font-mono text-cyan-400/90 shrink-0 ml-2">{c.phone}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Add Contact Prompt Card */}
          {missingContactName && !showAddContact && !pendingConfirmContact && disambiguationContacts.length === 0 && (
            <div className="w-full p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-left space-y-2 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-cyan-400" /> Save &quot;{missingContactName}&quot; to Contacts?
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Save {missingContactName}&apos;s phone number to enable 1-click WhatsApp chats &amp; voice calls!
              </p>
              <button
                onClick={() => {
                  setAddContactName(missingContactName);
                  setAddContactPhone('');
                  setShowAddContact(true);
                }}
                className="w-full py-1.5 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" /> Save {missingContactName} Phone Number
              </button>
            </div>
          )}

          {/* Inline Add Contact Form Card */}
          {showAddContact && (
            <div className="w-full p-3.5 rounded-2xl bg-slate-900/95 border border-cyan-500/50 text-left space-y-3 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-cyan-400" /> Save New Contact
                </span>
                <button onClick={() => setShowAddContact(false)} className="text-slate-400 hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={addContactName}
                    onChange={(e) => setAddContactName(e.target.value)}
                    placeholder="e.g. Thanoj"
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Phone Number (with country code)</label>
                  <input
                    type="tel"
                    value={addContactPhone}
                    onChange={(e) => setAddContactPhone(e.target.value)}
                    placeholder="e.g. +919876543210 or +15550192834"
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    if (!addContactName.trim() || !addContactPhone.trim()) return;
                    upsertContact({
                      id: 'c_' + Date.now(),
                      name: addContactName.trim(),
                      phone: addContactPhone.trim(),
                      label: 'Mobile',
                    });
                    setShowAddContact(false);
                    setMissingContactName('');
                    setActionNotice(`✅ Saved ${addContactName}`);
                    speakVoiceResponse(`Saved contact ${addContactName}. Say "open ${addContactName} chat in WhatsApp" to test now!`);
                  }}
                  className="flex-1 py-1.5 rounded-xl bg-emerald-600/40 hover:bg-emerald-600/60 border border-emerald-500/50 text-emerald-300 text-xs font-bold transition-all"
                >
                  ✅ Save Contact
                </button>
                <button
                  onClick={() => setShowAddContact(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Prominent Text Command Search Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!typedCommand.trim()) return;
              const text = typedCommand.trim();
              setTypedCommand('');
              processVoiceCommand(text);
            }}
            className="w-full relative flex items-center pt-2"
          >
            <div className="relative w-full flex items-center">
              <Search className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
              <input
                ref={textInputRef}
                type="text"
                value={typedCommand}
                onChange={(e) => setTypedCommand(e.target.value)}
                placeholder="Type command or question... (Press / to focus)"
                className="w-full pl-10 pr-11 py-2.5 rounded-2xl bg-slate-900 border border-slate-800 focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/60 text-xs text-white placeholder:text-slate-500 font-medium transition-all shadow-inner"
              />
              <button
                type="submit"
                disabled={!typedCommand.trim()}
                className="absolute right-1.5 p-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-30 disabled:pointer-events-none text-white transition-all shadow-md"
                title="Send Command"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>

          {/* Recent Commands */}
          {commandLog.length > 0 && (
            <div className="w-full pt-2 border-t border-slate-800/60">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center mb-1.5">Recent Tasks</p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {commandLog.map((cmd, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[10px] text-slate-400 truncate max-w-[140px]">{cmd}</span>
                ))}
              </div>
            </div>
          )}

          {/* Hint */}
          <p className="text-[10px] text-slate-500 text-center">
            🎙️ Voice or ⌨️ Type commands · Press <kbd className="px-1 font-mono text-[9px] bg-slate-800 rounded border border-slate-700 text-slate-300">/</kbd> to focus text box
          </p>
        </div>
      </div>

      {/* Sub-Component Modals */}
      <MemoryEditorModal isOpen={showMemoryEditor} onClose={() => setShowMemoryEditor(false)} />
      <AutomationApprovalCenter isOpen={showApprovalCenter} onClose={() => setShowApprovalCenter(false)} />
      <PluginsSkillsManager isOpen={showPluginsManager} onClose={() => setShowPluginsManager(false)} />
      <TaskSchedulerModal isOpen={showTaskScheduler} onClose={() => setShowTaskScheduler(false)} />
      <VoiceSettingsModal isOpen={showVoiceSettings} onClose={() => setShowVoiceSettings(false)} />
      <PermissionsGuideModal isOpen={showPermissionsGuide} onClose={() => setShowPermissionsGuide(false)} />
    </div>
  );
}
