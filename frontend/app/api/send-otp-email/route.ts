// app/api/send-otp-email/route.ts
// Sends a REAL 6-digit OTP verification code email to Gmail accounts using Nodemailer + Gmail SMTP

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: Request) {
  try {
    const { email, otpCode, displayName } = await req.json();

    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Email and OTP code are required' }, { status: 400 });
    }

    const gmailUser = process.env.GMAIL_SMTP_USER;
    const gmailPass = process.env.GMAIL_SMTP_APP_PASSWORD;

    if (!gmailUser || !gmailPass) {
      console.error('[OTP EMAIL] GMAIL_SMTP_USER or GMAIL_SMTP_APP_PASSWORD not set in .env.local');
      return NextResponse.json({
        success: false,
        error: 'Email service not configured. Set GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD in .env.local',
      }, { status: 500 });
    }

    const name = displayName || email.split('@')[0];

    // Create Gmail SMTP transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    // Build beautiful HTML email
    const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 520px; margin: 25px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%); padding: 28px 25px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 900; }
    .header p { margin: 4px 0 0 0; font-size: 11px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
    .content { padding: 30px; color: #1e293b; text-align: center; }
    .otp-box { background: linear-gradient(135deg, #eef2ff 0%, #faf5ff 100%); border-radius: 16px; padding: 24px; border: 2px dashed #6366f1; margin: 20px 0; }
    .otp-code { font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #4f46e5; font-family: 'Courier New', monospace; margin: 8px 0; }
    .warning { font-size: 11px; color: #ef4444; font-weight: 700; margin-top: 8px; }
    .footer { background: #0f172a; padding: 20px; text-align: center; color: #94a3b8; font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insight AI</h1>
      <p>Secure Email Verification</p>
    </div>
    
    <div class="content">
      <h2 style="color: #1e293b; margin-top: 0; font-size: 18px;">Hello ${name},</h2>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Your secret verification code for signing into <strong style="color: #4f46e5;">Insight AI</strong> is:
      </p>
      
      <div class="otp-box">
        <div style="font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 2px;">
          Verification Code
        </div>
        <div class="otp-code">${otpCode}</div>
        <div style="font-size: 12px; color: #64748b;">
          This code expires in <strong>10 minutes</strong>.
        </div>
        <div class="warning">Do not share this code with anyone.</div>
      </div>
      
      <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
        If you did not request this code, please ignore this email.
      </p>
    </div>
    
    <div class="footer">
      <p>&copy; 2026 Insight AI &bull; Secure Google Authentication</p>
    </div>
  </div>
</body>
</html>
`;

    // Send the email via Gmail SMTP
    await transporter.sendMail({
      from: `"Insight AI" <${gmailUser}>`,
      to: email,
      subject: `${otpCode} — Your Insight AI Verification Code`,
      html: htmlEmail,
    });

    console.log(`[OTP EMAIL SENT] To: ${email} | Code: ${otpCode}`);

    return NextResponse.json({
      success: true,
      message: `Verification code sent to ${email}`,
    });
  } catch (error: any) {
    console.error('OTP email send error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to send verification email',
      details: error.message,
    }, { status: 500 });
  }
}
