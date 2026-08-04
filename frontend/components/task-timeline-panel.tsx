'use client';

import React, { useState, useEffect } from 'react';
import { taskQueueManager, type TaskItem, type AgentType } from '@/lib/brain/task-queue';
import { Activity, CheckCircle2, Clock, PlayCircle, AlertCircle, Bot, Cpu } from 'lucide-react';

interface TaskTimelinePanelProps {
  className?: string;
}

export function TaskTimelinePanel({ className = '' }: TaskTimelinePanelProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    const update = () => setTasks(taskQueueManager.getTasks());
    update();
    return taskQueueManager.subscribe(update);
  }, []);

  const getAgentColor = (agent: AgentType) => {
    switch (agent) {
      case 'Research Agent': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'Automation Agent': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'Communication Agent': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'Document Agent': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'Verification Agent': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className={`p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 text-slate-200 font-bold text-xs uppercase tracking-wider">
          <Activity className="w-4 h-4 text-indigo-400 animate-pulse" />
          Active Task Timeline & Agent Monitor
        </div>
        <span className="text-[10px] text-slate-500 font-mono">Total: {tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-xs flex flex-col items-center gap-2">
          <Cpu className="w-8 h-8 text-slate-700" />
          <span>No active or historical tasks queued.</span>
        </div>
      ) : (
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
          {tasks.slice(0, 10).map((t) => (
            <div key={t.id} className="p-3 rounded-xl bg-slate-950 border border-slate-850 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 line-clamp-1">{t.title}</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border capitalize flex items-center gap-1 ${
                  t.status === 'running' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' :
                  t.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' :
                  t.status === 'waiting_approval' ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' :
                  'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {t.status === 'running' && <PlayCircle className="w-3 h-3 animate-spin" />}
                  {t.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                  {t.status === 'waiting_approval' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                  {t.status.replace('_', ' ')}
                </span>
              </div>

              {/* Running Agent Indicator */}
              <div className="flex items-center gap-2">
                <Bot className="w-3.5 h-3.5 text-slate-500" />
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${getAgentColor(t.currentAgent)}`}>
                  {t.currentAgent}
                </span>
              </div>

              {/* Progress Bar */}
              {t.status === 'running' && (
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${t.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
