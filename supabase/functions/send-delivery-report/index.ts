// Supabase Edge Function: szállítólevél automatikus e-mail küldése melléklettel.
// Szükséges secret: RESEND_API_KEY és RESEND_FROM.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Csak POST kérés engedélyezett.' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM = Deno.env.get('RESEND_FROM');
  const authHeader = request.headers.get('Authorization') || '';

  if (!authHeader.startsWith('Bearer ')) return json({ ok: false, error: 'Hiányzó bejelentkezés.' }, 401);
  if (!RESEND_API_KEY || !RESEND_FROM) return json({ ok: false, error: 'A RESEND_API_KEY vagy RESEND_FROM secret nincs beállítva.' }, 500);

  let reportId = null;
  try {
    const body = await request.json();
    reportId = body?.reportId || null;
    if (!reportId) return json({ ok: false, error: 'Hiányzó reportId.' }, 400);

    // A felhasználó saját JWT-jével kérjük le a riportot: az RLS ellenőrzi a jogosultságot.
    const reportResponse = await fetch(`${SUPABASE_URL}/rest/v1/delivery_reports?id=eq.${encodeURIComponent(reportId)}&select=*`, {
      headers: { apikey: ANON_KEY, Authorization: authHeader },
    });
    const reportRows = await reportResponse.json();
    if (!reportResponse.ok || !reportRows?.[0]) return json({ ok: false, error: 'A riport nem található vagy nincs hozzá jogosultság.' }, 403);
    const report = reportRows[0];
    if (report.email_status === 'sent') return json({ ok: true, alreadySent: true, messageId: report.provider_message_id });

    const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const [settingsResponse, filesResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/app_settings?id=eq.1&select=delivery_email`, { headers: serviceHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/delivery_report_files?report_id=eq.${encodeURIComponent(reportId)}&select=*&order=created_at.asc`, { headers: serviceHeaders }),
    ]);
    const settingsRows = await settingsResponse.json();
    const files = await filesResponse.json();
    if (!settingsResponse.ok) throw new Error('Az e-mail beállítás nem olvasható.');
    if (!filesResponse.ok) throw new Error('A mellékletek listája nem olvasható.');
    const recipient = settingsRows?.[0]?.delivery_email || 'szabo.sandor@stand98';

    const attachments = [];
    for (const file of files || []) {
      const signResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/delivery-docs/${file.storage_path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST',
        headers: { ...serviceHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 300 }),
      });
      const signed = await signResponse.json();
      if (!signResponse.ok || !signed?.signedURL) throw new Error(`Nem készíthető letöltési link: ${file.file_name}`);
      const downloadUrl = /^https?:/i.test(signed.signedURL) ? signed.signedURL : signed.signedURL.startsWith('/storage/v1') ? `${SUPABASE_URL}${signed.signedURL}` : `${SUPABASE_URL}/storage/v1${signed.signedURL.startsWith('/') ? '' : '/'}${signed.signedURL}`;
      const fileResponse = await fetch(downloadUrl);
      if (!fileResponse.ok) throw new Error(`Nem tölthető le a melléklet: ${file.file_name}`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      attachments.push({ filename: file.file_name, content: bytesToBase64(bytes), content_type: file.mime_type });
    }

    const subject = `${report.project_name || 'Projekt'} – ${report.order_no || 'rendelés'}`;
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `delivery-report-${report.id}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [recipient],
        subject,
        html: `<p>Projekt: <b>${report.project_name || '-'}</b></p><p>Rendelésszám: <b>${report.order_no || '-'}</b></p><p>Feltöltő: ${report.created_by || '-'}</p><p>${report.note || ''}</p>`,
        attachments,
      }),
    });
    const resendData = await resendResponse.json();
    if (!resendResponse.ok) throw new Error(resendData?.message || resendData?.error || 'Az e-mail szolgáltató elutasította a küldést.');

    await fetch(`${SUPABASE_URL}/rest/v1/delivery_reports?id=eq.${encodeURIComponent(report.id)}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        email_status: 'sent', email_to: recipient, email_error: null,
        email_sent_at: new Date().toISOString(), provider_message_id: resendData.id || null,
      }),
    });

    return json({ ok: true, emailTo: recipient, subject, messageId: resendData.id || null, attachmentCount: attachments.length });
  } catch (error) {
    if (reportId) {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
      const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      await fetch(`${SUPABASE_URL}/rest/v1/delivery_reports?id=eq.${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email_status: 'failed', email_error: error instanceof Error ? error.message : String(error) }),
      }).catch(() => {});
    }
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
