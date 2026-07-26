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
  saveUser,
  authenticateUserAccount,
  registerUserAccount,
} from '@/lib/history-store';
import { Sparkles, Bot, Lock, Mail, User, ArrowRight, CheckCircle2, AlertCircle, ChevronRight, UserPlus, ArrowLeft, KeyRound, RefreshCw } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserProfile) => void;
}

const SAMPLE_GOOGLE_ACCOUNTS: UserProfile[] = [
  {
    id: 'google_jithender',
    username: 'jithender_reddy',
    displayName: 'Jithender Reddy',
    email: 'jithender.reddy@gmail.com',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  },
  {
    id: 'google_thanoj',
    username: 'thanoj_reddy',
    displayName: 'Thanoj Reddy',
    email: 'thanoj.reddy@gmail.com',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  },
  {
    id: 'google_venutheja',
    username: 'venu_theja',
    displayName: 'Venu Theja',
    email: 'venutheja@gmail.com',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  },
];

export function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Google Flow States
  const [showGooglePicker, setShowGooglePicker] = useState<boolean>(false);
  const [showCustomGoogleInput, setShowCustomGoogleInput] = useState<boolean>(false);
  
  // OTP Verification States
  const [showOtpView, setShowOtpView] = useState<boolean>(false);
  const [generatedOtp, setGeneratedOtp] = useState<string>('');
  const [enteredOtp, setEnteredOtp] = useState<string>('');
  const [pendingUser, setPendingUser] = useState<UserProfile | null>(null);

  // Form states
  const [signInUsername, setSignInUsername] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  const [signUpName, setSignUpName] = useState('');
  const [signUpUsername, setSignUpUsername] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');

  // Custom Google account state
  const [customGoogleName, setCustomGoogleName] = useState('');
  const [customGoogleEmail, setCustomGoogleEmail] = useState('');

  const isValidGmail = (email: string): boolean => {
    const trimmed = email.trim().toLowerCase();
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(trimmed);
  };

  const sendOtpForGmail = async (userToVerify: UserProfile) => {
    if (!userToVerify.email || !isValidGmail(userToVerify.email)) {
      setErrorMessage('Invalid Gmail address. Please enter a valid @gmail.com email.');
      return;
    }

    setErrorMessage(null);
    // Generate 6-digit secret OTP verification code
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(newOtp);
    setPendingUser(userToVerify);
    setEnteredOtp('');
    setShowOtpView(true);

    // Dispatch secret OTP code email asynchronously to Gmail address
    try {
      await fetch('/api/send-otp-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userToVerify.email,
          otpCode: newOtp,
          displayName: userToVerify.displayName,
        }),
      });
    } catch (err) {
      console.error('Failed to dispatch OTP email:', err);
    }
  };

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const result = authenticateUserAccount(signInUsername, signInPassword);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    if (result.user) {
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

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const result = registerUserAccount(signUpName, signUpUsername, signUpPassword);
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

  const handleSelectGoogleAccount = (selectedAccount: UserProfile) => {
    sendOtpForGmail(selectedAccount);
  };

  const handleCustomGoogleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const email = customGoogleEmail.trim().toLowerCase();
    if (!isValidGmail(email)) {
      setErrorMessage('Invalid Gmail address. Please enter a valid @gmail.com email.');
      return;
    }

    const displayName = customGoogleName.trim() || email.split('@')[0];
    const username = email.split('@')[0].replace(/\s+/g, '_');

    const customAccount: UserProfile = {
      id: `user_${username}`,
      username,
      displayName,
      email,
    };

    sendOtpForGmail(customAccount);
  };

  const handleVerifyOtpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (enteredOtp.trim() !== generatedOtp) {
      setErrorMessage('Invalid OTP code. Please check your verification code and try again.');
      return;
    }

    if (pendingUser && pendingUser.email) {
      const { registerOrLoginGoogleAccount } = require('@/lib/history-store');
      const authResult = registerOrLoginGoogleAccount(pendingUser.email, pendingUser.displayName);
      
      triggerWelcomeEmail(authResult.user.displayName, authResult.user.email || pendingUser.email);
      onLoginSuccess(authResult.user);
      resetAllStates();
      onClose();
    }
  };

  const handleResendOtp = () => {
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(newOtp);
    setEnteredOtp('');
    setErrorMessage('New OTP code generated!');
  };

  const resetAllStates = () => {
    setShowGooglePicker(false);
    setShowCustomGoogleInput(false);
    setShowOtpView(false);
    setErrorMessage(null);
    setGeneratedOtp('');
    setEnteredOtp('');
    setPendingUser(null);
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
        {/* OTP VERIFICATION VIEW */}
        {showOtpView ? (
          <div className="p-6 space-y-5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                  <KeyRound className="w-4 h-4 text-indigo-600" />
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Gmail Verification
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 gap-1"
                onClick={() => setShowOtpView(false)}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            </div>

            <div className="text-center space-y-1">
              <DialogTitle className="text-xl font-black text-slate-900 dark:text-slate-100">
                Enter Verification OTP
              </DialogTitle>
              <p className="text-xs text-slate-500">
                A 6-digit code was sent to <strong className="text-indigo-600">{pendingUser?.email}</strong>
              </p>
            </div>

            {/* DEMO OTP NOTICE BADGE */}
            <div className="p-3.5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-center">
              <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-widest mb-1">
                Gmail Verification Code
              </p>
              <div className="text-2xl font-black tracking-widest text-indigo-700 dark:text-indigo-300 font-mono">
                {generatedOtp}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Enter this 6-digit OTP code below to complete sign-in.
              </p>
            </div>

            {/* Error Message Box */}
            {errorMessage && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* OTP Entry Form */}
            <form onSubmit={handleVerifyOtpSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  6-Digit OTP Code
                </Label>
                <Input
                  type="text"
                  maxLength={6}
                  placeholder="e.g. 849201"
                  className="rounded-xl border-slate-200 text-center text-lg font-mono tracking-widest font-bold focus-visible:ring-indigo-500 h-12"
                  value={enteredOtp}
                  onChange={(e) => setEnteredOtp(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all duration-200 gap-2"
              >
                Verify & Sign In
                <CheckCircle2 className="w-4 h-4" />
              </Button>
            </form>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                className="text-slate-400 hover:text-indigo-600 font-semibold flex items-center gap-1"
                onClick={handleResendOtp}
              >
                <RefreshCw className="w-3 h-3" />
                Resend OTP
              </button>
              <button
                type="button"
                className="text-slate-400 hover:text-indigo-600 font-semibold"
                onClick={() => setShowOtpView(false)}
              >
                Change Email
              </button>
            </div>
          </div>
        ) : showGooglePicker ? (
          /* GOOGLE ACCOUNT PICKER VIEW */
          <div className="p-6 space-y-5 animate-in fade-in">
            {/* Top Google Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.29v3.15C3.26 21.3 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.29B11.86 12 11.86c0 1.92.46 3.74 1.29 5.37l3.99-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.7 1.29 6.58l3.99 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Sign in with Google
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 gap-1"
                onClick={() => {
                  setShowGooglePicker(false);
                  setShowCustomGoogleInput(false);
                  setErrorMessage(null);
                }}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </Button>
            </div>

            <div>
              <DialogTitle className="text-xl font-black text-slate-900 dark:text-slate-100">
                Choose an account
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                to continue to <strong className="text-indigo-600">Insight</strong>
              </p>
            </div>

            {/* Error Message Box */}
            {errorMessage && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* List of Google Accounts */}
            {!showCustomGoogleInput ? (
              <div className="space-y-2">
                {SAMPLE_GOOGLE_ACCOUNTS.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 hover:border-indigo-200 transition-all cursor-pointer group"
                    onClick={() => handleSelectGoogleAccount(account)}
                  >
                    <div className="flex items-center gap-3">
                      {account.avatar ? (
                        <img
                          src={account.avatar}
                          alt={account.displayName}
                          className="w-10 h-10 rounded-full object-cover shadow-sm border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                          {account.displayName.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 transition-colors">
                          {account.displayName}
                        </p>
                        <p className="text-[11px] text-slate-500">{account.email}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                ))}

                {/* Option to use another account */}
                <div
                  className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all cursor-pointer text-indigo-600 dark:text-indigo-400 font-semibold text-xs mt-2"
                  onClick={() => {
                    setErrorMessage(null);
                    setShowCustomGoogleInput(true);
                  }}
                >
                  <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <span>Use another Google account</span>
                </div>
              </div>
            ) : (
              /* Custom Google Account Entry Form */
              <form onSubmit={handleCustomGoogleSubmit} className="space-y-3 animate-in fade-in">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Gmail Address
                  </Label>
                  <Input
                    type="email"
                    placeholder="user@gmail.com"
                    className="rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                    value={customGoogleEmail}
                    onChange={(e) => setCustomGoogleEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Your Name
                  </Label>
                  <Input
                    type="text"
                    placeholder="e.g. Alex Smith"
                    className="rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                    value={customGoogleName}
                    onChange={(e) => setCustomGoogleName(e.target.value)}
                    required
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 rounded-xl text-xs font-bold"
                    onClick={() => {
                      setErrorMessage(null);
                      setShowCustomGoogleInput(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                  >
                    Send OTP & Continue
                  </Button>
                </div>
              </form>
            )}

            <p className="text-[10px] text-slate-400 leading-relaxed pt-2 text-center">
              To continue, Google will share your name, email address, and language preference with Insight.
            </p>
          </div>
        ) : (
          /* REGULAR AUTH MODAL VIEW */
          <>
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

              {/* Google Sign In Option */}
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 rounded-xl border-slate-200 hover:bg-indigo-50/50 hover:border-indigo-300 font-semibold gap-3 text-slate-700 dark:text-slate-200 transition-all duration-200 shadow-sm"
                onClick={() => {
                  setErrorMessage(null);
                  setShowGooglePicker(true);
                }}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.29v3.15C3.26 21.3 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.29B11.86 12 11.86c0 1.92.46 3.74 1.29 5.37l3.99-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.7 1.29 6.58l3.99 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                Continue with Google
              </Button>

              <div className="relative flex items-center my-2">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="flex-shrink mx-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Or with Gmail
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
