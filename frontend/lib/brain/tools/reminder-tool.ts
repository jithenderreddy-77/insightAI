// frontend/lib/brain/tools/reminder-tool.ts
// Time-based reminders using localStorage + Notification API

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';

const parameterSchema = z.object({
  title: z.string().describe('What to remind the user about'),
  delayMinutes: z
    .number()
    .min(1)
    .max(1440)
    .describe('How many minutes from now to trigger the reminder (1 to 1440)'),
});

type Params = z.infer<typeof parameterSchema>;

async function execute(params: Params, context: ToolContext): Promise<ToolResult> {
  const { title, delayMinutes } = params;
  const triggerAt = Date.now() + delayMinutes * 60 * 1000;

  const reminder = {
    id: `rem_${Date.now()}`,
    title,
    delayMinutes,
    triggerAt,
    createdAt: new Date().toISOString(),
    userName: context.userName,
    status: 'pending' as const,
  };

  return {
    success: true,
    data: reminder,
    clientAction: {
      type: 'SHOW_REMINDER',
      payload: reminder,
    },
  };
}

export const reminderTool: ToolDefinition<Params> = {
  name: 'set_reminder',
  description:
    'Set a timed reminder for the user. The reminder will trigger after the specified number of minutes. Use when the user says things like "remind me in 30 minutes", "set a timer for 1 hour", "remind me to call Mom at 5pm".',
  parameterDescriptions: {
    title: 'Description of what to remind about (e.g. "Call Mom", "Check laundry")',
    delayMinutes: 'Minutes from now until the reminder fires (e.g. 30 for "half an hour")',
  },
  parameterSchema,
  execute,
};
