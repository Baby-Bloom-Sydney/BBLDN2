import { createAdminClient } from '@/lib/supabase/admin';
import { APP_LOCALE, SITE_URL } from '@/lib/constants';
import { sendEmail } from './resend';
import { generateClientHirePDF, generateProfessionalHirePDF } from '@/lib/pdf/generate-hire-pdf';
import { buildClientHireConfirmationEmail } from './templates/client-hire-confirmation';
import { buildProfessionalHireConfirmationEmail } from './templates/professional-hire-confirmation';

const appUrl = SITE_URL;

interface HireEmailParams {
  placementId: string;
  nannyId: string;
  parentId: string;
  parentName: string;
  nannyName: string;
  parentEmail: string;
  nannyEmail: string;
  parentUserId: string;
  nannyUserId: string;
}

/**
 * Generates hire summary PDFs and sends confirmation emails to both parent and nanny.
 * Should be called fire-and-forget after placement creation — failures are logged but never block.
 */
export async function sendHireConfirmationEmails(params: HireEmailParams): Promise<void> {
  const {
    placementId, nannyId, parentName, nannyName,
    parentEmail, nannyEmail, parentUserId, nannyUserId,
  } = params;

  const adminClient = createAdminClient();
  const hireDate = new Date().toLocaleDateString(APP_LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Fetch nanny verification date
  const { data: nanny } = await adminClient
    .from('nannies')
    .select('user_id')
    .eq('id', nannyId)
    .single();

  let verificationDate = hireDate; // fallback
  if (nanny?.user_id) {
    const { data: verification } = await adminClient
      .from('verifications')
      .select('created_at')
      .eq('user_id', nanny.user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (verification?.created_at) {
      verificationDate = new Date(verification.created_at).toLocaleDateString(APP_LOCALE, {
        day: 'numeric', month: 'long', year: 'numeric',
      });
    }
  }

  // Generate PDFs (both also upload to Supabase Storage)
  const [clientPdf, proPdf] = await Promise.all([
    generateClientHirePDF({
      clientName: parentName,
      professionalName: nannyName,
      hireDate,
      verificationDate,
      hireId: placementId,
    }),
    generateProfessionalHirePDF({
      professionalName: nannyName,
      clientName: parentName,
      hireDate,
      verificationDate,
      hireId: placementId,
    }),
  ]);

  // Build and send client (parent) email
  if (clientPdf) {
    const email = buildClientHireConfirmationEmail({
      clientName: parentName,
      professionalName: nannyName,
      referenceNumber: clientPdf.referenceNumber,
      hireDate,
      wwccPortalLink: 'https://service.nsw.gov.au/transaction/apply-for-a-working-with-children-check',
      edtechLink: `${appUrl}/parent`,
    });

    await sendEmail({
      to: parentEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      emailType: 'hire_confirmation_client',
      recipientUserId: parentUserId,
      attachments: [{ filename: clientPdf.filename, content: clientPdf.buffer }],
    });
  }

  // Build and send professional (nanny) email
  if (proPdf) {
    const email = buildProfessionalHireConfirmationEmail({
      professionalName: nannyName,
      clientName: parentName,
      referenceNumber: proPdf.referenceNumber,
      hireDate,
      edtechLink: `${appUrl}/nanny`,
    });

    await sendEmail({
      to: nannyEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      emailType: 'hire_confirmation_professional',
      recipientUserId: nannyUserId,
      attachments: [{ filename: proPdf.filename, content: proPdf.buffer }],
    });
  }

  console.log(`[HireEmails] Sent hire confirmation emails for placement ${placementId}`);
}
