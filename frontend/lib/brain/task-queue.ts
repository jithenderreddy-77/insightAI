// frontend/lib/brain/task-queue.ts
// Task Queue & Background Manager for Insight AI OS
// Tracks active task timelines, queued tasks, running agents, and execution history.

export type AgentType =
  | 'Voice Agent'
  | 'Brain Orchestrator'
  | 'Planner Agent'
  | 'Reasoning Agent'
  | 'Memory Agent'
  | 'Tool Registry'
  | 'Automation Agent'
  | 'Research Agent'
  | 'Communication Agent'
  | 'Document Agent'
  | 'Verification Agent';

export type TaskStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface TaskItem {
  id: string;
  title: string;
  commandText: string;
  status: TaskStatus;
  currentAgent: AgentType;
  progress: number; // 0 - 100
  steps: {
    id: number;
    description: string;
    agent: AgentType;
    status: 'pending' | 'running' | 'done' | 'failed';
    output?: string;
  }[];
  createdAt: string;
  completedAt?: string;
  requiresApproval?: boolean;
  approvalDetails?: {
    type: 'email' | 'file_delete' | 'system_change';
    summary: string;
    payload: any;
  };
}

const STORAGE_KEY_HISTORY = 'insight_task_history';
const STORAGE_KEY_APPROVALS = 'insight_pending_approvals';

class TaskQueueManager {
  private tasks: TaskItem[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const storedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (storedHistory) {
        this.tasks = JSON.parse(storedHistory);
      }
    } catch (err) {
      console.error('Failed to load task queue from storage:', err);
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(this.tasks.slice(-50))); // Keep last 50
      this.notify();
    } catch (err) {
      console.error('Failed to save task queue to storage:', err);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  public createTask(title: string, commandText: string): TaskItem {
    const newTask: TaskItem = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      commandText,
      status: 'running',
      currentAgent: 'Brain Orchestrator',
      progress: 10,
      steps: [],
      createdAt: new Date().toISOString(),
    };

    this.tasks.unshift(newTask);
    this.saveToStorage();
    return newTask;
  }

  public updateTaskProgress(
    taskId: string,
    updates: Partial<TaskItem>,
  ): TaskItem | null {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;

    Object.assign(task, updates);
    if (updates.status === 'completed' || updates.status === 'failed') {
      task.completedAt = new Date().toISOString();
      task.progress = updates.status === 'completed' ? 100 : task.progress;
    }

    this.saveToStorage();
    return task;
  }

  public addApprovalRequest(taskId: string, approval: TaskItem['approvalDetails']) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task && approval) {
      task.status = 'waiting_approval';
      task.requiresApproval = true;
      task.approvalDetails = approval;
      this.saveToStorage();
    }
  }

  public getTasks(): TaskItem[] {
    return this.tasks;
  }

  public getActiveTasks(): TaskItem[] {
    return this.tasks.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'waiting_approval');
  }

  public getPendingApprovals(): TaskItem[] {
    return this.tasks.filter((t) => t.status === 'waiting_approval' && t.requiresApproval);
  }

  public clearHistory() {
    this.tasks = this.getActiveTasks();
    this.saveToStorage();
  }
}

export const taskQueueManager = new TaskQueueManager();
