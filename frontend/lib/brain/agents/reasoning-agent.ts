// frontend/lib/brain/agents/reasoning-agent.ts
// Reasoning Agent — Chain of Thought parameter resolution and sub-agent dispatching.

export interface ReasoningResult {
  thinking: string;
  targetSubAgent: 'automation' | 'research' | 'communication' | 'document' | 'general';
  toolName?: string;
  toolParams?: Record<string, any>;
  requiresApproval?: boolean;
}

export async function runReasoningAgent(
  transcript: string,
  context: { hasActiveDocuments: boolean; userContactsCount: number; memoryContext: string },
): Promise<ReasoningResult> {
  const q = transcript.toLowerCase();

  // Communication Agent triggers
  if (
    q.includes('email') ||
    q.includes('mail') ||
    q.includes('whatsapp') ||
    q.includes('send text') ||
    q.includes('message') ||
    q.includes('call ')
  ) {
    return {
      thinking: 'Reasoning: User request involves contact communication or email drafting. Dispatching to Communication Agent.',
      targetSubAgent: 'communication',
    };
  }

  // Document Agent triggers
  if (
    context.hasActiveDocuments &&
    (q.includes('pdf') || q.includes('document') || q.includes('file') || q.includes('summarize') || q.includes('extract'))
  ) {
    return {
      thinking: 'Reasoning: User is referencing active uploaded document. Dispatching to Document Agent.',
      targetSubAgent: 'document',
    };
  }

  // Research Agent triggers
  if (
    q.includes('search') ||
    q.includes('news') ||
    q.includes('weather') ||
    q.includes('latest') ||
    q.includes('who is') ||
    q.includes('what is')
  ) {
    return {
      thinking: 'Reasoning: Query requires external search or real-time web info. Dispatching to Research Agent.',
      targetSubAgent: 'research',
    };
  }

  // Automation Agent triggers
  if (
    q.startsWith('open ') ||
    q.startsWith('launch ') ||
    q.startsWith('go to ') ||
    q.includes('youtube') ||
    q.includes('spotify') ||
    q.includes('github')
  ) {
    return {
      thinking: 'Reasoning: Request specifies opening an application or website. Dispatching to Automation Agent.',
      targetSubAgent: 'automation',
    };
  }

  return {
    thinking: 'Reasoning: General knowledge query. Processing with Brain Orchestrator directly.',
    targetSubAgent: 'general',
  };
}
