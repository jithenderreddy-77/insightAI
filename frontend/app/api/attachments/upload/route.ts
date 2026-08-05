export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const conversationId = (formData.get('conversationId') as string) || 'default';
    const userId = (formData.get('userId') as string) || 'anonymous';
    const messageId = (formData.get('messageId') as string) || '';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const attachmentId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const originalFilename = file.name;
    const fileExtension = originalFilename.includes('.')
      ? originalFilename.slice(originalFilename.lastIndexOf('.')).toLowerCase()
      : '';
    const mimeType = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    const sanitizeName = originalFilename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `${userId}/${conversationId}/${Date.now()}_${sanitizeName}`;

    const supabase = getSupabase();
    let publicUrl = '';

    if (supabase) {
      try {
        const fileBuffer = Buffer.from(await file.arrayBuffer());

        // Ensure storage bucket exists
        try {
          await supabase.storage.createBucket('chat-attachments', { public: true });
        } catch {}

        // Upload binary file to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('chat-attachments')
          .upload(storagePath, fileBuffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('chat-attachments')
            .getPublicUrl(storagePath);
          publicUrl = urlData.publicUrl;
        } else {
          console.warn('[Supabase Storage Upload Warning]', uploadError.message);
        }

        // Insert metadata record into chat_attachments table
        const { error: dbError } = await supabase.from('chat_attachments').upsert({
          id: attachmentId,
          conversation_id: conversationId,
          message_id: messageId || null,
          user_id: userId,
          original_filename: originalFilename,
          storage_path: storagePath,
          public_url: publicUrl || `/api/attachments/raw/${attachmentId}`,
          mime_type: mimeType,
          file_extension: fileExtension,
          size_bytes: sizeBytes,
          created_at: new Date().toISOString(),
          status: 'uploaded',
          deleted: false,
        });

        if (dbError) {
          console.warn('[Supabase DB Attachment Warning]', dbError.message);
        }
      } catch (err: any) {
        console.error('[Supabase Attachment Processing Error]', err?.message);
      }
    }

    // Fallback URL generation if storage public URL unavailable
    if (!publicUrl) {
      publicUrl = `blob:${attachmentId}`;
    }

    const attachmentPayload = {
      id: attachmentId,
      name: originalFilename,
      url: publicUrl,
      storagePath,
      mimeType,
      fileExtension,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      attachment: attachmentPayload,
    });
  } catch (error: any) {
    console.error('Attachment upload API error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}
