'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
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
import { Sparkles, Lock, Mail, User, ArrowRight, CheckCircle2, AlertCircle, RefreshCw, KeyRound, ShieldCheck } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserProfile) => void;
}

export function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [signInUsername, setSignInUsername] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  const [signUpName, setSignUpName] = useState('');
  const [signUpUsername, setSignUpUsername] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');

  // OTP Verification States (post Google OAuth)
  const [otpCode, setOtpCode] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpSentMessage, setOtpSentMessage] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number>(600); // 10 minutes

  // Auto-send OTP code when Google Sign-In succeeds
  useEffect(() => {
    if (session?.user?.email && isOpen) {
      const email = session.user.email;
      const name = session.user.name || 'Google User';
      const isVerified = localStorage.getItem(`google_otp_verified_${email}`);
      if (!isVerified) {
        dispatchOtpEmail(email, name);
      } else {
        // Already OTP verified in this browser
        completeGoogleLogin(email, name, session.user.image);
      }
    }
  }, [session, isOpen]);

  // Countdown timer for 10-minute expiry
  useEffect(() => {
    if (!session?.user?.email) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const dispatchOtpEmail = async (email: string, displayName: string) => {
    setIsSendingOtp(true);
    setOtpError(null);
    setOtpSentMessage(null);
    try {
      const res = await fetch('/api/send-otp-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error || 'Failed to send OTP email.');
      } else {
        setOtpSentMessage(data.message || `Verification code sent to ${email}`);
        setCountdown(600); // Reset 10-minute timer
      }
    } catch (err: any) {
      setOtpError(err.message || 'Error sending verification code.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.email || !otpCode.trim()) return;

    setIsVerifyingOtp(true);
    setOtpError(null);

    const email = session.user.email;

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otpCode: otpCode.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setOtpError(data.error || 'Invalid verification code.');
        if (typeof data.attemptsLeft === 'number') {
          setAttemptsLeft(data.attemptsLeft);
        }
        return;
      }

      // SUCCESS: Mark as verified in localStorage and complete login
      localStorage.setItem(`google_otp_verified_${email}`, 'true');
      await completeGoogleLogin(email, session.user.name || 'Google User', session.user.image);
    } catch (err: any) {
      setOtpError(err.message || 'Server error during OTP verification.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const completeGoogleLogin = async (email: string, displayName: string, avatarUrl?: string | null) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'google_auth',
          id: `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
          email,
          displayName,
          passwordHash: 'google_oauth_authenticated',
          createdAt: new Date().toISOString(),
        }),
      });

      const data = await res.json();
      if (data.success && data.account) {
        const userProfile: UserProfile = {
          id: data.account.id,
          username: data.account.username || email,
          displayName: data.account.displayName || displayName,
          email: data.account.email || email,
          avatar: avatarUrl || data.account.avatar,
        };
        onLoginSuccess(userProfile);
        onClose();
      }
    } catch (err) {
      console.error('Google auth persistence error:', err);
    }
  };

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
    setOtpCode('');
    setOtpError(null);
    setOtpSentMessage(null);
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // IF GOOGLE SESSION ACTIVE BUT OTP NOT YET COMPLETED -> RENDER STEP 2 OTP SCREEN
  const isGoogleSessionActive = Boolean(status === 'authenticated' && session?.user?.email);
  const userEmail = session?.user?.email || '';
  const userName = session?.user?.name || 'Google User';
  const userAvatar = session?.user?.image;

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
            Insight AI
          </DialogTitle>
          <p className="text-xs font-medium text-indigo-100 uppercase tracking-widest flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            {isGoogleSessionActive ? 'Google OTP Verification Step' : 'Extract intelligence from PDFs'}
          </p>
        </div>

        {/* --- STEP 2: GOOGLE SIGN-IN SUCCEEDED -> OTP ENTRY SCREEN --- */}
        {isGoogleSessionActive ? (
          <div className="p-6 space-y-4">
            <div className="p-3.5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 flex items-center gap-3">
              {userAvatar ? (
                <img src={userAvatar} alt="Google Avatar" className="w-10 h-10 rounded-full border border-indigo-300" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center">
                  {userName.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold text-indigo-900 dark:text-indigo-200 truncate">
                  {userName}
                </div>
                <div className="text-[11px] text-indigo-600 dark:text-indigo-400 truncate font-mono">
                  {userEmail}
                </div>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
            </div>

            {/* OTP Status Notice */}
            {otpSentMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>{otpSentMessage}</span>
              </div>
            )}

            {otpError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{otpError}</span>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <Label className="font-bold text-slate-700 dark:text-slate-200">
                    Enter 6-Digit Email OTP Code
                  </Label>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    Expires in {formatTimer(countdown)}
                  </span>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-3 text-indigo-500" />
                  <Input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    className="pl-9 text-center font-mono font-bold text-lg tracking-[8px] rounded-xl border-indigo-200 focus-visible:ring-indigo-500"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isVerifyingOtp || otpCode.length < 6}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:to-pink-700 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all duration-200 gap-2"
              >
                {isVerifyingOtp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>{isVerifyingOtp ? 'Verifying OTP...' : 'Verify OTP & Complete Sign In'}</span>
              </Button>
            </form>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={isSendingOtp}
                onClick={() => dispatchOtpEmail(userEmail, userName)}
                className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSendingOtp ? 'animate-spin' : ''}`} />
                <span>Resend OTP Code</span>
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                Use another account
              </button>
            </div>
          </div>
        ) : (
          /* --- STEP 1: STANDARD SIGN IN & GOOGLE OAUTH BUTTON --- */
          <div className="p-6 space-y-4">
            {/* Prominent Official Google OAuth Sign-In Button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => signIn('google')}
              className="w-full h-12 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-100 font-bold text-sm shadow-sm transition-all duration-200 flex items-center justify-center gap-3 group"
            >
              <svg className="w-5 h-5 shrink-0 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Sign in with Google</span>
            </Button>

            <div className="relative flex items-center justify-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              <span className="absolute bg-white dark:bg-slate-900 px-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                Or email sign in
              </span>
            </div>

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
        )}
      </DialogContent>
    </Dialog>
  );
}
