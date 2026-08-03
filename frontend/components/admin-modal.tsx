'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getAllAdminData,
  getAllAdminDataFromCloud,
  AdminUserData,
  ChatThread,
} from '@/lib/history-store';
import { ChatMessage } from '@/components/chat-message';
import {
  ShieldAlert,
  Users,
  MessageSquare,
  FileText,
  Key,
  Eye,
  EyeOff,
  Search,
  ChevronRight,
  X,
  Lock,
  AlertCircle,
  Unlock,
  ArrowLeft,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  Paperclip,
  CheckCircle,
} from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ADMIN_SECRET_PASSWORD = 'Jithender.7';

function getFileIcon(filename: string) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tiff'].includes(ext)) {
    return <ImageIcon className="w-4 h-4 text-purple-500 shrink-0" />;
  }
  if (['.xls', '.xlsx', '.csv'].includes(ext)) {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (['.ppt', '.pptx'].includes(ext)) {
    return <Presentation className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-indigo-500 shrink-0" />;
}

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [adminPasscode, setAdminPasscode] = useState<string>('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'users' | 'inspector'>('users');
  const [adminData, setAdminData] = useState<AdminUserData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAdminPasscode('');
      setPasscodeError(null);
      setIsAuthenticated(false);
      setActiveTab('users');

      // PRIMARY: Fetch from Supabase cloud DB (source of truth — survives redeployments!)
      getAllAdminDataFromCloud().then((cloudData) => {
        if (cloudData.length > 0) {
          setAdminData(cloudData);
          setSelectedUser(cloudData[0]);
          if (cloudData[0].threads.length > 0) {
            setActiveThreadId(cloudData[0].threads[0].id);
          }
        } else {
          // FALLBACK: If cloud returns empty (network error), use local cache
          const localData = getAllAdminData();
          setAdminData(localData);
          if (localData.length > 0) {
            setSelectedUser(localData[0]);
            if (localData[0].threads.length > 0) {
              setActiveThreadId(localData[0].threads[0].id);
            }
          }
        }
      }).catch(() => {
        // Network failure fallback: use local cache
        const localData = getAllAdminData();
        setAdminData(localData);
        if (localData.length > 0) {
          setSelectedUser(localData[0]);
          if (localData[0].threads.length > 0) {
            setActiveThreadId(localData[0].threads[0].id);
          }
        }
      });
    } else {
      setIsAuthenticated(false);
    }
  }, [isOpen]);

  // Update active thread whenever selected user changes
  useEffect(() => {
    if (selectedUser && selectedUser.threads.length > 0) {
      setActiveThreadId(selectedUser.threads[0].id);
    } else {
      setActiveThreadId(null);
    }
  }, [selectedUser]);

  const handleAdminAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError(null);

    if (adminPasscode === ADMIN_SECRET_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      setPasscodeError('Incorrect admin password. Access denied.');
    }
  };

  const handleCloseAndLock = () => {
    setIsAuthenticated(false);
    setAdminPasscode('');
    setPasscodeError(null);
    onClose();
  };

  const togglePasswordVisibility = (username: string) => {
    setShowPasswords((prev) => ({
      ...prev,
      [username]: !prev[username],
    }));
  };

  const filteredData = adminData.filter((item) => {
    const query = searchQuery.toLowerCase();
    return (
      item.account.displayName.toLowerCase().includes(query) ||
      item.account.username.toLowerCase().includes(query) ||
      (item.account.email && item.account.email.toLowerCase().includes(query))
    );
  });

  const totalUsers = adminData.length;
  const totalThreads = adminData.reduce((acc, curr) => acc + curr.threads.length, 0);
  const totalFiles = adminData.reduce((acc, curr) => {
    const fileCount = curr.threads.reduce(
      (tAcc, tCurr) => tAcc + (tCurr.fileNames ? tCurr.fileNames.length : 0),
      0,
    );
    return acc + fileCount;
  }, 0);

  const activeThread = selectedUser?.threads.find((t) => t.id === activeThreadId) || selectedUser?.threads[0];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCloseAndLock();
        }
      }}
    >
      <DialogContent className="sm:max-w-[950px] w-[96vw] max-h-[92vh] p-0 overflow-hidden border border-indigo-100 dark:border-indigo-900/50 shadow-2xl rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl flex flex-col">
        {/* PASSCODE SECURITY GATE VIEW */}
        {!isAuthenticated ? (
          <div className="p-8 space-y-6 max-w-[420px] mx-auto w-full text-center animate-in fade-in py-10">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto shadow-xl shadow-amber-500/25 border border-amber-300/40">
              <Lock className="w-8 h-8 text-white" />
            </div>

            <div>
              <DialogTitle className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                Admin Password Required
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Enter your Admin Password to view registered user accounts, passwords, uploaded files, and complete chat logs.
              </p>
            </div>

            {/* Error Alert */}
            {passcodeError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{passcodeError}</span>
              </div>
            )}

            <form onSubmit={handleAdminAuthSubmit} className="space-y-4 text-left">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Admin Password
                </Label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="Enter password"
                    className="pl-9 h-11 rounded-xl border-slate-200 focus-visible:ring-indigo-500 font-mono text-sm"
                    value={adminPasscode}
                    onChange={(e) => setAdminPasscode(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-11 rounded-xl text-xs font-bold gap-1.5"
                  onClick={handleCloseAndLock}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Dashboard
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-600 via-orange-600 to-indigo-600 hover:from-amber-700 hover:to-indigo-700 text-white text-xs font-bold shadow-lg shadow-amber-500/25 transition-all gap-2"
                >
                  Unlock Admin
                  <Unlock className="w-3.5 h-3.5" />
                </Button>
              </div>
            </form>
          </div>
        ) : (
          /* UNLOCKED ADMIN CONTROL CENTER VIEW */
          <>
            {/* Admin Header */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 p-4 sm:p-5 text-white flex items-center justify-between border-b border-indigo-900/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <ShieldAlert className="w-5 h-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
                    Insight Admin Control Center
                  </DialogTitle>
                  <p className="text-xs text-indigo-200/80 font-medium">
                    User Directory, Credentials & Complete Chat & File History Inspector
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 rounded-xl bg-white/10 hover:bg-rose-600 text-white border-white/20 hover:border-rose-500 text-xs font-bold gap-1.5 transition-all"
                onClick={handleCloseAndLock}
              >
                <X className="w-3.5 h-3.5" />
                Close Admin Portal
              </Button>
            </div>

            {/* Global Summary Stat Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-50/80 dark:bg-slate-950/40 border-b border-slate-200/60 dark:border-slate-800/60 shrink-0">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Users</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100">{totalUsers}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Chat Threads</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100">{totalThreads}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Uploaded Files & Images</p>
                  <p className="text-lg font-black text-slate-800 dark:text-slate-100">{totalFiles}</p>
                </div>
              </div>
            </div>

            {/* Main Tabbed Area */}
            <div className="flex-1 overflow-hidden p-4 min-h-0 flex flex-col">
              <Tabs
                value={activeTab}
                onValueChange={(val) => setActiveTab(val as 'users' | 'inspector')}
                className="h-full flex flex-col min-h-0"
              >
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <TabsList className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    <TabsTrigger value="users" className="rounded-lg text-xs font-bold px-4 py-1.5">
                      <Users className="w-3.5 h-3.5 mr-1.5" />
                      User Directory ({filteredData.length})
                    </TabsTrigger>
                    <TabsTrigger value="inspector" className="rounded-lg text-xs font-bold px-4 py-1.5">
                      <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                      Full Chat & File Inspector {selectedUser ? `(${selectedUser.account.displayName})` : ''}
                    </TabsTrigger>
                  </TabsList>

                  <div className="relative w-60">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="Search user name..."
                      className="pl-8 h-8 rounded-lg text-xs border-slate-200"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                {/* TAB 1: USERS DIRECTORY & PASSWORDS */}
                <TabsContent value="users" className="flex-1 overflow-y-auto m-0 min-h-0">
                  {filteredData.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">No registered users found.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                        <thead className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 font-bold uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-3 text-left">User Name & ID</th>
                            <th className="px-4 py-3 text-left">Username</th>
                            <th className="px-4 py-3 text-left">Stored Password</th>
                            <th className="px-4 py-3 text-left">Joined Date</th>
                            <th className="px-4 py-3 text-center">Chat Sessions</th>
                            <th className="px-4 py-3 text-right">Inspect History</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
                          {filteredData.map((item) => {
                            const isShow = showPasswords[item.account.username];
                            return (
                              <tr
                                key={item.account.id}
                                className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors"
                              >
                                <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                                      {item.account.displayName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="font-bold text-xs">{item.account.displayName}</p>
                                      <p className="text-[10px] text-slate-400">{item.account.email}</p>
                                    </div>
                                  </div>
                                </td>

                                <td className="px-4 py-3 font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                                  @{item.account.username}
                                </td>

                                <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 font-bold text-[11px]">
                                      {isShow ? item.plainPassword : '••••••••'}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 rounded text-slate-400 hover:text-indigo-600"
                                      onClick={() => togglePasswordVisibility(item.account.username)}
                                      title="Toggle Password View"
                                    >
                                      {isShow ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </Button>
                                  </div>
                                </td>

                                <td className="px-4 py-3 text-slate-500">
                                  {new Date(item.account.createdAt).toLocaleDateString()}
                                </td>

                                <td className="px-4 py-3 text-center">
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[10px]">
                                    {item.threads.length} Threads
                                  </span>
                                </td>

                                <td className="px-4 py-3 text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] font-bold gap-1.5 rounded-lg border-indigo-200 text-indigo-600 hover:bg-indigo-50 shadow-sm"
                                    onClick={() => {
                                      setSelectedUser(item);
                                      if (item.threads.length > 0) {
                                        setActiveThreadId(item.threads[0].id);
                                      }
                                      setActiveTab('inspector');
                                    }}
                                  >
                                    See Chat & Files
                                    <ChevronRight className="w-3 h-3" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>

                {/* TAB 2: CHAT & FILE HISTORY INSPECTOR */}
                <TabsContent value="inspector" className="flex-1 overflow-hidden m-0 flex flex-col md:flex-row gap-4 min-h-0">
                  {/* Left User Selection Sidebar */}
                  <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 pr-0 md:pr-3 pb-2 md:pb-0 overflow-y-auto space-y-2 shrink-0 max-h-48 md:max-h-full">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">
                      Registered Accounts
                    </p>
                    {filteredData.map((item) => {
                      const isSelected = selectedUser?.account.id === item.account.id;
                      return (
                        <div
                          key={item.account.id}
                          className={`p-3 rounded-xl cursor-pointer border transition-all ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold shadow-sm'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50'
                          }`}
                          onClick={() => {
                            setSelectedUser(item);
                            if (item.threads.length > 0) {
                              setActiveThreadId(item.threads[0].id);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                              {item.account.displayName.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs truncate font-bold">{item.account.displayName}</p>
                              <p className="text-[10px] text-slate-400">@{item.account.username} • {item.threads.length} chats</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Right Complete Chat Thread & File Inspector Area */}
                  <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 dark:bg-slate-950/30 rounded-xl p-3 border border-slate-200 dark:border-slate-800 min-h-0">
                    {selectedUser ? (
                      <div className="flex-1 flex flex-col overflow-hidden space-y-3 min-h-0">
                        {/* Account Info Header */}
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 shrink-0">
                          <div>
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                              <span>{selectedUser.account.displayName}</span>
                              <span className="text-xs font-semibold text-indigo-600">(@{selectedUser.account.username})</span>
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              Email: <strong className="text-slate-700 dark:text-slate-300">{selectedUser.account.email}</strong> • Password: <strong className="font-mono text-indigo-600">{selectedUser.plainPassword}</strong>
                            </p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                            {selectedUser.threads.length} Total Sessions
                          </span>
                        </div>

                        {selectedUser.threads.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-400">
                            This user has not started any chat conversations yet.
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col overflow-hidden min-h-0 space-y-3">
                            {/* Thread Sessions Selector Buttons */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
                                Select Chat Session:
                              </span>
                              {selectedUser.threads.map((t) => {
                                const isCurrent = t.id === activeThread?.id;
                                return (
                                  <button
                                    key={t.id}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                                      isCurrent
                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                                    }`}
                                    onClick={() => setActiveThreadId(t.id)}
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    <span>{t.title || 'Chat Thread'}</span>
                                    {t.fileNames && t.fileNames.length > 0 && (
                                      <span className="ml-1 px-1.5 py-0.2 rounded bg-white/20 text-[10px]">
                                        {t.fileNames.length} files
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Active Selected Thread Content Box */}
                            {activeThread && (
                              <div className="flex-1 flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-md min-h-0">
                                {/* Thread Title Bar & Uploaded Files Banner */}
                                <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 shrink-0 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <MessageSquare className="w-4 h-4 text-indigo-600" />
                                      <h4 className="text-xs font-black text-slate-800 dark:text-slate-100">
                                        {activeThread.title || 'Chat Session'}
                                      </h4>
                                    </div>
                                    <span className="text-[10px] text-slate-400">
                                      Updated: {new Date(activeThread.updatedAt).toLocaleString()}
                                    </span>
                                  </div>

                                  {/* Uploaded Files & Images Attached to this Session */}
                                  {activeThread.fileNames && activeThread.fileNames.length > 0 && (
                                    <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                                        <Paperclip className="w-3 h-3 text-indigo-500" />
                                        Attached Files & Images ({activeThread.fileNames.length}):
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {activeThread.fileNames.map((fn, idx) => (
                                          <div
                                            key={idx}
                                            className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                                          >
                                            {getFileIcon(fn)}
                                            <span className="truncate max-w-[200px]">{fn}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Full Scrollable Messages List */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                                  {activeThread.messages.map((m, mIdx) => (
                                    <ChatMessage key={mIdx} message={m} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Select a user from the left list to inspect their complete chat history & uploaded files.
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
