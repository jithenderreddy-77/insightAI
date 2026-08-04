'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clock, Plus, Calendar, Bell, Trash2, CheckCircle2 } from 'lucide-react';

export interface ScheduledTask {
  id: string;
  title: string;
  command: string;
  time: string; // ISO or HH:MM
  repeat: 'once' | 'daily' | 'weekly';
  enabled: boolean;
}

const STORAGE_KEY_SCHEDULED = 'insight_scheduled_tasks';

interface TaskSchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TaskSchedulerModal({ isOpen, onClose }: TaskSchedulerModalProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [title, setTitle] = useState('');
  const [command, setCommand] = useState('');
  const [time, setTime] = useState('09:00');
  const [repeat, setRepeat] = useState<ScheduledTask['repeat']>('daily');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SCHEDULED);
      if (stored) setTasks(JSON.parse(stored));
    } catch {}
  }, [isOpen]);

  const saveToStorage = (updated: ScheduledTask[]) => {
    setTasks(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_SCHEDULED, JSON.stringify(updated));
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    const newTask: ScheduledTask = {
      id: `sched_${Date.now()}`,
      title: title.trim() || command.trim(),
      command: command.trim(),
      time,
      repeat,
      enabled: true,
    };

    saveToStorage([...tasks, newTask]);
    setTitle('');
    setCommand('');
  };

  const handleDelete = (id: string) => {
    saveToStorage(tasks.filter((t) => t.id !== id));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-pink-900/40 via-purple-900/40 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Task Scheduler & Reminders</DialogTitle>
              <p className="text-xs text-slate-400">Schedule recurring background tasks and timed reminders</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Create Form */}
          <form onSubmit={handleCreate} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-pink-400" />
              New Scheduled Automation / Reminder
            </span>
            <Input
              placeholder="Task name (e.g. Morning Briefing)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-slate-950 border-slate-800 text-xs focus-visible:ring-pink-500"
            />
            <Input
              placeholder="Voice Command (e.g. Search latest news and summarize)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="bg-slate-950 border-slate-800 text-xs focus-visible:ring-pink-500"
              required
            />
            <div className="flex gap-2">
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="bg-slate-950 border-slate-800 text-xs focus-visible:ring-pink-500 w-1/2"
              />
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as any)}
                className="bg-slate-950 text-xs text-slate-200 border border-slate-800 rounded-xl px-3 w-1/2 focus:outline-none"
              >
                <option value="once">Run Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <Button type="submit" className="w-full bg-pink-600 hover:bg-pink-700 text-white text-xs font-bold h-9">
              Schedule Task
            </Button>
          </form>

          {/* List */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Scheduled Tasks ({tasks.length})</span>
            {tasks.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">No scheduled tasks yet.</div>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-200">{t.title}</p>
                    <p className="text-[11px] text-slate-400 font-mono">Command: "{t.command}"</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1 text-pink-400 font-mono">
                        <Clock className="w-3 h-3" /> {t.time}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono capitalize">{t.repeat}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(t.id)} className="text-slate-600 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
