'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Mic, Bell, Contact as ContactIcon, CheckCircle2, ArrowRight } from 'lucide-react';
import { syncDeviceContacts } from '@/lib/contacts-store';

interface PermissionsGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PermissionsGuideModal({ isOpen, onClose }: PermissionsGuideModalProps) {
  const [micGranted, setMicGranted] = useState(true);
  const [contactsSynced, setContactsSynced] = useState(false);
  const [notifGranted, setNotifGranted] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );

  const handleSyncContacts = async () => {
    const contacts = await syncDeviceContacts();
    if (contacts && contacts.length > 0) {
      setContactsSynced(true);
    }
  };

  const handleEnableNotifs = async () => {
    if (typeof Notification !== 'undefined') {
      const res = await Notification.requestPermission();
      if (res === 'granted') setNotifGranted(true);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-900/40 via-cyan-900/40 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">OS Permissions Setup Guide</DialogTitle>
              <p className="text-xs text-slate-400">Grant permissions to enable autonomous voice automation</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Mic */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Mic className="w-5 h-5 text-cyan-400" />
              <div>
                <p className="text-xs font-bold text-slate-200">Microphone Access</p>
                <p className="text-[11px] text-slate-400">Required for continuous voice commands</p>
              </div>
            </div>
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Granted
            </span>
          </div>

          {/* Contacts */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ContactIcon className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-xs font-bold text-slate-200">Device Contacts Sync</p>
                <p className="text-[11px] text-slate-400">Enables "Call Thanoj" or "Open Mummy chat"</p>
              </div>
            </div>
            {contactsSynced ? (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Synced
              </span>
            ) : (
              <Button onClick={handleSyncContacts} size="sm" className="bg-amber-600 hover:bg-amber-700 text-xs font-semibold h-8">
                Sync Contacts
              </Button>
            )}
          </div>

          {/* Notifications */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-pink-400" />
              <div>
                <p className="text-xs font-bold text-slate-200">Desktop Notifications</p>
                <p className="text-[11px] text-slate-400">Timed reminders & task completion alerts</p>
              </div>
            </div>
            {notifGranted ? (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Enabled
              </span>
            ) : (
              <Button onClick={handleEnableNotifs} size="sm" className="bg-pink-600 hover:bg-pink-700 text-xs font-semibold h-8">
                Enable
              </Button>
            )}
          </div>

          <Button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-10 mt-2 gap-2">
            Finish Setup & Continue
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
