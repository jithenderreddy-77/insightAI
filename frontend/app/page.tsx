'use client';

import type React from 'react';

import { useToast } from '@/hooks/use-toast';
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Paperclip,
  ArrowUp,
  Loader2,
  FileText,
  Sparkles,
  Upload,
  Bot,
  Zap,
  Search,
  History,
  User,
  Plus,
  LogOut,
  Shield,
  ShieldAlert,
  MessageSquare,
  Download,
} from 'lucide-react';
import { ExamplePrompts } from '@/components/example-prompts';
import { ChatMessage } from '@/components/chat-message';
import { FilePreview } from '@/components/file-preview';
import { AuthModal } from '@/components/auth-modal';
import { HistorySidebar } from '@/components/history-sidebar';
import { AdminModal } from '@/components/admin-modal';
import { VoiceAssistantModal } from '@/components/voice-assistant-modal';
import { AnimatedVoiceLogo } from '@/components/animated-voice-logo';
import { PWAUpdateToast } from '@/components/pwa-update-toast';
import {
  UserProfile,
  ChatThread,
  ChatAttachment,
  getSavedUser,
  removeUser,
  getUserThreads,
  saveUserThread,
  deleteUserThread,
  getCheerfulGreeting,
  DEFAULT_GUEST_USER,
} from '@/lib/history-store';
import {
  PDFDocument,
  RetrieveDocumentsNodeUpdates,
} from '@/types/graphTypes';

const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.xlsx,.xls,.xlsm,.xlsb,.ods,.md,.json,.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.tiff';
const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
];

export default function Home() {
  const { toast } = useToast();
  
  // Auth and Profile State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  
  // Chat History & Threads State
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<
    Array<{
      role: 'user' | 'assistant';
      content: string;
      sources?: PDFDocument[];
      attachments?: ChatAttachment[];
    }>
  >([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [offlineDocs, setOfflineDocs] = useState<{ text: string; filename: string }[]>([]);
  const [spreadsheetSessions, setSpreadsheetSessions] = useState<Record<string, any>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Speculative Pre-fetching State & Refs
  const [isPrefetched, setIsPrefetched] = useState(false);
  const prefetchCacheRef = useRef<{ draftQuery: string; candidateDocs: any[]; timestamp: number } | null>(null);
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prefetchAbortControllerRef = useRef<AbortController | null>(null);

  // Persistent Attachments Ref
  const pendingAttachmentsRef = useRef<ChatAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastRetrievedDocsRef = useRef<PDFDocument[]>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Debounced input handler for speculative pre-fetching (cancels stale requests, respects word thresholds)
  const handleInputChangeWithPrefetch = (val: string) => {
    setInput(val);
    setIsPrefetched(false);

    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
    }

    if (prefetchAbortControllerRef.current) {
      prefetchAbortControllerRef.current.abort();
      prefetchAbortControllerRef.current = null;
    }

    const trimmed = val.trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

    // Threshold Gate: minimum 10 characters and 2 words
    if (trimmed.length < 10 || wordCount < 2 || isLoading) {
      prefetchCacheRef.current = null;
      return;
    }

    // Debounce 600ms pause to ensure user stopped typing before pre-fetching
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        const abortController = new AbortController();
        prefetchAbortControllerRef.current = abortController;

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

        const res = await fetch('/api/chat/prefetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            fileNames: files.map((f) => f.name),
            useLocalOffline: isOffline,
            offlineDocuments: offlineDocs,
          }),
          signal: abortController.signal,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.prefetched && Array.isArray(data.candidateDocs) && data.candidateDocs.length > 0) {
            prefetchCacheRef.current = {
              draftQuery: trimmed,
              candidateDocs: data.candidateDocs,
              timestamp: Date.now(),
            };
            setIsPrefetched(true);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          // Silent catch for background prefetch
        }
      } finally {
        prefetchAbortControllerRef.current = null;
      }
    }, 600);
  };

  // Secret Admin Trigger Refs
  const logoClickCountRef = useRef<number>(0);
  const logoClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleSecretLogoClick = () => {
    handleReturnHome();

    logoClickCountRef.current += 1;
    if (logoClickTimerRef.current) {
      clearTimeout(logoClickTimerRef.current);
    }

    if (logoClickCountRef.current >= 3) {
      logoClickCountRef.current = 0;
      setIsAdminModalOpen(true);
      toast({
        title: '🔐 Secret Admin Triggered',
        description: 'Enter admin password to proceed.',
      });
      return;
    }

    logoClickTimerRef.current = setTimeout(() => {
      logoClickCountRef.current = 0;
    }, 1200);
  };

  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  // PWA Service Worker Registration & Installation Handler
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('[PWA] ServiceWorker registered successfully:', reg.scope);
          })
          .catch((err) => {
            console.log('[PWA] ServiceWorker registration notice:', err);
          });
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      toast({
        title: '🎉 App Installed Successfully!',
        description: 'Insight AI is now saved to your home screen for 100% offline use.',
      });
      setIsInstallable(false);
    }
    setDeferredInstallPrompt(null);
  };

  // 1) Initialize user session and load saved threads (Mandatory Login)
  useEffect(() => {
    const savedUser = getSavedUser();
    if (savedUser && !savedUser.isGuest) {
      setUser(savedUser);
      loadThreadsForUser(savedUser.id);
    } else {
      // Mandatory account creation/login for every new user
      setUser(null);
      setIsAuthModalOpen(true);
    }
  }, []);

  const loadThreadsForUser = (userId: string) => {
    const userThreads = getUserThreads(userId);
    setThreads(userThreads);
    if (userThreads.length > 0) {
      const latest = userThreads[0];
      setThreadId(latest.id);
      setMessages(latest.messages);
    } else {
      const newId = crypto.randomUUID();
      setThreadId(newId);
      setMessages([]);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save current thread history whenever messages change
  useEffect(() => {
    if (user && threadId && messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === 'user')?.content || 'New Conversation';
      const title = firstUserMsg.length > 35 ? firstUserMsg.substring(0, 35) + '...' : firstUserMsg;

      const currentThread: ChatThread = {
        id: threadId,
        title,
        messages,
        fileNames: files.map((f) => f.name),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveUserThread(user.id, currentThread);
      setThreads(getUserThreads(user.id));
    }
  }, [messages, files, user, threadId]);

  // Handle New Chat Session
  const handleNewChat = () => {
    const newId = crypto.randomUUID();
    setThreadId(newId);
    setMessages([]);
    toast({
      title: 'New Chat Started',
      description: 'You can now ask questions about your documents.',
    });
  };

  // Handle Select Thread from Sidebar History
  const handleSelectThread = (selectedId: string) => {
    if (!user) return;
    const userThreads = getUserThreads(user.id);
    const target = userThreads.find((t) => t.id === selectedId);
    if (target) {
      setThreadId(target.id);
      setMessages(target.messages);
    }
  };

  // Handle Delete Thread
  const handleDeleteThread = (targetId: string) => {
    if (!user) return;
    deleteUserThread(user.id, targetId);
    const updated = getUserThreads(user.id);
    setThreads(updated);
    if (threadId === targetId) {
      if (updated.length > 0) {
        setThreadId(updated[0].id);
        setMessages(updated[0].messages);
      } else {
        handleNewChat();
      }
    }
    toast({
      title: 'Thread deleted',
      description: 'The conversation has been removed from history.',
    });
  };

  const handleSignOut = () => {
    removeUser();
    setUser(DEFAULT_GUEST_USER);
    loadThreadsForUser(DEFAULT_GUEST_USER.id);
    toast({
      title: 'Signed out',
      description: 'You are now browsing in Explorer Guest mode.',
    });
  };

  // --- VOICE ASSISTANT → CHATBOT BRIDGE ---
  // Programmatically sends a voice question to the chat API, streams the response,
  // shows it in the chat UI, and returns the full AI response text for TTS.
  const handleVoiceChatMessage = async (voiceMessage: string): Promise<string> => {
    if (!voiceMessage.trim()) return '';

    // Ensure we have a thread
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const newId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setThreadId(newId);
      currentThreadId = newId;
    }

    // Add user message and placeholder assistant message to chat UI
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: voiceMessage, sources: undefined },
      { role: 'assistant', content: '', sources: undefined },
    ]);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: voiceMessage,
        threadId: currentThreadId,
        fileNames: files.map((f) => f.name),
        useLocalOffline: isOffline,
        offlineDocuments: offlineDocs,
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader available');

    const decoder = new TextDecoder();
    let done = false;
    let sseBuffer = '';
    let fullResponseText = '';

    while (!done) {
      const { done: chunkDone, value } = await reader.read();
      done = chunkDone;

      if (value) {
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const sseString = trimmed.slice('data: '.length);
          let sseEvent: any;
          try {
            sseEvent = JSON.parse(sseString);
          } catch {
            continue;
          }

          const { event, data } = sseEvent;

          if (event === 'messages/partial') {
            if (Array.isArray(data)) {
              const lastObj = data[data.length - 1];
              if (lastObj?.type === 'ai') {
                const partialContent = lastObj.content ?? '';
                if (typeof partialContent === 'string' && !partialContent.startsWith('{')) {
                  fullResponseText = partialContent;
                  setMessages((prev) => {
                    const newArr = [...prev];
                    if (newArr.length > 0 && newArr[newArr.length - 1].role === 'assistant') {
                      newArr[newArr.length - 1].content = partialContent;
                    }
                    return newArr;
                  });
                }
              }
            }
          }
        }
      }
    }

    // Save the thread
    if (user && currentThreadId) {
      saveUserThread(user.id, {
        id: currentThreadId,
        title: voiceMessage.slice(0, 40) + (voiceMessage.length > 40 ? '...' : ''),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        fileNames: files.map((f) => f.name),
      });
      loadThreadsForUser(user.id);
    }

    return fullResponseText;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !threadId || isLoading) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const userMessage = input.trim();
    const currentAttachments = [...pendingAttachmentsRef.current];
    pendingAttachmentsRef.current = [];

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage, sources: undefined, attachments: currentAttachments.length > 0 ? currentAttachments : undefined },
      { role: 'assistant', content: '', sources: undefined },
    ]);
    setInput('');
    setIsLoading(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 90-second client-side safety timeout — prevents indefinite loading spinners on slow network connections
    const REQUEST_TIMEOUT_MS = 90000;
    const timeoutId = setTimeout(() => {
      console.warn('[Insight AI] Request timed out after 90s — aborting hanging stream.');
      abortController.abort('REQUEST_TIMEOUT');
    }, REQUEST_TIMEOUT_MS);

    lastRetrievedDocsRef.current = [];

    // --- Detect spreadsheet analytical queries ---
    const spreadsheetFileNames = Object.keys(spreadsheetSessions);
    const hasSpreadsheet = spreadsheetFileNames.length > 0;
    const isAnalyticalQuery = hasSpreadsheet;

    // --- Detect Transaction / Shopping Queries ---
    const lowerUserMsg = userMessage.toLowerCase();
    const isShoppingQuery =
      lowerUserMsg.includes('shoes') ||
      lowerUserMsg.includes('cart') ||
      lowerUserMsg.includes('under ₹') ||
      lowerUserMsg.includes('under rs') ||
      lowerUserMsg.includes('size ') ||
      (lowerUserMsg.includes('buy') && (lowerUserMsg.includes('nike') || lowerUserMsg.includes('puma') || lowerUserMsg.includes('ssd'))) ||
      (lowerUserMsg.includes('find') && (lowerUserMsg.includes('shoes') || lowerUserMsg.includes('black') || lowerUserMsg.includes('under')));

    try {
      if (isShoppingQuery) {
        const response = await fetch('/api/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: userMessage,
            hasActiveDocuments: files.length > 0,
            history: messages.map(m => ({ role: m.role, content: m.content })),
          }),
          signal: abortController.signal,
        });

        const result = await response.json();
        let assistantContent = result.spokenResponse || 'Processed your request.';

        if (result.transaction) {
          assistantContent += `\n\n<!--TRANSACTION_PREVIEW:${JSON.stringify(result.transaction)}-->`;
        }

        setMessages((prev) => {
          const newArr = [...prev];
          if (newArr.length > 0 && newArr[newArr.length - 1].role === 'assistant') {
            newArr[newArr.length - 1].content = assistantContent;
          }
          return newArr;
        });

        setIsLoading(false);
        abortControllerRef.current = null;
        return;
      }

      // --- SPREADSHEET ANALYTICS PATH ---
      if (isAnalyticalQuery) {
        const firstFile = spreadsheetFileNames[0];
        const ssData = spreadsheetSessions[firstFile];
        const activeSheet = ssData?.sheets?.[0];

        if (activeSheet) {
          // Detect if this is a scientific dataset (has scientificProfile with non-General type)
          const isScientificDataset = activeSheet.scientificProfile &&
            activeSheet.scientificProfile.experimentType !== 'General' &&
            activeSheet.scientificProfile.confidence > 0.3;

          // Collect all sheets across all active uploaded files in session for multi-dataset comparisons
          const allSheets = Object.values(spreadsheetSessions).flatMap((s: any) => s?.sheets || []);

          let response: Response;

          if (isScientificDataset) {
            // Route to scientific analysis endpoint
            response = await fetch('/api/scientific-analysis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                question: userMessage,
                sheetData: activeSheet,
                allSheets,
                scientificProfile: activeSheet.scientificProfile,
                validationReport: activeSheet.validationReport || null,
              }),
              signal: abortController.signal,
            });
          } else {
            // Route to generic spreadsheet query endpoint
            response = await fetch('/api/spreadsheet-query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                question: userMessage,
                sheetData: activeSheet,
                sheetIndex: 0,
              }),
              signal: abortController.signal,
            });
          }

          const result = await response.json();

          let assistantContent = '';

          if (result.type === 'clarification') {
            assistantContent = `🤔 **I need a bit more info:**\n\n${result.message}`;
          } else if (result.type === 'error') {
            assistantContent = `⚠️ ${result.message}`;
            if (result.code) {
              assistantContent += `\n\n<details>\n<summary>🔍 Show generated code</summary>\n\n\`\`\`javascript\n${result.code}\n\`\`\`\n</details>`;
            }
          } else if (result.type === 'scientific_answer') {
            // Scientific analysis result — embed as structured report marker
            const reportData = {
              result: result.result,
              experimentType: result.experimentType,
              instrumentDescription: result.instrumentDescription,
              dataQualityScore: result.dataQualityScore,
              explanation: result.explanation,
              code: result.code,
              executionTimeMs: result.executionTimeMs,
            };
            assistantContent = `🔬 **${result.experimentType} Scientific Analysis**\n\n${result.explanation || ''}`;
            assistantContent += `\n\n<!--SCIENTIFIC_REPORT:${JSON.stringify(reportData)}-->`;
          } else if (result.type === 'answer') {
            // Generic spreadsheet analysis result
            const formattedResult = typeof result.result === 'object'
              ? JSON.stringify(result.result, null, 2)
              : String(result.result);

            assistantContent = `📊 **Analysis Result:**\n\n${result.explanation || ''}\n\n`;

            // Render result as table if it's an array of objects
            if (Array.isArray(result.result) && result.result.length > 0 && typeof result.result[0] === 'object') {
              const keys = Object.keys(result.result[0]);
              assistantContent += `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n`;
              for (const row of result.result.slice(0, 50)) {
                assistantContent += `| ${keys.map(k => row[k] ?? '').join(' | ')} |\n`;
              }
            } else {
              assistantContent += `\`\`\`\n${formattedResult}\n\`\`\``;
            }

            // Chart data marker for chat-message.tsx to render
            if (result.chartData) {
              assistantContent += `\n\n<!--CHART_DATA:${JSON.stringify(result.chartData)}-->`;
            }

            // Trust layer: show reasoning
            if (result.code) {
              assistantContent += `\n\n<details>\n<summary>🔍 Show reasoning (${result.executionTimeMs || 0}ms)</summary>\n\n\`\`\`javascript\n${result.code}\n\`\`\`\n</details>`;
            }
          } else {
            assistantContent = result.result || result.message || 'Analysis complete.';
          }

          setMessages((prev) => {
            const newArr = [...prev];
            if (newArr.length > 0 && newArr[newArr.length - 1].role === 'assistant') {
              newArr[newArr.length - 1].content = assistantContent;
            }
            return newArr;
          });

          // Save thread
          if (user && threadId) {
            const finalMessages = [...messages, { role: 'user' as const, content: userMessage, attachments: currentAttachments.length > 0 ? currentAttachments : undefined }, { role: 'assistant' as const, content: assistantContent }];
            saveUserThread(user.id, { id: threadId, title: userMessage.slice(0, 60), messages: finalMessages, fileNames: files.map((f) => f.name), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            setThreads(getUserThreads(user.id));
          }

          setIsLoading(false);
          abortControllerRef.current = null;
          return;
        }
      }

      // --- REGULAR CHAT/RAG PATH ---
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      // Extract pre-fetched document chunks if draft matches final user message
      let prefetchedDocsPayload: any[] | undefined = undefined;
      if (prefetchCacheRef.current) {
        const cachedQuery = prefetchCacheRef.current.draftQuery.toLowerCase().trim();
        const currentQuery = userMessage.toLowerCase().trim();
        if (currentQuery.includes(cachedQuery) || cachedQuery.includes(currentQuery)) {
          prefetchedDocsPayload = prefetchCacheRef.current.candidateDocs;
        }
      }

      // Reset prefetch cache & state
      prefetchCacheRef.current = null;
      setIsPrefetched(false);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      if (prefetchAbortControllerRef.current) prefetchAbortControllerRef.current.abort();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          threadId,
          fileNames: files.map((f) => f.name),
          useLocalOffline: isOffline,
          offlineDocuments: offlineDocs,
          prefetchedDocs: prefetchedDocsPayload,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let done = false;
      let sseBuffer = '';

      while (!done) {
        const { done: chunkDone, value } = await reader.read();
        done = chunkDone;

        if (value) {
          clearTimeout(timeoutId); // Active stream connected — cancel timeout so long responses never abort midway
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const sseString = trimmed.slice('data: '.length);
            let sseEvent: any;
            try {
              sseEvent = JSON.parse(sseString);
            } catch {
              continue;
            }

            const { delta, event, data } = sseEvent;

            if (delta && typeof delta === 'string') {
              setMessages((prev) => {
                const newArr = [...prev];
                if (newArr.length > 0 && newArr[newArr.length - 1].role === 'assistant') {
                  newArr[newArr.length - 1].content += delta;
                  newArr[newArr.length - 1].sources = lastRetrievedDocsRef.current;
                }
                return newArr;
              });
            } else if (event === 'messages/partial') {
              if (Array.isArray(data)) {
                const lastObj = data[data.length - 1];
                if (lastObj?.type === 'ai') {
                  const partialContent = lastObj.content ?? '';

                  if (
                    typeof partialContent === 'string' &&
                    !partialContent.startsWith('{')
                  ) {
                    setMessages((prev) => {
                      const newArr = [...prev];
                      if (
                        newArr.length > 0 &&
                        newArr[newArr.length - 1].role === 'assistant'
                      ) {
                        newArr[newArr.length - 1].content = partialContent;
                        newArr[newArr.length - 1].sources =
                          lastRetrievedDocsRef.current;
                      }
                      return newArr;
                    });
                  }
                }
              }
            } else if (event === 'updates' && data) {
              if (
                data &&
                typeof data === 'object' &&
                'retrieveDocuments' in data &&
                data.retrieveDocuments &&
                Array.isArray(data.retrieveDocuments.documents)
              ) {
                const retrievedDocs = (data as RetrieveDocumentsNodeUpdates)
                  .retrieveDocuments.documents as PDFDocument[];
                lastRetrievedDocsRef.current = retrievedDocs;
              } else {
                lastRetrievedDocsRef.current = [];
              }
            }
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('[Insight AI Error]:', error);
      const isTimeout = error === 'REQUEST_TIMEOUT' || error?.name === 'AbortError';
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      setMessages((prev) => {
        const newArr = [...prev];
        if (newArr.length > 0 && newArr[newArr.length - 1].role === 'assistant') {
          if (isTimeout) {
            newArr[newArr.length - 1].content =
              '⏳ **Request Timed Out**: The AI model took longer than 35 seconds to complete your request.\n\n*Please try asking again, or simplify your prompt.*';
          } else if (isOffline) {
            newArr[newArr.length - 1].content =
              '📡 **Offline Mode Active**: You are currently offline without internet.\n\nTo answer queries 100% offline, please ensure your local Ollama AI model is started on your device:\n```bash\nollama run deepseek-r1:7b\n```\nOnce Ollama is running, Insight AI will answer all your document queries, tables, and flowcharts 100% offline!';
          } else {
            newArr[newArr.length - 1].content =
              `⚠️ **Something went wrong**: ${error instanceof Error ? error.message : String(error || 'Failed to process request')}. Please try again.`;
          }
        }
        return newArr;
      });

      if (!isTimeout) {
        toast({
          title: isOffline ? '📡 Offline Mode Active' : 'Error',
          description: error instanceof Error ? error.message : 'Failed to send message. Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const isFileSupported = (file: File): boolean => {
    if (ACCEPTED_MIME_TYPES.includes(file.type)) return true;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return [
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.csv', '.xlsx', '.xls',
      '.xlsm', '.xlsb', '.ods',
      '.md', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tiff'
    ].includes(ext);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const unsupportedFiles = selectedFiles.filter((f) => !isFileSupported(f));
    if (unsupportedFiles.length > 0) {
      toast({
        title: 'Unsupported file type',
        description: 'Supported formats: PDF, DOC, DOCX, PPT, PPTX, TXT, CSV, XLSX, XLS, PNG, JPG, WEBP, GIF, SVG',
        variant: 'destructive',
      });
      return;
    }

    // Supports files up to 2GB per file
    const MAX_ALLOWED_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    const oversizedFiles = selectedFiles.filter((f) => f.size > MAX_ALLOWED_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`).join(', ');
      toast({
        title: 'File exceeds 2GB limit',
        description: `Maximum file size is 2GB. These files are too large: ${names}.`,
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    const successfulFiles: File[] = [];
    const allParsedDocs: any[] = [];

    try {
      // Helper function to extract text on client side for large >3.5MB files
      const extractClientText = async (f: File): Promise<string> => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        if (['.txt', '.csv', '.md', '.json', '.svg', '.html', '.xml'].includes(ext)) {
          return await f.text();
        }

        // PPTX/DOCX: use JSZip on client for proper OOXML text extraction
        if (ext === '.pptx' || ext === '.docx') {
          try {
            const JSZip = (await import('jszip')).default;
            const ab = await f.arrayBuffer();
            const zip = await JSZip.loadAsync(ab);
            const textParts: string[] = [];

            if (ext === '.pptx') {
              const slideFiles = Object.keys(zip.files)
                .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
                .sort((a, b) => {
                  const nA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0');
                  const nB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0');
                  return nA - nB;
                });
              for (let i = 0; i < slideFiles.length; i++) {
                const xml = await zip.file(slideFiles[i])?.async('string');
                if (!xml) continue;
                const paras = xml.split(/<\/a:p>/gi);
                const lines: string[] = [];
                for (const block of paras) {
                  const runs = block.match(/<a:t>([^<]*)<\/a:t>/gi) || [];
                  const line = runs.map((t) => t.replace(/<[^>]+>/g, '')).join(' ').trim();
                  if (line) lines.push(line);
                }
                if (lines.length > 0) textParts.push(`--- Slide ${i + 1} ---\n${lines.join('\n')}`);
              }
            } else {
              // DOCX
              const docXml = await zip.file('word/document.xml')?.async('string');
              if (docXml) {
                const xmlBlocks = docXml.split(/<\/w:p>/gi);
                for (const block of xmlBlocks) {
                  const texts = block.match(/<w:t[^>]*>([^<]*)<\/w:t>/gi) || [];
                  const line = texts.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
                  if (line) textParts.push(line);
                }
              }
            }

            if (textParts.join('').trim().length > 10) {
              return textParts.join('\n');
            }
          } catch {
            // Fall through to binary extraction
          }
        }

        try {
          const ab = await f.arrayBuffer();
          const bytes = new Uint8Array(ab);
          let textChunks: string[] = [];
          let current = '';
          for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b >= 32 && b <= 126) {
              current += String.fromCharCode(b);
            } else {
              if (current.length > 3) textChunks.push(current);
              current = '';
            }
          }
          if (current.length > 3) textChunks.push(current);
          const cleanText = textChunks.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          return cleanText || `Document: ${f.name}\nExtracted content from ${f.name}`;
        } catch {
          return `Document: ${f.name}\nUploaded ${f.name} for AI context analysis.`;
        }
      };


      // Process each file (small or huge up to 2GB)
      for (const file of selectedFiles) {
        try {
          // If file is >3.5MB (e.g. 100MB+ up to 2GB), extract content on client side to bypass Vercel 4.5MB payload limit
          if (file.size > 3.5 * 1024 * 1024) {
            const fullText = await extractClientText(file);
            const response = await fetch('/api/ingest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                parsedDocuments: [{ text: fullText, filename: file.name }],
              }),
            });

            if (!response.ok) {
              throw new Error(`Failed to ingest ${file.name}`);
            }
            const data = await response.json();
            if (data.parsedDocuments && Array.isArray(data.parsedDocuments)) {
              allParsedDocs.push(...data.parsedDocuments);
            }
            successfulFiles.push(file);
            continue;
          }

          // Standard FormData upload for files <= 3.5MB or binary formats
          const formData = new FormData();
          formData.append('files', file);

          const response = await fetch('/api/ingest', {
            method: 'POST',
            body: formData,
          });

          // Robust error handling: Vercel may return non-JSON responses (e.g., 413 plain text)
          let data: any;
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            const textBody = await response.text();
            if (!response.ok) {
              throw new Error(
                response.status === 413
                  ? `File "${file.name}" is too large for direct upload (${(file.size / 1024 / 1024).toFixed(1)}MB). Please convert to TXT/PDF or split file.`
                  : `Server error (${response.status}): ${textBody.slice(0, 100)}`
              );
            }
            try {
              data = JSON.parse(textBody);
            } catch {
              data = { message: textBody };
            }
          }

          if (!response.ok) {
            throw new Error(data.error || `Failed to upload ${file.name}`);
          }

          if (data.parsedDocuments && Array.isArray(data.parsedDocuments)) {
            allParsedDocs.push(...data.parsedDocuments);
          }
          // Capture structured spreadsheet data for the analytics query agent
          if (data.spreadsheetData && typeof data.spreadsheetData === 'object') {
            setSpreadsheetSessions((prev) => ({ ...prev, ...data.spreadsheetData }));
          }
          successfulFiles.push(file);

          // Upload binary and metadata to Supabase Storage & DB
          try {
            const attFormData = new FormData();
            attFormData.append('file', file);
            attFormData.append('conversationId', threadId || 'default');
            attFormData.append('userId', user?.id || 'anonymous');

            const attRes = await fetch('/api/attachments/upload', {
              method: 'POST',
              body: attFormData,
            });

            if (attRes.ok) {
              const attData = await attRes.json();
              if (attData.success && attData.attachment) {
                pendingAttachmentsRef.current.push(attData.attachment);
              }
            }
          } catch (attErr) {
            console.warn('[Attachment Persistence Notice]', attErr);
          }
        } catch (fileError) {
          console.error(`Error uploading ${file.name}:`, fileError);
          toast({
            title: `Failed: ${file.name}`,
            description: fileError instanceof Error ? fileError.message : 'Upload failed for this file.',
            variant: 'destructive',
          });
        }
      }

      if (allParsedDocs.length > 0) {
        setOfflineDocs((prev) => [...prev, ...allParsedDocs]);
      }

      if (successfulFiles.length > 0) {
        const updatedFiles = [...files, ...successfulFiles];
        setFiles(updatedFiles);

        if (user && threadId) {
          const fileNamesList = updatedFiles.map((f) => f.name);
          const currentThread: ChatThread = {
            id: threadId,
            title: updatedFiles[0]?.name || 'Chat Conversation',
            messages,
            updatedAt: new Date().toISOString(),
            fileNames: fileNamesList,
            createdAt: ''
          };
          saveUserThread(user.id, currentThread);
          setThreads((prev) => {
            const idx = prev.findIndex((t) => t.id === threadId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = currentThread;
              return updated;
            }
            return [currentThread, ...prev];
          });
        }

        toast({
          title: 'Success',
          description: `${successfulFiles.length} file${successfulFiles.length > 1 ? 's' : ''} uploaded and indexed successfully`,
          variant: 'default',
        });
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error ? error.message : 'Failed to upload files. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveFile = (fileToRemove: File) => {
    setFiles(files.filter((file) => file !== fileToRemove));
    toast({
      title: 'File removed',
      description: `${fileToRemove.name} has been removed`,
      variant: 'default',
    });
  };

  // Handle Returning to Home Dashboard
  const handleReturnHome = () => {
    setMessages([]);
    const newId = crypto.randomUUID();
    setThreadId(newId);
  };

  const cheerfulGreeting = getCheerfulGreeting(user?.displayName, user?.isGuest);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/20">
      {/* PWA Auto-Update Notification Toast */}
      <PWAUpdateToast />

      {/* Voice Assistant Siri/Alexa Glowing Modal */}
      <VoiceAssistantModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        hasActiveDocuments={files.length > 0 || offlineDocs.length > 0}
        onTriggerUpload={() => fileInputRef.current?.click()}
        onNewChat={handleNewChat}
        onOpenHistory={() => setIsSidebarOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onInstallApp={handleInstallApp}
        onAskDocumentQuestion={(question) => {
          setInput(question);
          setTimeout(() => {
            const form = document.getElementById('chat-input-form') as HTMLFormElement;
            if (form) form.requestSubmit();
          }, 200);
        }}
        onSendChatMessage={handleVoiceChatMessage}
      />

      {/* History Sidebar Component */}
      <HistorySidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        user={user}
        threads={threads}
        activeThreadId={threadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
        onDeleteThread={handleDeleteThread}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
        uploadedFiles={files}
      />

      {/* Auth Modal Component */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(newUser) => {
          setUser(newUser);
          loadThreadsForUser(newUser.id);
          toast({
            title: `Welcome back, ${newUser.displayName || 'User'}! ✨`,
            description: 'You are signed in. Your chat & file history is restored.',
          });
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-slate-200/80 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {/* Chat History button */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800"
                  onClick={() => setIsSidebarOpen(true)}
                  title="Open Chat & File History"
                >
                  <History className="w-5 h-5" />
                </Button>
              </div>

              {/* Clickable Brand Logo — returns to Home Dashboard & secret triple-click Admin trigger */}
              <div
                className="flex items-center gap-2.5 cursor-pointer group"
                onClick={handleSecretLogoClick}
                title="Return to Home Dashboard"
              >
                <img
                  src="/title.png"
                  alt="Insight Logo"
                  className="w-9 h-9 object-contain rounded-xl shadow-md group-hover:scale-105 transition-transform duration-200"
                />
                <div>
                  <h1 className="text-lg font-black tracking-tight flex items-center gap-1">
                    <span className="gradient-text">Insight</span>
                  </h1>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hidden sm:block">
                    Extract intelligence from PDFs
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Glowing Icon-Only Siri/Alexa Voice Assistant Trigger */}
              <button
                className="p-1.5 px-2 rounded-2xl border border-cyan-400/60 bg-gradient-to-r from-cyan-500/20 via-fuchsia-500/20 to-indigo-500/20 hover:from-cyan-500/35 hover:to-indigo-500/35 shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center cursor-pointer"
                onClick={() => setIsVoiceModalOpen(true)}
                title="Activate Insight Voice Siri/Alexa Assistant"
              >
                <AnimatedVoiceLogo size="sm" />
              </button>

              {/* Return to Home Dashboard button (when in active chat) */}
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-xl text-xs font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-all duration-200"
                  onClick={handleReturnHome}
                  title="Return to Home Welcome Dashboard"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Home Dashboard</span>
                </Button>
              )}

              {/* User Profile Badge & Header Sign Out */}
              {user && !user.isGuest ? (
                <div className="flex items-center gap-1.5">
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
                    onClick={() => setIsAuthModalOpen(true)}
                  >
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold">
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">
                      {user.displayName.split(' ')[0]}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-colors"
                    onClick={handleSignOut}
                    title="Sign Out of Account"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-xl text-xs font-bold"
                  onClick={() => setIsAuthModalOpen(true)}
                >
                  <User className="h-3.5 w-3.5" />
                  Sign In
                </Button>
              )}

              {/* Upload button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept={ACCEPTED_FILE_TYPES}
                multiple
                className="hidden"
                id="file-upload-header"
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all duration-200"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Upload Document</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8">
        {!user || user.isGuest ? (
          /* FIRST DASHBOARD: SIGN IN LANDING DASHBOARD */
          <div className="flex-1 flex flex-col items-center justify-center py-10 gap-6 animate-fade-in">
            <div className="text-center space-y-4 max-w-xl">
              <img
                src="/title.png"
                alt="Insight Logo"
                className="w-20 h-20 object-contain mx-auto shadow-2xl rounded-3xl p-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800 hover:scale-105 transition-transform duration-300 cursor-pointer"
                onClick={handleSecretLogoClick}
                title="Triple click logo for Secret Admin"
              />

              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 dark:bg-indigo-950/40 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold tracking-wide uppercase">
                <Sparkles className="w-3.5 h-3.5" />
                Insight AI Engine • Sign In Required
              </div>

              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Extract Intelligence from PDFs & Documents
              </h2>

              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                Please sign in or create an account with your Gmail address to unlock instant document Q&A, Markdown tables, Mermaid flowcharts, and account-saved chat history.
              </p>
            </div>

            {/* Embedded Sign In / Create Account Landing Card */}
            <div className="w-full max-w-md p-6 rounded-2xl glass-card border border-indigo-100 dark:border-indigo-900/50 shadow-xl space-y-4 text-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
              <Button
                type="button"
                className="w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:to-pink-700 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 transition-all gap-2"
                onClick={() => setIsAuthModalOpen(true)}
              >
                <User className="w-4 h-4" />
                Sign In or Create Account
              </Button>

              <div className="grid grid-cols-3 gap-2 pt-2 text-[11px] text-muted-foreground font-semibold">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                  📄 PDFs & Word
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                  📊 Tables & Flowcharts
                </div>
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800">
                  🔒 100% Saved History
                </div>
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          /* Dashboard / Welcome Screen */
          <div className="flex-1 flex flex-col items-center justify-center py-12 gap-8">
            {/* Cheerful User Greeting Hero Section */}
            <div className="text-center space-y-4 animate-fade-in">
              <img
                src="/title.png"
                alt="Insight Logo"
                className="w-16 h-16 sm:w-20 sm:h-20 object-contain mx-auto shadow-xl rounded-2xl p-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/80 dark:border-slate-800 hover:scale-105 transition-transform duration-300"
              />

              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 dark:bg-indigo-950/40 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold tracking-wide uppercase mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                Insight AI Engine • Fast & Accurate
              </div>
              
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                {cheerfulGreeting}
              </h2>

              <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
                Upload PDF, DOC, PPT, Excel, TXT, or Image files (PNG, JPG, etc.). Insight analyzes your files and generates accurate answers, tables, and Mermaid flowcharts.
              </p>
            </div>

            {/* Feature Cards — Interactive clickable shortcuts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <div
                className="group glass-card rounded-2xl p-5 text-center hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300 hover:-translate-y-1 cursor-pointer active:scale-95"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                  <Upload className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-sm mb-1">Universal Uploads</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  PDF, DOCX, PPTX, Excel, TXT & Images (PNG, JPG)
                </p>
              </div>

              <div
                className="group glass-card rounded-2xl p-5 text-center hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-300 hover:-translate-y-1 cursor-pointer active:scale-95"
                onClick={() => {
                  chatInputRef.current?.focus();
                  chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform duration-300">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-sm mb-1">Ask Anything</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Instant document Q&A with sub-second speed
                </p>
              </div>

              <div
                className="group glass-card rounded-2xl p-5 text-center hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-300 hover:-translate-y-1 cursor-pointer active:scale-95"
                onClick={() => {
                  setInput('Summarize the key insights from my uploaded document');
                  setTimeout(() => chatInputRef.current?.focus(), 100);
                }}
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-sm mb-1">Accurate Answers</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Grounded facts with source text citations
                </p>
              </div>
            </div>

            {/* Uploaded Files Library */}
            {files.length > 0 && (
              <div className="w-full max-w-2xl animate-fade-in">
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Uploaded Documents ({files.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {files.map((file, index) => (
                    <FilePreview
                      key={`${file.name}-${index}`}
                      file={file}
                      onRemove={() => handleRemoveFile(file)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Example Prompts */}
            <div className="w-full max-w-2xl animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <ExamplePrompts onPromptSelect={setInput} />
            </div>
          </div>
        ) : (
          /* Chat Messages */
          <div className="flex-1 w-full space-y-4 py-6 pb-36">
            {messages.map((message, i) => (
              <div key={i} className="animate-fade-in">
                <ChatMessage message={message} />
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Fixed Input Bar (Unlocked only when user is signed in) */}
      {user && !user.isGuest && (
        <div className="fixed bottom-0 left-0 right-0 z-40">
          <div className="glass-card border-t border-slate-200/80 dark:border-slate-800">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              {/* Uploaded file chips */}
              {files.length > 0 && messages.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-900 dark:text-indigo-300"
                    >
                      <FileText className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{file.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSubmit} className="relative">
                {isPrefetched && (
                  <div className="absolute -top-7 right-3 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20 backdrop-blur-sm animate-pulse">
                    <Zap className="h-3 w-3 fill-emerald-500 text-emerald-500" />
                    <span>⚡ Context pre-warmed</span>
                  </div>
                )}
                <div className="flex items-center gap-2 p-1.5 rounded-2xl border bg-white dark:bg-slate-900 shadow-lg shadow-black/5 hover:shadow-xl hover:shadow-black/10 transition-shadow duration-300 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-300">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    title="Upload document (PDF, DOC, DOCX, TXT)"
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </Button>
                  <Input
                    ref={chatInputRef}
                    value={input}
                    onChange={(e) => handleInputChangeWithPrefetch(e.target.value)}
                    placeholder={
                      isUploading
                        ? 'Uploading document...'
                        : 'Ask anything about your documents...'
                    }
                    className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 bg-transparent text-sm placeholder:text-muted-foreground/60"
                    disabled={isUploading || isLoading || !threadId}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/30 transition-all duration-200 disabled:opacity-40 disabled:shadow-none"
                    disabled={
                      !input.trim() || isUploading || isLoading || !threadId
                    }
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Admin Portal Control Center Modal */}
      <AdminModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
      />
    </div>
  );
}
