'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ChatThread, UserProfile } from '@/lib/history-store';
import {
  MessageSquare,
  Plus,
  Trash2,
  FileText,
  Clock,
  Sparkles,
  LogOut,
  ChevronRight,
  Shield,
  Bot,
  X,
  Download,
} from 'lucide-react';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
  onOpenAuth: () => void;
  onSignOut: () => void;
  uploadedFiles: File[];
  onOpenInstallModal?: () => void;
}

export function HistorySidebar({
  isOpen,
  onClose,
  user,
  threads,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onDeleteThread,
  onOpenAuth,
  onSignOut,
  uploadedFiles,
  onOpenInstallModal,
}: HistorySidebarProps) {
  if (!isOpen) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800 shadow-2xl flex flex-col transition-all duration-300 animate-in slide-in-from-left">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/title.png"
            alt="Insight Logo"
            className="w-8 h-8 object-contain rounded-xl shadow-md"
          />
          <div>
            <h2 className="text-base font-black tracking-tight text-slate-800 dark:text-slate-100">
              Insight
            </h2>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Chat & PDF History
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold shadow-md shadow-indigo-500/20 gap-2 transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          New Chat Session
        </Button>
      </div>

      {/* Main History Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Past Chat Sessions */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Chat History ({threads.length})
            </span>
          </div>

          {threads.length === 0 ? (
            <div className="p-4 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-200 dark:border-slate-800">
              <MessageSquare className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                No past chats yet.
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Upload a PDF and ask a question to start.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {threads.map((t) => {
                const isActive = t.id === activeThreadId;
                return (
                  <div
                    key={t.id}
                    className={`group relative flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-200/60 dark:border-indigo-800/50 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                    }`}
                    onClick={() => {
                      onSelectThread(t.id);
                      onClose();
                    }}
                  >
                    <MessageSquare className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate font-medium">{t.title || 'Chat Session'}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {t.messages.length} messages • {new Date(t.updatedAt).toLocaleDateString()}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteThread(t.id);
                      }}
                      title="Delete thread"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Uploaded Documents Library */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Uploaded Documents ({uploadedFiles.length})
            </span>
          </div>

          {uploadedFiles.length === 0 ? (
            <div className="p-3 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
              <p className="text-xs text-slate-400">No documents active in this session.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {uploadedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-2 p-2 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs font-medium text-indigo-700 dark:text-indigo-300"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                  <span className="truncate flex-1">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User Footer Profile */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        {user ? (
          <div className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-sm">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">
                  {user.displayName}
                </p>
                <p className="text-[10px] text-slate-400 truncate">@{user.username}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
              onClick={onSignOut}
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            onClick={onOpenAuth}
            className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs gap-2"
          >
            <Shield className="w-3.5 h-3.5" />
            Sign In / Register
          </Button>
        )}
      </div>
    </aside>
  );
}
