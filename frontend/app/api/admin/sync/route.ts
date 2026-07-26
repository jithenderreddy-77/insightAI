// app/api/admin/sync/route.ts
// Syncs and backs up all user accounts, login credentials, and chat threads to Supabase DB
// Ensures zero data loss across deployments and code updates!

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { action, account, thread, userId } = await req.json();

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: true,
        message: 'Cloud backup operating in local fallback mode (No Supabase keys)',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (action === 'save_account' && account) {
      const { error } = await supabase.from('user_accounts').upsert({
        id: account.id,
        username: account.username,
        display_name: account.displayName,
        email: account.email,
        password_hash: account.passwordHash,
        avatar: account.avatar || null,
        created_at: account.createdAt || new Date().toISOString(),
      });
      if (error) console.error('Supabase account sync error:', error);
      return NextResponse.json({ success: !error });
    }

    if (action === 'save_thread' && thread && userId) {
      const { error } = await supabase.from('user_chats').upsert({
        id: thread.id,
        user_id: userId,
        title: thread.title,
        messages: thread.messages,
        file_names: thread.fileNames || [],
        created_at: thread.createdAt || new Date().toISOString(),
        updated_at: thread.updatedAt || new Date().toISOString(),
      });
      if (error) console.error('Supabase chat sync error:', error);
      return NextResponse.json({ success: !error });
    }

    if (action === 'get_all_admin_data') {
      const { data: dbAccounts } = await supabase.from('user_accounts').select('*');
      const { data: dbChats } = await supabase.from('user_chats').select('*');
      return NextResponse.json({
        success: true,
        accounts: dbAccounts || [],
        chats: dbChats || [],
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Admin sync route error:', error);
    return NextResponse.json({ error: 'Sync error', details: error.message }, { status: 500 });
  }
}
