// frontend/lib/brain/tools/contact-tool.ts
// Contact resolution + action dispatch (WhatsApp, call, email)
// Uses phonetic + string fuzzy matching — NEVER hallucinates contacts

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';
import { resolveContactEntity } from '@/lib/fuzzy-entity-resolution';

const parameterSchema = z.object({
  contactName: z.string().describe('The name of the contact to find'),
  channel: z.enum(['whatsapp', 'call', 'email']).describe('Communication channel'),
  messageText: z.string().optional().describe('Optional message body to send'),
});

type Params = z.infer<typeof parameterSchema>;

async function execute(params: Params, context: ToolContext): Promise<ToolResult> {
  const { contactName, channel, messageText } = params;
  const resolution = resolveContactEntity(contactName, context.userContacts);

  // RESOLVED — single confident match
  if (resolution.status === 'RESOLVED' && resolution.resolvedContact) {
    const contact = resolution.resolvedContact;
    const cleanPhone = contact.phone.replace(/\D/g, '');

    if (channel === 'whatsapp') {
      const encodedMsg = messageText ? encodeURIComponent(messageText) : '';
      const targetUrl = cleanPhone
        ? `https://web.whatsapp.com/send?phone=${cleanPhone}${encodedMsg ? `&text=${encodedMsg}` : ''}`
        : `https://web.whatsapp.com/send?text=${encodedMsg}`;

      return {
        success: true,
        data: {
          resolvedContact: contact,
          confidence: resolution.confidence,
          channel,
        },
        clientAction: {
          type: 'OPEN_URL',
          payload: {
            url: targetUrl,
            description: `WhatsApp chat with ${contact.name}`,
          },
        },
      };
    }

    if (channel === 'email') {
      const encodedMsg = messageText ? encodeURIComponent(messageText) : '';
      const targetUrl = contact.email
        ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contact.email)}${encodedMsg ? `&body=${encodedMsg}` : ''}`
        : `https://mail.google.com/mail/?view=cm&fs=1${encodedMsg ? `&body=${encodedMsg}` : ''}`;

      return {
        success: true,
        data: {
          resolvedContact: contact,
          confidence: resolution.confidence,
          channel,
        },
        clientAction: {
          type: 'OPEN_URL',
          payload: {
            url: targetUrl,
            description: `Email to ${contact.name}`,
          },
        },
      };
    }

    // Default: Phone call
    return {
      success: true,
      data: {
        resolvedContact: contact,
        confidence: resolution.confidence,
        channel: 'call',
      },
      clientAction: {
        type: 'PHONE_CALL',
        payload: {
          phoneNumber: contact.phone,
          contactName: contact.name,
        },
      },
    };
  }

  // DISAMBIGUATE — multiple candidates found
  if (resolution.status === 'DISAMBIGUATE' && resolution.candidates && resolution.candidates.length > 0) {
    return {
      success: true,
      data: {
        searchedName: contactName,
        candidates: resolution.candidates,
        channel,
        messageText,
      },
      clientAction: {
        type: 'DISAMBIGUATE_CONTACT',
        payload: {
          searchedName: contactName,
          candidates: resolution.candidates,
          clarifyingQuestion: resolution.clarifyingQuestion || `Did you mean ${resolution.candidates[0].name}?`,
          pendingChannel: channel,
          pendingMessage: messageText || '',
        },
      },
    };
  }

  // NOT FOUND — still open the app (decoupled step A)
  const appToOpen = channel === 'whatsapp' ? 'https://web.whatsapp.com' : undefined;
  return {
    success: false,
    error: `No contact matching "${contactName}" found in your saved contacts.`,
    clientAction: {
      type: 'CONTACT_NOT_FOUND',
      payload: {
        searchedName: contactName,
        channel,
        appToOpen,
      },
    },
  };
}

export const contactTool: ToolDefinition<Params> = {
  name: 'contact_action',
  description:
    'Find a contact by name and perform an action: WhatsApp message/chat, phone call, or email. Uses fuzzy phonetic matching to handle name mispronunciations. IMPORTANT: Only matches against REAL saved contacts — never invents or guesses contact names.',
  parameterDescriptions: {
    contactName: 'Name of the person to contact (e.g. "Thanoj", "Mom", "Alex")',
    channel: 'Communication channel: "whatsapp", "call", or "email"',
    messageText: '(Optional) Message body to send',
  },
  parameterSchema,
  execute,
};
