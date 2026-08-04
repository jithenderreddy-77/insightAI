'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldAlert, CheckCircle2, XCircle, Mail, AlertTriangle, Send } from 'lucide-react';
import { taskQueueManager, type TaskItem } from '@/lib/brain/task-queue';

interface AutomationApprovalCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove?: (task: TaskItem) => void;
  onReject?: (task: TaskItem) => void;
}

export function AutomationApprovalCenter({
  isOpen,
  onClose,
  onApprove,
  onReject,
}: AutomationApprovalCenterProps) {
  const [pendingTasks, setPendingTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    const update = () => setPendingTasks(taskQueueManager.getPendingApprovals());
    update();
    return taskQueueManager.subscribe(update);
  }, [isOpen]);

  const handleAction = (task: TaskItem, action: 'approve' | 'reject') => {
    if (action === 'approve') {
      taskQueueManager.updateTaskProgress(task.id, {
        status: 'completed',
        requiresApproval: false,
      });
      onApprove?.(task);
    } else {
      taskQueueManager.updateTaskProgress(task.id, {
        status: 'cancelled',
        requiresApproval: false,
      });
      onReject?.(task);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px] p-0 border border-slate-800 bg-slate-950 text-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-amber-900/40 via-rose-900/30 to-slate-900 p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Automation Approval Center</DialogTitle>
              <p className="text-xs text-slate-400">Review and authorize sensitive actions before dispatch</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {pendingTasks.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500/50 mx-auto" />
              <p className="text-sm text-slate-400 font-medium">No pending automation approvals</p>
              <p className="text-xs text-slate-600">All high-risk actions have been verified or completed.</p>
            </div>
          ) : (
            pendingTasks.map((task) => {
              const details = task.approvalDetails;
              return (
                <div key={task.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wider">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {details?.type || 'Sensitive Action Required'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">ID: {task.id.slice(0, 10)}</span>
                  </div>

                  <p className="text-xs font-semibold text-slate-200">{details?.summary || task.title}</p>

                  {/* Render email draft preview if email type */}
                  {details?.payload?.details && (
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-850 text-xs space-y-1.5 font-sans text-slate-300">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-500 font-mono">To:</span>
                        <span className="text-indigo-400 font-semibold">{details.payload.details.to}</span>
                      </div>
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-500 font-mono">Subject:</span>
                        <span className="text-slate-200 font-medium">{details.payload.details.subject}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-[11px] text-slate-400 pt-1">
                        {details.payload.details.body}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-1">
                    <Button
                      onClick={() => handleAction(task, 'reject')}
                      variant="outline"
                      className="border-slate-800 text-rose-400 hover:bg-rose-950/30 text-xs font-semibold h-9 px-4 gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleAction(task, 'approve')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-9 px-4 gap-1.5"
                    >
                      <Send className="w-4 h-4" />
                      Approve & Dispatch
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
