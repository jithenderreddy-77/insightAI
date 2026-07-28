// app/api/send-welcome-email/route.ts
// Sends a heartfelt, attractive welcome & thank-you email to users upon login/registration

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: Request) {
  try {
    const { displayName, email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }

    const name = displayName || email.split('@')[0];
    const gmailUser = process.env.GMAIL_SMTP_USER;
    const gmailPass = process.env.GMAIL_SMTP_APP_PASSWORD;
    const resendApiKey = process.env.RESEND_API_KEY;

    // Build attractive, heartfelt HTML email content
    const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 25px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%); padding: 40px 30px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; text-transform: uppercase; letter-spacing: 2px; }
    .content { padding: 40px 35px; color: #1e293b; line-height: 1.7; }
    .greeting { font-size: 22px; font-weight: 800; color: #4f46e5; margin-bottom: 18px; }
    .card { background: linear-gradient(135deg, #f1f5f9 0%, #eef2ff 100%); border-radius: 16px; padding: 22px; border-left: 6px solid #6366f1; margin: 24px 0; }
    .feature-list { list-style: none; padding: 0; margin: 15px 0 0 0; }
    .feature-list li { padding: 8px 0; font-size: 14px; color: #334155; }
    .footer { background: #0f172a; padding: 28px; text-align: center; color: #94a3b8; font-size: 12px; }
    .badge { display: inline-block; padding: 6px 16px; background: #e0e7ff; color: #3730a3; font-weight: 700; border-radius: 20px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insight AI</h1>
      <p>Extract Intelligence from PDFs & Documents</p>
    </div>
    
    <div class="content">
      <div class="greeting">Welcome & Thanks for Choosing Insight AI, ${name}! ❤️</div>
      
      <p>We are absolutely thrilled and honored to welcome you to <strong>Insight AI</strong>!</p>
      
      <p>Thank you for choosing <strong>Insight AI</strong> as your intelligent document assistant. Your account (<strong>${email}</strong>) is now active and ready to help you analyze, search, summarize, and extract deep insights from all your files instantly.</p>
      
      <div class="card">
        <span class="badge">🚀 What You Can Do With Insight AI</span>
        <ul class="feature-list">
          <li>📄 <strong>Universal File Support:</strong> Upload PDF, Word, PowerPoint, Excel, CSV, Text, and Images.</li>
          <li>📊 <strong>Interactive Flowcharts & Tables:</strong> Automatically generate high-resolution SVG flowcharts and structured tables.</li>
          <li>⚡ <strong>Zero Latency & Total Privacy:</strong> Powered by hybrid Cloud AI & built-in offline RAG engines.</li>
        </ul>
      </div>

      <p>Your chat sessions and document context are securely saved under your account profile: <strong style="color: #4f46e5;">${email}</strong>.</p>
      
      <p style="margin-top: 25px;">If you have any questions or feedback, simply reply to this email. We're excited to have you on board!</p>
      
      <p style="margin: 25px 0 0 0; font-weight: 700; color: #334155;">
        With warm regards & gratitude,<br>
        <span style="color: #4f46e5;">The Insight AI Team 🚀</span>
      </p>
    </div>
    
    <div class="footer">
      <p>© 2026 Insight AI Engine • All rights reserved.</p>
      <p>Thank you for choosing Insight AI!</p>
    </div>
  </div>
</body>
</html>
`;

    let emailSent = false;
    let sendMethod = 'none';

    // 1. Try Gmail SMTP if configured
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
          from: `"Insight AI" <${gmailUser}>`,
          to: email,
          subject: `Welcome to Insight AI, ${name}! Thanks for choosing us 🚀`,
          html: htmlEmail,
        });

        emailSent = true;
        sendMethod = 'Gmail SMTP';
      } catch (err: any) {
        console.error('[WELCOME GMAIL SMTP FAILED]:', err.message);
      }
    }

    // 2. Try Resend API if configured
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
            to: [email],
            subject: `Welcome to Insight AI, ${name}! Thanks for choosing us 🚀`,
            html: htmlEmail,
          }),
        });

        if (res.ok) {
          emailSent = true;
          sendMethod = 'Resend API';
        }
      } catch (err: any) {
        console.error('[WELCOME RESEND API FAILED]:', err.message);
      }
    }

    console.log(`[WELCOME EMAIL DISPATCH] To: ${email} | Method: ${sendMethod} | Success: ${emailSent}`);

    return NextResponse.json({
      success: true,
      emailSent,
      sendMethod,
      message: emailSent
        ? `Heartfelt welcome email successfully sent to ${email}`
        : `Welcome notification processed for ${email}`,
    });
  } catch (error: any) {
    console.error('Welcome email API error:', error);
    return NextResponse.json({ error: 'Failed to send welcome email', details: error.message }, { status: 500 });
  }
}
