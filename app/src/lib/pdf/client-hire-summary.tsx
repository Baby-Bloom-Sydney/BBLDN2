import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { SITE_DOMAIN, SITE_NAME } from '@/lib/constants';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 11, color: '#1e293b' },
  header: { marginBottom: 24, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#64748b' },
  refBox: { backgroundColor: '#f5f3ff', padding: 12, borderRadius: 8, marginBottom: 20, textAlign: 'center' },
  refLabel: { fontSize: 10, color: '#64748b', marginBottom: 2 },
  refNumber: { fontSize: 16, fontWeight: 'bold', color: '#7c3aed' },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', marginTop: 16, marginBottom: 6 },
  paragraph: { lineHeight: 1.6, marginBottom: 8 },
  listItem: { marginLeft: 12, marginBottom: 4, lineHeight: 1.5 },
  footer: { marginTop: 32, paddingTop: 16, borderTop: '1 solid #e2e8f0', fontSize: 9, color: '#94a3b8', textAlign: 'center' },
});

interface ClientHirePDFProps {
  clientName: string;
  professionalName: string;
  referenceNumber: string;
  hireDate: string;
  verificationDate: string;
}

export function ClientHireSummaryPDF({
  clientName,
  professionalName,
  referenceNumber,
  hireDate,
  verificationDate,
}: ClientHirePDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Client Hire Summary</Text>
          <Text style={styles.subtitle}>{SITE_NAME}</Text>
        </View>

        <View style={styles.refBox}>
          <Text style={styles.refLabel}>Reference Number</Text>
          <Text style={styles.refNumber}>{referenceNumber}</Text>
        </View>

        <Text style={styles.paragraph}>
          Dear {clientName}, congratulations on confirming your hire of {professionalName} through Baby Bloom. This document summarises the key terms and obligations of your arrangement.
        </Text>
        <Text style={styles.paragraph}>Hire confirmed: {hireDate}</Text>
        <Text style={styles.paragraph}>Professional verified: {verificationDate}</Text>

        <Text style={styles.sectionTitle}>1. Employer Obligations</Text>
        <Text style={styles.paragraph}>
          As the employer, you are responsible for compliance with the Fair Work Act 2009 (Cth), including correct pay rates, superannuation, and working conditions. Baby Bloom is a facilitator only and is not the employer of your nanny. You should seek independent legal and financial advice about your obligations as an employer.
        </Text>

        <Text style={styles.sectionTitle}>2. WWCC Monitoring</Text>
        <Text style={styles.paragraph}>
          Baby Bloom verified {professionalName}&apos;s Working With Children Check (WWCC) at onboarding on {verificationDate}. However, WWCC status can change. You are responsible for linking to their WWCC via Service NSW for ongoing status alerts. Baby Bloom does not guarantee ongoing WWCC validity.
        </Text>

        <Text style={styles.sectionTitle}>3. EdTech Developmental Logging</Text>
        <Text style={styles.paragraph}>
          You may optionally use Baby Bloom&apos;s EdTech tools. Your nanny can record the child&apos;s developmental milestones, activities, and observations. Data is stored on Baby Bloom servers and accessible to you. Third-party AI analysis may be used.
        </Text>

        <Text style={styles.sectionTitle}>4. AI Content Notice</Text>
        <Text style={styles.paragraph}>
          Some content on the Platform, including nanny bios and matching summaries, is generated using AI (OpenAI GPT-4o or similar). AI-generated content is labelled and should be independently verified.
        </Text>

        <Text style={styles.sectionTitle}>5. Baby Bloom&apos;s Commitments</Text>
        <Text style={styles.paragraph}>
          Baby Bloom commits to maintaining the Platform, providing support, and ensuring all professionals have been WWCC and identity verified at onboarding. We comply with the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
        </Text>

        <Text style={styles.sectionTitle}>6. Important Links</Text>
        <Text style={styles.listItem}>Client Terms of Service: {SITE_DOMAIN}/legal/client-terms</Text>
        <Text style={styles.listItem}>Privacy Policy: {SITE_DOMAIN}/legal/privacy-policy</Text>
        <Text style={styles.listItem}>Code of Conduct: {SITE_DOMAIN}/legal/code-of-conduct</Text>
        <Text style={styles.listItem}>Service NSW WWCC: service.nsw.gov.au/transaction/apply-for-a-working-with-children-check</Text>

        <View style={styles.footer}>
          <Text>{SITE_NAME}</Text>
          <Text>Document generated: {new Date().toLocaleDateString('en-GB')}</Text>
          <Text>This document is for your records. Please retain it for the duration of the arrangement.</Text>
        </View>
      </Page>
    </Document>
  );
}
