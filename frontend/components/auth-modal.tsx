'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  UserProfile,
  authenticateUserAccount,
  registerUserAccount,
} from '@/lib/history-store';
import { Sparkles, Lock, Mail, User, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserProfile) => void;
}

export function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [signInUsername, setSignInUsername] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  const [signUpName, setSignUpName] = useState('');
  const [signUpUsername, setSignUpUsername] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const result = await authenticateUserAccount(signInUsername, signInPassword);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    if (result.user) {
      triggerWelcomeEmail(result.user.displayName, result.user.email || signInUsername);
      onLoginSuccess(result.user);
      onClose();
    }
  };

  const triggerWelcomeEmail = async (displayName: string, email: string) => {
    try {
      await fetch('/api/send-welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email }),
      });
    } catch (err) {
      console.error('Failed to dispatch welcome email:', err);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const result = await registerUserAccount(signUpName, signUpUsername, signUpPassword);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    if (result.user) {
      triggerWelcomeEmail(result.user.displayName, result.user.email || signUpUsername);
      onLoginSuccess(result.user);
      onClose();
    }
  };

  const resetAllStates = () => {
    setErrorMessage(null);
    setSignInUsername('');
    setSignInPassword('');
    setSignUpName('');
    setSignUpUsername('');
    setSignUpPassword('');
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetAllStates();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden border border-indigo-100 dark:border-indigo-900/50 shadow-2xl rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl">
        {/* Top Header Banner */}
        <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-6 text-white text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.2),transparent)] pointer-events-none" />
          <img
            src="/title.png"
            alt="Insight Logo"
            className="w-14 h-14 object-contain rounded-2xl p-1.5 bg-white/20 backdrop-blur-md border border-white/30 mx-auto mb-3 shadow-lg"
          />
          <DialogTitle className="text-2xl font-black tracking-tight text-white mb-1">
            Insight
          </DialogTitle>
          <p className="text-xs font-medium text-indigo-100 uppercase tracking-widest flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Extract intelligence from PDFs
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* Error Message Box */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v as any);
              setErrorMessage(null);
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              <TabsTrigger value="signin" className="rounded-lg text-xs font-bold py-2">
                Sign In
              </TabsTrigger>
              <TabsTrigger value="signup" className="rounded-lg text-xs font-bold py-2">
                Create Account
              </TabsTrigger>
            </TabsList>

            {/* Sign In Form */}
            <TabsContent value="signin" className="mt-4 space-y-4">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Gmail Address
                  </Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="user@gmail.com"
                      className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                      value={signInUsername}
                      onChange={(e) => setSignInUsername(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all duration-200 gap-2 mt-2"
                >
                  Sign In to Insight
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </form>
            </TabsContent>

            {/* Sign Up Form */}
            <TabsContent value="signup" className="mt-4 space-y-4">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Full Name
                  </Label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="e.g. Thanoj Reddy"
                      className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                      value={signUpName}
                      onChange={(e) => setSignUpName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Gmail Address
                  </Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="user@gmail.com"
                      className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                      value={signUpUsername}
                      onChange={(e) => setSignUpUsername(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="Choose a password"
                      className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold shadow-lg shadow-purple-500/25 transition-all duration-200 gap-2 mt-2"
                >
                  Create Account
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
