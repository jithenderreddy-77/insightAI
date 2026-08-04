'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Mic, MicOff, Move, X, Check, Activity } from 'lucide-react';

interface NeonStarWidgetProps {
  assistantState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting';
  onActivate: () => void;
  onClose?: () => void;
}

export function NeonStarWidget({ assistantState, onActivate, onClose }: NeonStarWidgetProps) {
  const [pos, setPos] = useState({ x: 20, y: 20 }); // Top-right default
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPos({ x: window.innerWidth - 80, y: 24 });
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const newX = Math.max(10, Math.min(e.clientX - dragOffsetRef.current.x, window.innerWidth - 70));
    const newY = Math.max(10, Math.min(e.clientY - dragOffsetRef.current.y, window.innerHeight - 70));
    setPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      className="fixed z-[9999] touch-none select-none cursor-move group"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <button
        onClick={onActivate}
        className={`relative w-14 h-14 rounded-2xl flex items-center justify-center border transition-all duration-300 shadow-2xl backdrop-blur-xl ${
          assistantState === 'listening'
            ? 'bg-cyan-950/90 border-cyan-400 shadow-[0_0_35px_rgba(6,182,212,0.8)] scale-110 animate-pulse'
            : assistantState === 'thinking'
            ? 'bg-purple-950/90 border-purple-400 shadow-[0_0_35px_rgba(168,85,247,0.8)] scale-105'
            : assistantState === 'speaking'
            ? 'bg-fuchsia-950/90 border-fuchsia-400 shadow-[0_0_35px_rgba(217,70,239,0.8)]'
            : 'bg-slate-950/80 border-cyan-500/40 hover:border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
        }`}
        title="Insight Movable Neon Star OS Widget (Click to speak)"
      >
        {/* Glow halo */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-purple-500/20 to-pink-500/20 blur-md pointer-events-none" />

        {/* Central Neon Star Icon */}
        <Sparkles className={`w-7 h-7 relative z-10 transition-transform duration-300 ${
          assistantState === 'listening' ? 'text-cyan-300 spin-slow' :
          assistantState === 'thinking' ? 'text-purple-300 animate-spin' :
          assistantState === 'speaking' ? 'text-fuchsia-300 animate-bounce' :
          'text-cyan-400 group-hover:scale-110'
        }`} />

        {/* Tiny Status Indicator Dot */}
        <span className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border border-black ${
          assistantState === 'listening' ? 'bg-cyan-400 animate-ping' :
          assistantState === 'thinking' ? 'bg-purple-400 animate-pulse' :
          assistantState === 'speaking' ? 'bg-fuchsia-400' :
          'bg-emerald-400'
        }`} />
      </button>

      {/* Drag Hint */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-cyan-300 bg-slate-900/90 px-1.5 py-0.5 rounded border border-slate-800 pointer-events-none whitespace-nowrap">
        Drag to move
      </div>
    </div>
  );
}
