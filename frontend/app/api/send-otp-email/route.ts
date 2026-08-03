// app/api/send-otp-email/route.ts
// Generates and dispatches 6-digit OTP verification email to Gmail accounts with rate limiting & multi-layer fallback

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { generateOTP } from '@/lib/otp-store';

export async function POST(req: Request) {
  try {
    const { email, displayName } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Valid email address is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Generate OTP server-side with rate-limiting check
    const otpResult = generateOTP(normalizedEmail);
    if (!otpResult.success || !otpResult.otpCode) {
      return NextResponse.json(
        { error: otpResult.error || 'Rate limit exceeded. Please wait before requesting another code.' },
        { status: 429 }
      );
    }

    const otpCode = otpResult.otpCode;
    const name = displayName || normalizedEmail.split('@')[0];

    // CONSOLE DISPLAY FOR LOCAL/DEV TESTING DISCOVERY
    console.log('\n======================================================');
    console.log(`🔑 [INSIGHT AI LOCAL OTP CODE]: ${otpCode} (For: ${normalizedEmail})`);
    console.log('======================================================\n');

    const gmailUser = process.env.GMAIL_SMTP_USER;
    const gmailPass = process.env.GMAIL_SMTP_APP_PASSWORD;
    const resendApiKey = process.env.RESEND_API_KEY;

    let emailSent = false;
    let sendMethod = 'none';

    // HTML Email Template with Prominent OTP Code & Security Instructions
    const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 520px; margin: 25px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%); padding: 28px 25px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 900; }
    .header p { margin: 4px 0 0 0; font-size: 11px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
    .content { padding: 30px; color: #1e293b; text-align: center; }
    .otp-box { background: linear-gradient(135deg, #eef2ff 0%, #faf5ff 100%); border-radius: 16px; padding: 24px; border: 2px dashed #6366f1; margin: 20px 0; }
    .otp-code { font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #4f46e5; font-family: 'Courier New', monospace; margin: 8px 0; }
    .notice { font-size: 12px; color: #64748b; margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 15px; }
    .footer { background: #0f172a; padding: 20px; text-align: center; color: #94a3b8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insight AI</h1>
      <p>Google Account Verification</p>
    </div>
    
    <div class="content">
      <h2 style="color: #1e293b; margin-top: 0;">Hello ${name},</h2>
      <p>Your 6-digit secret verification code for signing into <strong>Insight AI</strong> is:</p>
      
      <div class="otp-box">
        <div style="font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 2px;">One-Time Verification Code</div>
        <div class="otp-code">${otpCode}</div>
        <div style="font-size: 12px; color: #64748b;">This code expires in 10 minutes.</div>
      </div>

      <div class="notice">
        <p>If you did not request this verification code, please ignore this email. Your Google account remains secure.</p>
      </div>
    </div>
    
    <div class="footer">
      <p>&copy; 2026 Insight AI Engine • Secure Google OAuth Verification</p>
    </div>
  </div>
</body>
</html>
`;

    // 2. Try Gmail SMTP if configured
    if (gmailUser && gmailPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: gmailUser,
            pass: gmailPass,
          },
        });

        await transporter.sendMail({
          from: `"Insight AI Security" <${gmailUser}>`,
          to: normalizedEmail,
          subject: `${otpCode} — Your Insight AI Verification Code`,
          html: htmlEmail,
        });

        emailSent = true;
        sendMethod = 'Gmail SMTP';
      } catch (err: any) {
        console.error('[GMAIL SMTP FAILED]:', err.message);
      }
    }

    // 3. Try Resend API if configured
    if (!emailSent && resendApiKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Insight AI <onboarding@resend.dev>',
            to: [normalizedEmail],
            subject: `${otpCode} — Your Insight AI Verification Code`,
            html: htmlEmail,
          }),
        });

        if (res.ok) {
          emailSent = true;
          sendMethod = 'Resend API';
        }
      } catch (err: any) {
        console.error('[RESEND API FAILED]:', err.message);
      }
    }

    console.log(`[OTP DISPATCH STATUS] Email: ${normalizedEmail} | Method: ${sendMethod} | Success: ${emailSent}`);

    // SECURITY: Never return the OTP code in the API response
    return NextResponse.json({
      success: true,
      emailSent,
      sendMethod,
      message: emailSent
        ? `Verification code sent to ${normalizedEmail}`
        : `Verification code generated for ${normalizedEmail} (Check console log if SMTP credentials not configured locally)`,
    });
  } catch (error: any) {
    console.error('OTP route error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
