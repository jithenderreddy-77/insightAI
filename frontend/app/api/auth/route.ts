// app/api/auth/route.ts
// Server-side authentication API — Supabase is the SOURCE OF TRUTH for all accounts & chats.
// localStorage is just a local cache. This guarantees zero data loss across redeployments.

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
    const body = await req.json();
    const { action } = body;

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Database not configured. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
    }

    // ──────────────────────────────────────────────
    // ACTION: REGISTER — Create a new user account
    // ──────────────────────────────────────────────
    if (action === 'register') {
      const { id, username, displayName, email, passwordHash, createdAt } = body;

      if (!email || !passwordHash) {
        return NextResponse.json({ success: false, error: 'Email and password are required' });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Check if account already exists in DB
      const { data: existing, error: checkError } = await supabase
        .from('user_accounts')
        .select('id, email')
        .or(`email.eq.${cleanEmail},username.eq.${cleanEmail}`)
        .limit(1);

      if (checkError) {
        console.error('Registration DB check error:', checkError);
      }

      if (existing && existing.length > 0) {
        return NextResponse.json({ success: false, error: 'Account with this email already exists. Please sign in instead.' });
      }

      // Insert new account into Supabase
      const { error } = await supabase.from('user_accounts').upsert({
        id: id || `user_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
        username: username || cleanEmail,
        display_name: displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        password_hash: passwordHash,
        avatar: null,
        created_at: createdAt || new Date().toISOString(),
      });

      if (error) {
        console.error('Registration DB error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Database error during registration' });
      }

      return NextResponse.json({ success: true });
    }

    // ──────────────────────────────────────────────
    // ACTION: LOGIN — Authenticate user from DB
    // ──────────────────────────────────────────────
    if (action === 'login') {
      const { email, passwordHash } = body;

      if (!email) {
        return NextResponse.json({ success: false, error: 'Email is required' });
      }

      const cleanEmail = email.trim().toLowerCase();

      const { data: accounts, error: loginError } = await supabase
        .from('user_accounts')
        .select('*')
        .or(`email.eq.${cleanEmail},username.eq.${cleanEmail}`)
        .limit(1);

      if (loginError) {
        console.error('Login DB query error:', loginError);
        return NextResponse.json({ success: false, error: loginError.message || 'Database query error during login' });
      }

      if (!accounts || accounts.length === 0) {
        return NextResponse.json({ success: false, error: 'Account not found. Please create an account first.' });
      }

      const found = accounts[0];

      if (found.password_hash !== passwordHash) {
        return NextResponse.json({ success: false, error: 'Incorrect password. Please try again.' });
      }

      return NextResponse.json({
        success: true,
        account: {
          id: found.id,
          username: found.username,
          displayName: found.display_name,
          email: found.email,
          avatar: found.avatar,
          passwordHash: found.password_hash,
          createdAt: found.created_at,
        },
      });
    }

    // ──────────────────────────────────────────────
    // ACTION: GOOGLE_AUTH — Register or login via Google OTP-verified Gmail
    // ──────────────────────────────────────────────
    if (action === 'google_auth') {
      const { id, email, displayName, passwordHash, createdAt } = body;

      if (!email) {
        return NextResponse.json({ success: false, error: 'Gmail is required' });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Check if account exists
      const { data: existing, error: queryError } = await supabase
        .from('user_accounts')
        .select('*')
        .or(`email.eq.${cleanEmail},username.eq.${cleanEmail}`)
        .limit(1);

      if (queryError) {
        console.error('Google auth DB check error:', queryError);
      }

      if (existing && existing.length > 0) {
        // Existing account — return it
        const found = existing[0];
        return NextResponse.json({
          success: true,
          account: {
            id: found.id,
            username: found.username,
            displayName: found.display_name,
            email: found.email,
            avatar: found.avatar,
            passwordHash: found.password_hash,
            createdAt: found.created_at,
          },
        });
      }

      // New Google account — create it
      const newId = id || `user_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const { error } = await supabase.from('user_accounts').upsert({
        id: newId,
        username: cleanEmail,
        display_name: displayName || cleanEmail.split('@')[0],
        email: cleanEmail,
        password_hash: passwordHash,
        avatar: null,
        created_at: createdAt || new Date().toISOString(),
      });

      if (error) {
        console.error('Google auth DB error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Database error during Google authentication' });
      }

      return NextResponse.json({
        success: true,
        account: { id: newId, username: cleanEmail, displayName, email: cleanEmail, passwordHash, createdAt },
      });
    }

    // ──────────────────────────────────────────────
    // ACTION: CHECK_ACCOUNT — Check if account exists in DB (for local cache miss)
    // ──────────────────────────────────────────────
    if (action === 'check_account') {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ success: false, error: 'Email is required' });
      }

      const cleanEmail = email.trim().toLowerCase();

      const { data: accounts, error: dbErr } = await supabase
        .from('user_accounts')
        .select('*')
        .or(`email.eq.${cleanEmail},username.eq.${cleanEmail}`)
        .limit(1);

      if (dbErr) {
        return NextResponse.json({ success: false, error: dbErr.message });
      }

      if (accounts && accounts.length > 0) {
        const found = accounts[0];
        return NextResponse.json({
          success: true,
          exists: true,
          account: {
            id: found.id,
            username: found.username,
            displayName: found.display_name,
            email: found.email,
            avatar: found.avatar,
            passwordHash: found.password_hash,
            createdAt: found.created_at,
          },
        });
      }

      return NextResponse.json({ success: true, exists: false });
    }

    // ──────────────────────────────────────────────
    // ACTION: SAVE_THREAD — Save chat thread to DB
    // ──────────────────────────────────────────────
    if (action === 'save_thread') {
      const { userId, thread } = body;

      if (!userId || !thread || !thread.id) {
        return NextResponse.json({ success: false, error: 'userId and thread details are required' });
      }

      const { error } = await supabase.from('user_chats').upsert({
        id: thread.id,
        user_id: userId,
        title: thread.title || 'Untitled Chat',
        messages: thread.messages || [],
        file_names: thread.fileNames || [],
        created_at: thread.createdAt || new Date().toISOString(),
        updated_at: thread.updatedAt || new Date().toISOString(),
      });

      if (error) console.error('Thread save DB error:', error);
      return NextResponse.json({ success: !error, error: error ? error.message : undefined });
    }

    // ──────────────────────────────────────────────
    // ACTION: GET_THREADS — Load all chat threads for a user from DB
    // ──────────────────────────────────────────────
    if (action === 'get_threads') {
      const { userId } = body;

      if (!userId) {
        return NextResponse.json({ success: false, error: 'userId is required' });
      }

      const { data: threads, error: getErr } = await supabase
        .from('user_chats')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (getErr) {
        console.error('Get threads DB error:', getErr);
        return NextResponse.json({ success: false, error: getErr.message, threads: [] });
      }

      const mapped = (threads || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        messages: t.messages,
        fileNames: t.file_names || [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));

      return NextResponse.json({ success: true, threads: mapped });
    }

    // ──────────────────────────────────────────────
    // ACTION: GET_ALL_ADMIN — Get all accounts + chats for Admin Portal
    // ──────────────────────────────────────────────
    if (action === 'get_all_admin') {
      const { data: dbAccounts, error: accErr } = await supabase.from('user_accounts').select('*').order('created_at', { ascending: false });
      const { data: dbChats, error: chatErr } = await supabase.from('user_chats').select('*').order('updated_at', { ascending: false });
      return NextResponse.json({
        success: true,
        accounts: dbAccounts || [],
        chats: dbChats || [],
        errors: accErr || chatErr ? { accounts: accErr?.message, chats: chatErr?.message } : undefined,
      });
    }

    // ──────────────────────────────────────────────
    // ACTION: DELETE_THREAD — Delete a chat thread from DB
    // ──────────────────────────────────────────────
    if (action === 'delete_thread') {
      const { threadId } = body;
      if (!threadId) {
        return NextResponse.json({ success: false, error: 'threadId is required' });
      }
      const { error } = await supabase.from('user_chats').delete().eq('id', threadId);
      return NextResponse.json({ success: !error, error: error ? error.message : undefined });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' });
  } catch (error: any) {
    console.error('Auth API error:', error);
    return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 });
  }
}

