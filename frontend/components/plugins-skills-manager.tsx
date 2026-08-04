'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Wrench, CheckCircle2, Search, Zap, Code2, Globe, Phone, FileText, Bell } from 'lucide-react';
import { toolRegistry } from '@/lib/brain/tool-registry';

interface PluginsSkillsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PluginsSkillsManager({ isOpen, onClose }: PluginsSkillsManagerProps) {
  const tools = toolRegistry.getAll();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'web_search': return <Globe className="w-5 h-5 text-cyan-400" />;
      case 'contact_action': return <Phone className="w-5 h-5 text-amber-400" />;
      case 'open_website': return <Zap className="w-5 h-5 text-purple-400" />;
      case 'document_qa': return <FileText className="w-5 h-5 text-emerald-400" />;
      case 'set_reminder': return <Bell className="w-5 h-5 text-pink-400" />;
      default: return <Wrench className="w-5 h-5 text-indigo-400" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/40 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Code2 className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Plugins & Skills Manager</DialogTitle>
              <p className="text-xs text-slate-400">Active tool definitions registered with the Brain Orchestrator</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              placeholder="Search tools & skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredTools.map((t) => (
              <div key={t.name} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {getToolIcon(t.name)}
                    <span className="text-sm font-bold text-slate-200 font-mono">{t.name}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans leading-relaxed">{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
