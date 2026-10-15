import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const secret = request.headers.get('notion-webhook-secret');
  if (!secret || secret !== process.env.NOTION_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const properties = (payload as { data?: { properties?: Record<string, unknown> } })?.data?.properties;

    if (!properties) {
      return NextResponse.json({ skipped: true, reason: 'No properties found' });
    }

    const statusSelect = (properties['סטטוס'] as { select?: { name?: string } } | undefined)?.select?.name;
    const typeSelect = (properties['סוג'] as { select?: { name?: string } } | undefined)?.select?.name;

    if (typeSelect !== 'באג') {
      return NextResponse.json({ skipped: true, reason: 'Not a bug' });
    }

    if (statusSelect !== 'טופל') {
      return NextResponse.json({ skipped: true, reason: 'Status is not resolved' });
    }

    const emailProperty = properties['מדווח/ת'] as
      | { email?: string }
      | undefined;

    const reporterEmail = emailProperty?.email;

    if (!reporterEmail) {
      return NextResponse.json({ error: 'No reporter email found' }, { status: 422 });
    }

    const appUrl = process.env.APP_URL ?? '';
    const fromAddress = process.env.RESEND_FROM ?? '';

    const { error } = await resend.emails.send({
      from: fromAddress,
      to: reporterEmail,
      subject: 'הבאג שדיווחת עליו טופל',
      text: `שלום,\n\nרצינו לעדכן אותך שהבאג שדיווחת עליו טופל.\n\nניתן לצפות באפליקציה כאן: ${appUrl}\n\nתודה על הדיווח!`,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}