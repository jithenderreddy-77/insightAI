'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Brain, Search, Trash2, Plus, Tag, Calendar, Sparkles } from 'lucide-react';
import {
  getMemoriesByCategory,
  remember,
  forget,
  getPreferences,
  setCustomPreference,
  type Memory,
} from '@/lib/brain/memory-manager';

interface MemoryEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MemoryEditorModal({ isOpen, onClose }: MemoryEditorModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // New memory input
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<Memory['category']>('fact');

  // Custom preference input
  const [prefKey, setPrefKey] = useState('');
  const [prefValue, setPrefValue] = useState('');
  const [userPrefs, setUserPrefs] = useState<Record<string, string>>({});

  const refreshData = () => {
    const facts = getMemoriesByCategory('fact');
    const prefs = getMemoriesByCategory('preference');
    const habits = getMemoriesByCategory('habit');
    const notes = getMemoriesByCategory('note');

    const all = [...facts, ...prefs, ...habits, ...notes];
    setMemories(all);

    const storedPrefs = getPreferences();
    setUserPrefs(storedPrefs.custom || {});
  };

  useEffect(() => {
    if (isOpen) {
      refreshData();
    }
  }, [isOpen]);

  const handleAddMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    remember(newContent.trim(), newCategory, { importance: 7, source: 'system' });
    setNewContent('');
    refreshData();
  };

  const handleAddPreference = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefKey.trim() || !prefValue.trim()) return;
    setCustomPreference(prefKey.trim().toLowerCase().replace(/\s+/g, '_'), prefValue.trim());
    setPrefKey('');
    setPrefValue('');
    refreshData();
  };

  const handleDeleteMemory = (id: string) => {
    forget(id);
    refreshData();
  };

  const filteredMemories = memories.filter((m) => {
    const matchesCat = activeCategory === 'all' || m.category === activeCategory;
    const matchesQuery = !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[650px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-purple-900/40 via-indigo-900/40 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">AI Memory & Preference Viewer</DialogTitle>
              <p className="text-xs text-slate-400">Inspect, edit, and manage learned facts and stored preferences</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Add New Memory Form */}
          <form onSubmit={handleAddMemory} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-purple-400" />
                Add Learned Fact / Memory
              </span>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as any)}
                className="bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1 focus:outline-none"
              >
                <option value="fact">Fact</option>
                <option value="preference">Preference</option>
                <option value="note">Note</option>
                <option value="habit">Habit</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Preferred working hours are 9 AM to 6 PM"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="bg-slate-950 border-slate-800 text-sm focus-visible:ring-purple-500"
              />
              <Button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-4">
                Remember
              </Button>
            </div>
          </form>

          {/* Quick Custom Preference Form */}
          <form onSubmit={handleAddPreference} className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Add Key-Value Preference
            </span>
            <div className="flex gap-2">
              <Input
                placeholder="Key (e.g. favorite_color)"
                value={prefKey}
                onChange={(e) => setPrefKey(e.target.value)}
                className="bg-slate-950 border-slate-800 text-xs focus-visible:ring-indigo-500 w-1/3"
              />
              <Input
                placeholder="Value (e.g. Blue)"
                value={prefValue}
                onChange={(e) => setPrefValue(e.target.value)}
                className="bg-slate-950 border-slate-800 text-xs focus-visible:ring-indigo-500 w-2/3"
              />
              <Button type="submit" variant="secondary" className="text-xs font-semibold px-3">
                Save
              </Button>
            </div>
          </form>

          {/* Search & Category Filter */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <Input
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-900 border-slate-800 text-xs"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto w-full sm:w-auto">
              {['all', 'fact', 'preference', 'note', 'habit'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border capitalize transition-all ${
                    activeCategory === cat
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Stored Preferences Summary */}
          {Object.keys(userPrefs).length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Learned User Preferences</span>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(userPrefs).map(([k, v]) => (
                  <div key={k} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex justify-between">
                    <span className="text-slate-400 font-mono">{k}</span>
                    <span className="text-indigo-300 font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Memory List */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stored Facts ({filteredMemories.length})</span>
            {filteredMemories.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">No memories found in this category.</div>
            ) : (
              filteredMemories.map((m) => (
                <div
                  key={m.id}
                  className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-start justify-between gap-3 group transition-all"
                >
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-200">{m.content}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-purple-300 font-mono capitalize">{m.category}</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(m.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteMemory(m.id)}
                    className="text-slate-600 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors"
                  >
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
