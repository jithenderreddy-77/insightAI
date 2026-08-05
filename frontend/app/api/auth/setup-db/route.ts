// app/api/auth/setup-db/route.ts
// One-time database setup — Creates the user_accounts and user_chats tables in Supabase
// Run once by visiting: /api/auth/setup-db

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try creating user_accounts table via insert (Supabase auto-creates if using the dashboard)
    // First, test if tables exist by doing a select
    const { error: accountsError } = await supabase.from('user_accounts').select('id').limit(1);
    const { error: chatsError } = await supabase.from('user_chats').select('id').limit(1);
    const { error: attachmentsError } = await supabase.from('chat_attachments').select('id').limit(1);

    const results: string[] = [];

    if (accountsError) {
      results.push(`user_accounts table status: ${accountsError.message} — Please create it in Supabase Dashboard.`);
    } else {
      results.push('user_accounts table: EXISTS and accessible');
    }

    if (chatsError) {
      results.push(`user_chats table status: ${chatsError.message} — Please create it in Supabase Dashboard.`);
    } else {
      results.push('user_chats table: EXISTS and accessible');
    }

    if (attachmentsError) {
      results.push(`chat_attachments table status: ${attachmentsError.message} — Please create it in Supabase Dashboard.`);
    } else {
      results.push('chat_attachments table: EXISTS and accessible');
    }

    const sqlInstructions = `
-- Run this SQL in your Supabase Dashboard > SQL Editor to create the required tables & storage:

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user_accounts(id) ON DELETE CASCADE,
  title TEXT,
  messages JSONB DEFAULT '[]'::jsonb,
  file_names JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES user_chats(id) ON DELETE CASCADE,
  message_id TEXT,
  user_id TEXT REFERENCES user_accounts(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT,
  file_extension TEXT,
  size_bytes BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'uploaded',
  deleted BOOLEAN DEFAULT FALSE,
  thumbnail_url TEXT,
  checksum TEXT
);

-- Enable Row Level Security
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on user_accounts" ON user_accounts FOR ALL USING (true);
CREATE POLICY "Service role full access on user_chats" ON user_chats FOR ALL USING (true);
CREATE POLICY "Service role full access on chat_attachments" ON chat_attachments FOR ALL USING (true);
`;

    return NextResponse.json({
      success: true,
      tableStatus: results,
      sqlToRun: sqlInstructions,
      instructions: 'If tables do not exist, go to your Supabase Dashboard > SQL Editor and run the SQL above.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
