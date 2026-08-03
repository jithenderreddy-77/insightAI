'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, X, Sparkles, Volume2, Zap, Minimize2, Maximize2, Phone } from 'lucide-react';
import { AnimatedVoiceLogo } from '@/components/animated-voice-logo';
import { getSavedUser } from '@/lib/history-store';
import { searchContacts, syncDeviceContacts, getSavedContacts, recordContactInteraction, type Contact } from '@/lib/contacts-store';

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
  const [isMinimized, setIsMinimized] = useState(false);

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

  // --- POPUP-BLOCKER PROOF APPLICATION & URL LAUNCHER ---
  // Uses direct window location navigation so browsers NEVER trigger "Pop-up window blocked"
  const safeOpenUrl = useCallback((webUrl: string, nativeScheme?: string) => {
    if (typeof window === 'undefined') return;
    try {
      if (nativeScheme) {
        const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobileDevice) {
          const startTime = Date.now();
          window.location.href = nativeScheme;
          setTimeout(() => {
            if (Date.now() - startTime < 2000) {
              window.open(webUrl, '_blank', 'noopener,noreferrer');
            }
          }, 1500);
        } else {
          // Desktop: Open external app/web link in new tab — preserves current chat session!
          window.open(webUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Open web app in new tab — preserving active chat session context!
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

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

  // Contact disambiguation state for smart call routing
  const [disambiguationContacts, setDisambiguationContacts] = useState<Contact[]>([]);
  const [pendingCallName, setPendingCallName] = useState<string>('');
  const [disambiguationMode, setDisambiguationMode] = useState<'tel' | 'whatsapp'>('tel');

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
    (query: string): boolean => {
      const q = query.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();
      if (!q) return false;

      const userName = getUserFirstName();

      // "Come back" / "Go back" navigation control
      if (q === 'come back' || q === 'go back' || q === 'previous step' || q === 'back' || q === 'return') {
        setIsMinimized(false);
        setActionNotice(`↩️ Returned`);
        speakVoiceResponse(`Coming back to the main voice screen, ${userName}. What's your next command?`);
        return true;
      }

      // Exit / Stop / Stop Insight / No thanks / Done
      if (
        q === 'stop insight' || q === 'stop' || q === 'no' || q === 'nothing' || q === 'no thanks' ||
        q === 'thats all' || q === 'that is all' || q === 'close' || q === 'exit' || q === 'quit' ||
        q === 'shut down' || q === 'goodbye' || q === 'bye' || q === 'done'
      ) {
        speakVoiceResponse(`Alright ${userName}! Stopping now. Call me anytime!`);
        setTimeout(() => onClose(), 1500);
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

      // --- DISAMBIGUATION SELECTION (user choosing from a list of matching contacts) ---
      if (disambiguationContacts.length > 0) {
        const ordinalMap: Record<string, number> = {
          '1': 0, 'first': 0, '1st': 0, 'one': 0,
          '2': 0, 'second': 1, '2nd': 1, 'two': 1,
          '3': 2, 'third': 2, '3rd': 2, 'three': 2,
          '4': 3, 'fourth': 3, '4th': 3, 'four': 3,
          '5': 4, 'fifth': 4, '5th': 4, 'five': 4,
        };

        const words = q.replace(/^(the\s+|number\s+)/gi, '').trim();
        const ordIdx = ordinalMap[words];
        let chosen: Contact | undefined;

        const isAffirmative = q === 'yes' || q === 'yeah' || q === 'yep' || q === 'correct' || q === 'sure' || q === 'right';
        if (isAffirmative && disambiguationContacts.length > 0) {
          chosen = disambiguationContacts[0];
        } else if (ordIdx !== undefined && ordIdx < disambiguationContacts.length) {
          chosen = disambiguationContacts[ordIdx];
        } else {
          chosen = disambiguationContacts.find(
            (c) => c.name.toLowerCase() === q || c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(' ')[0])
          );
        }

        if (chosen) {
          recordContactInteraction(chosen.id);
          const mode = disambiguationMode;
          setDisambiguationContacts([]);
          setPendingCallName('');

          const cleanPhone = chosen.phone.replace(/\D/g, '');
          if (mode === 'whatsapp') {
            safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
            setActionNotice(`💬 WhatsApp Call ${chosen.name}`);
            speakVoiceResponse(`Opening WhatsApp call for ${chosen.name}, ${userName}. Any other command?`);
          } else {
            window.location.href = `tel:${chosen.phone}`;
            setActionNotice(`📞 Calling ${chosen.name}`);
            speakVoiceResponse(`Calling ${chosen.name} now, ${userName}. Any other command?`);
          }
          return true;
        }

        if (q === 'cancel' || q === 'never mind' || q === 'nevermind' || q === 'none') {
          setDisambiguationContacts([]);
          setPendingCallName('');
          setActionNotice(null);
          speakVoiceResponse(`Cancelled, ${userName}. What else can I help with?`);
          return true;
        }
      }

      // --- SMART PHONE & WHATSAPP CALL WITH FUZZY DISAMBIGUATION ---
      // Handles: "call Thanoj", "whatsapp call Thanoj", "video call Thanoj", "call Thanoj on whatsapp"
      const isWhatsAppCall = q.includes('whatsapp') || q.includes('video call');
      const callMatch = q.match(/^(?:call|phone|dial|ring|whatsapp\s+call|video\s+call)\s+(.+)/i) || (q.includes('call') ? q.match(/call\s+([a-zA-Z0-9_\s]+)/i) : null);

      if (callMatch) {
        let searchName = callMatch[1]
          .replace(/\s+(on\s+whatsapp|via\s+whatsapp|whatsapp|please|for me|now)\s*$/gi, '')
          .replace(/^(on\s+whatsapp|via\s+whatsapp)\s+/gi, '')
          .trim();

        if (!searchName || searchName === 'whatsapp') return false;

        const matches = searchContacts(searchName);

        if (matches.length === 0) {
          setActionNotice(`❌ No contact: "${searchName}"`);
          speakVoiceResponse(`Sorry ${userName}, I couldn't find any contact matching ${searchName}. You can add them or sync your device contacts.`);
          return true;
        }

        if (matches.length === 1) {
          const contact = matches[0];
          recordContactInteraction(contact.id);
          const cleanPhone = contact.phone.replace(/\D/g, '');

          if (isWhatsAppCall) {
            safeOpenUrl(`https://wa.me/${cleanPhone}`, `whatsapp://send?phone=${cleanPhone}`);
            setActionNotice(`💬 WhatsApp Call ${contact.name}`);
            speakVoiceResponse(`Opening WhatsApp call for ${contact.name}, ${userName}. Any other command?`);
          } else {
            window.location.href = `tel:${contact.phone}`;
            setActionNotice(`📞 Calling ${contact.name}`);
            speakVoiceResponse(`Calling ${contact.name} now, ${userName}. Any other command?`);
          }
          return true;
        }

        // Multiple matches → show disambiguation list and prompt user
        setDisambiguationContacts(matches.slice(0, 5));
        setPendingCallName(searchName);
        setDisambiguationMode(isWhatsAppCall ? 'whatsapp' : 'tel');

        const nameList = matches.slice(0, 5).map((c, i) => `${i + 1}. ${c.name}`).join(', ');
        const callTypeLabel = isWhatsAppCall ? 'WhatsApp call' : 'call';
        setActionNotice(`📱 Found ${matches.length} contacts for "${searchName}"`);
        speakVoiceResponse(
          `I found ${matches.length} contacts matching ${searchName}: ${nameList}. ` +
          `Which one would you like to ${callTypeLabel}, ${userName}? Say the number or name.`
        );
        return true;
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

      // --- ADVANCED CONTACT CHAT & WHATSAPP AUTOMATION ---
      // Handles: "open Thanoj chat", "open chat of Thanoj", "message Thanoj saying meeting at 5", "send whatsapp to Thanoj Hi"
      if (q.includes('whatsapp') || q.includes('chat') || q.includes('message')) {
        const contactMatch = q.match(/(?:chat\s+(?:with|of)?|message|to|send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to|open\s+chat\s+of)\s+([a-zA-Z0-9_-]+)/i);
        let contactName = contactMatch ? contactMatch[1].trim() : '';

        // Clean out common non-name words
        if (['the', 'a', 'an', 'app', 'chat', 'message', 'my', 'whatsapp'].includes(contactName.toLowerCase())) {
          contactName = '';
        }

        let msg = q
          .replace(/^(send\s+)?(a\s+)?(whatsapp\s+)?message\s+(to\s+[a-zA-Z0-9_-]+\s+)?(on\s+whatsapp\s+)?(saying\s+)?/gi, '')
          .replace(/^open\s+(chat\s+of\s+|whatsapp\s+chat\s+for\s+)?/gi, '')
          .replace(/\s+on\s+whatsapp$/gi, '')
          .trim();

        if (contactName || msg) {
          const textToInsert = msg || `Hi ${contactName || ''}`;
          const webUrl = `https://web.whatsapp.com/send?text=${encodeURIComponent(textToInsert)}`;
          const nativeScheme = `whatsapp://send?text=${encodeURIComponent(textToInsert)}`;

          const targetLabel = contactName ? `Chat with ${contactName}` : 'WhatsApp';
          setActionNotice(`✅ WhatsApp: ${targetLabel}`);
          safeOpenUrl(webUrl, nativeScheme);

          if (contactName) {
            speakVoiceResponse(`Opening WhatsApp chat for ${contactName}, ${userName}. Is there any other command?`);
          } else {
            speakVoiceResponse(`Opening WhatsApp app to send message, ${userName}. Any other command?`);
          }
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
        // Fast-path check (0ms latency, 0 API Tokens consumed!) — only handles automation/app/search commands
        const handled = matchClientInstantAction(spokenTranscript);
        if (handled) return;

        // --- CONVERSATIONAL AI ENGINE ---
        // All non-automation queries (questions, doubts, conversations) are sent
        // directly to the chatbot for an intelligent answer.
        // The response appears in the chat AND is spoken aloud.
        setActionNotice('🧠 AI answering...');

        // Record query in history buffer
        setVoiceHistory((prev) => [...prev.slice(-6), { role: 'user', content: spokenTranscript }]);

        try {
          const aiResponse = await onSendChatMessage(spokenTranscript);

          if (aiResponse && aiResponse.length > 0) {
            // Trim the spoken response to ~3 sentences for TTS (keep it natural)
            const sentences = aiResponse.replace(/[#*`>\-|]/g, '').split(/[.!?]+/).filter(s => s.trim().length > 5);
            const spokenPart = sentences.slice(0, 3).join('. ').trim();
            const finalSpeech = spokenPart.length > 10 ? spokenPart + '.' : aiResponse.slice(0, 200);

            setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: finalSpeech }]);
            setActionNotice('✅ Answered in chat');
            speakVoiceResponse(finalSpeech);
          } else {
            setActionNotice('✅ Answered');
            speakVoiceResponse('I\'ve answered in the chat. You can see the full response there.');
          }
        } catch (chatErr) {
          console.error('Chat message error from voice:', chatErr);
          // Fallback: use the voice-assistant API for a quick spoken answer with history
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
            const speech = data.spokenResponse || 'Let me look that up for you.';

            setVoiceHistory((prev) => [...prev.slice(-6), { role: 'assistant', content: speech }]);

            if (data.actionType === 'DISAMBIGUATE_CONTACT' && data.candidates) {
              setDisambiguationContacts(data.candidates);
              setPendingCallName(data.searchedName || '');
              setDisambiguationMode(data.pendingChannel === 'whatsapp' ? 'whatsapp' : 'tel');
              setActionNotice(`❓ ${data.clarifyingQuestion || 'Disambiguating contact'}`);
            } else if (data.actionType === 'OPEN_WEBSITE' && data.targetUrl) {
              setActionNotice(`✅ ${data.targetUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}`);
              if (data.resolvedContact) recordContactInteraction(data.resolvedContact.id);
              safeOpenUrl(data.targetUrl);
            } else if (data.actionType === 'APP_ACTION') {
              const a = data.appAction;
              if (a === 'upload_document') { onTriggerUpload(); }
              else if (a === 'new_chat') { setVoiceHistory([]); onNewChat(); }
              else if (a === 'open_history') { onOpenHistory(); }
              else if (a === 'open_auth') { onOpenAuth(); }
              else if (a === 'install_app') { onInstallApp(); }
            }
            setActionNotice(`✅ Answered`);
            speakVoiceResponse(speech);
          } catch {
            speakVoiceResponse('Sorry, I couldn\'t process that. Please try again.');
          }
        }
      } catch (err) {
        console.error('Voice command error:', err);
        speakVoiceResponse('Sorry, there was an issue. Please try again.');
      } finally {
        isProcessingRef.current = false;
      }
    },
    [hasActiveDocuments, matchClientInstantAction, safeOpenUrl, speakVoiceResponse, onTriggerUpload, onNewChat, onOpenHistory, onOpenAuth, onInstallApp, onAskDocumentQuestion, onSendChatMessage]
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
        const cleaned = text.trim();
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
          speakVoiceResponse(`Ready ${u}! Say any command and I'll handle it for you.`);
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

  // --- MINIMIZED FLOATING DRAGGABLE LOGO ORB ---
  if (isMinimized) {
    return (
      <div
        ref={orbRef}
        className="fixed z-[9999] select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ left: orbPos.x, top: orbPos.y }}
        onMouseDown={(e) => { e.preventDefault(); handleDragStart(e.clientX, e.clientY); }}
        onTouchStart={(e) => { if (e.touches[0]) handleDragStart(e.touches[0].clientX, e.touches[0].clientY); }}
      >
        <AnimatedVoiceLogo
          size="md"
          state={assistantState}
          onClick={() => { if (!isDraggingRef.current) setIsMinimized(false); }}
        />

        {/* Mini transcript badge */}
        {transcript && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-slate-900/95 border border-cyan-500/40 text-[10px] text-cyan-300 font-medium max-w-[150px] truncate shadow-lg pointer-events-none">
            {transcript}
          </div>
        )}

        {/* Action notice badge */}
        {actionNotice && (
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-emerald-900/95 border border-emerald-500/40 text-[10px] text-emerald-300 font-bold max-w-[180px] truncate shadow-lg pointer-events-none">
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
            <AnimatedVoiceLogo size="sm" state={assistantState} />
            <span className="font-extrabold text-sm tracking-wide bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
              INSIGHT VOICE
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
              onClick={() => setIsMinimized(true)}
              title="Minimize to floating logo"
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

        {/* Central Animated Voice Logo */}
        <div className="p-6 py-8 flex flex-col items-center justify-center gap-5 relative overflow-hidden">
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

          {/* Contact Disambiguation List Card */}
          {disambiguationContacts.length > 0 && (
            <div className="w-full p-3 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-left space-y-2 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Found {disambiguationContacts.length} Contacts
                </span>
                <span className="text-[10px] text-slate-400">Say number or tap</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {disambiguationContacts.map((c, i) => (
                  <button
                    key={c.id || i}
                    onClick={() => {
                      setDisambiguationContacts([]);
                      setPendingCallName('');
                      window.location.href = `tel:${c.phone}`;
                      setActionNotice(`📞 Calling ${c.name}`);
                      speakVoiceResponse(`Calling ${c.name} now, ${getUserFirstName()}. Any other command?`);
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
            Say &quot;Call Thanoj&quot;, &quot;Open YouTube&quot;, &quot;Send WhatsApp message Hello&quot;, &quot;Minimize&quot;, or &quot;Stop&quot;
          </p>
        </div>
      </div>
    </div>
  );
}
