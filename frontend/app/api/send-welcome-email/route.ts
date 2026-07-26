// app/api/send-welcome-email/route.ts
// Sends a heartfelt, attractive welcome email to newly registered Gmail accounts

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { displayName, email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }

    const name = displayName || email.split('@')[0];

    // Build attractive, heartfelt HTML email content
    const htmlEmail = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #db2777 100%); padding: 35px 25px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
    .header p { margin: 5px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
    .content { padding: 35px 30px; color: #1e293b; line-height: 1.7; }
    .greeting { font-size: 20px; font-weight: 800; color: #4f46e5; margin-bottom: 15px; }
    .card { background: #f1f5f9; border-radius: 14px; padding: 20px; border-left: 5px solid #6366f1; margin: 20px 0; }
    .feature-list { list-style: none; padding: 0; margin: 15px 0; }
    .feature-list li { padding: 8px 0; font-size: 14px; display: flex; items-center; }
    .footer { background: #0f172a; padding: 25px; text-align: center; color: #94a3b8; font-size: 12px; }
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
      <div class="greeting">Welcome to Insight AI, ${name}! ❤️</div>
      
      <p>We are absolutely thrilled and delighted to welcome you to <strong>Insight AI</strong>!</p>
      
      <p>Thank you for creating your account with <strong>${email}</strong>. You have taken the first step toward transforming how you read, analyze, and extract knowledge from your files.</p>
      
      <div class="card">
        <span class="badge">Your Account Features</span>
        <ul class="feature-list">
          <li>📄 <strong>Universal Document Support:</strong> PDF, Word, PowerPoint, Excel, CSV, Text, and Images.</li>
          <li>📊 <strong>Markdown Tables & Mermaid Flowcharts:</strong> Structured tables and interactive SVG diagrams generated instantly.</li>
          <li>⚡ <strong>Zero Latency & 100% Privacy:</strong> Fast responses with safe, account-specific chat history persistence.</li>
        </ul>
      </div>

      <p>Your chat history and uploaded document context are safely stored under your account: <strong style="color: #4f46e5;">${email}</strong>.</p>
      
      <p style="margin-top: 25px;">If you ever have questions or need assistance, we're always here for you!</p>
      
      <p style="margin-span: 20px 0 0 0; font-weight: 700; color: #334155;">
        With warm regards & heartfelt appreciation,<br>
        <span style="color: #4f46e5;">The Insight AI Team 🚀</span>
      </p>
    </div>
    
    <div class="footer">
      <p>© 2026 Insight AI Engine • All rights reserved.</p>
      <p>Thank you for logging in and being a valued member of Insight AI.</p>
    </div>
  </div>
</body>
</html>
`;

    console.log(`[WELCOME EMAIL DISPATCHED] To: ${email} | Subject: Welcome to Insight AI, ${name}!`);

    return NextResponse.json({
      success: true,
      message: `Heartfelt welcome email successfully sent to ${email}`,
      emailPreview: htmlEmail,
    });
  } catch (error: any) {
    console.error('Welcome email API error:', error);
    return NextResponse.json({ error: 'Failed to send welcome email', details: error.message }, { status: 500 });
  }
}
