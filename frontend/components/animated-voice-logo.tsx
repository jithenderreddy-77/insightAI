'use client';

import React from 'react';
import Image from 'next/image';

interface AnimatedVoiceLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  state?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting';
  className?: string;
  onClick?: () => void;
}

export function AnimatedVoiceLogo({
  size = 'md',
  state = 'idle',
  className = '',
  onClick,
}: AnimatedVoiceLogoProps) {
  // Dimensions mapping
  const sizeMap = {
    sm: { container: 'w-10 h-10', img: 36, star: 'top-0 right-0 w-2.5 h-2.5', bars: 'h-2 gap-[1.5px]' },
    md: { container: 'w-16 h-16', img: 56, star: 'top-0.5 right-0.5 w-3.5 h-3.5', bars: 'h-3.5 gap-0.5' },
    lg: { container: 'w-36 h-36', img: 128, star: 'top-2 right-2 w-7 h-7', bars: 'h-7 gap-1' },
    xl: { container: 'w-48 h-48', img: 176, star: 'top-3 right-3 w-9 h-9', bars: 'h-9 gap-1.5' },
  };

  const currentSize = sizeMap[size] || sizeMap.md;
  const isActive = state === 'listening' || state === 'waiting';

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center justify-center cursor-pointer select-none transition-all duration-300 group ${currentSize.container} ${className}`}
    >
      {/* Outer Rotating Electric Aura Ring */}
      <div
        className={`absolute inset-[-12%] rounded-full pointer-events-none transition-all duration-500 ${
          state === 'listening'
            ? 'border-2 border-cyan-400/80 shadow-[0_0_40px_rgba(34,211,238,0.8)] animate-pulse'
            : state === 'speaking'
            ? 'border-2 border-fuchsia-400/80 shadow-[0_0_40px_rgba(232,121,249,0.8)] animate-ping'
            : state === 'thinking'
            ? 'border-2 border-indigo-400/80 shadow-[0_0_40px_rgba(129,140,248,0.8)] animate-spin'
            : state === 'waiting'
            ? 'border-2 border-emerald-400/60 shadow-[0_0_30px_rgba(16,185,129,0.6)] animate-pulse'
            : 'border border-cyan-500/20 shadow-none'
        }`}
      />

      {/* Ambient Radial Background Glow */}
      <div
        className={`absolute inset-0 rounded-full blur-xl pointer-events-none transition-all duration-500 ${
          state === 'listening'
            ? 'bg-cyan-500/40 animate-pulse scale-110'
            : state === 'speaking'
            ? 'bg-fuchsia-500/40 animate-bounce scale-110'
            : state === 'thinking'
            ? 'bg-indigo-500/40 animate-pulse scale-105'
            : 'bg-cyan-500/15 group-hover:bg-cyan-500/30'
        }`}
      />

      {/* Main Logo PNG with Filter Shadow */}
      <div className="relative z-10 w-full h-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
        <Image
          src="/voice-logo.png"
          alt="Insight Voice Logo"
          width={currentSize.img}
          height={currentSize.img}
          className={`object-contain transition-all duration-300 ${
            state === 'listening'
              ? 'filter drop-shadow-[0_0_20px_rgba(34,211,238,0.9)] scale-105'
              : state === 'speaking'
              ? 'filter drop-shadow-[0_0_20px_rgba(232,121,249,0.9)] scale-105'
              : state === 'thinking'
              ? 'filter drop-shadow-[0_0_20px_rgba(129,140,248,0.9)] animate-pulse'
              : 'filter drop-shadow-[0_0_12px_rgba(6,182,212,0.6)]'
          }`}
          priority
        />

        {/* Dynamic Center Equalizer Animation OVER Mic Circle */}
        {(state === 'listening' || state === 'speaking' || state === 'waiting') && (
          <div className={`absolute inset-0 flex items-center justify-center ${currentSize.bars} pointer-events-none z-20`}>
            <span className={`w-[12%] rounded-full bg-cyan-400 animate-[bounce_0.6s_infinite_100ms] shadow-[0_0_8px_#22d3ee] ${state === 'speaking' ? 'bg-fuchsia-400 shadow-[0_0_8px_#e879f9]' : ''}`} style={{ height: '40%' }} />
            <span className={`w-[12%] rounded-full bg-cyan-300 animate-[bounce_0.6s_infinite_300ms] shadow-[0_0_8px_#22d3ee] ${state === 'speaking' ? 'bg-fuchsia-300 shadow-[0_0_8px_#e879f9]' : ''}`} style={{ height: '85%' }} />
            <span className={`w-[12%] rounded-full bg-cyan-400 animate-[bounce_0.6s_infinite_200ms] shadow-[0_0_8px_#22d3ee] ${state === 'speaking' ? 'bg-fuchsia-400 shadow-[0_0_8px_#e879f9]' : ''}`} style={{ height: '100%' }} />
            <span className={`w-[12%] rounded-full bg-cyan-300 animate-[bounce_0.6s_infinite_400ms] shadow-[0_0_8px_#22d3ee] ${state === 'speaking' ? 'bg-fuchsia-300 shadow-[0_0_8px_#e879f9]' : ''}`} style={{ height: '70%' }} />
            <span className={`w-[12%] rounded-full bg-cyan-400 animate-[bounce_0.6s_infinite_150ms] shadow-[0_0_8px_#22d3ee] ${state === 'speaking' ? 'bg-fuchsia-400 shadow-[0_0_8px_#e879f9]' : ''}`} style={{ height: '45%' }} />
          </div>
        )}
      </div>

      {/* Sparkling Flare Star at top right comet tail */}
      <div
        className={`absolute z-30 pointer-events-none rounded-full bg-white shadow-[0_0_12px_#ffffff] transition-all duration-300 ${currentSize.star} ${
          isActive
            ? 'animate-ping scale-125 bg-cyan-200 shadow-[0_0_16px_#22d3ee]'
            : 'animate-pulse'
        }`}
      />
    </div>
  );
}
