import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { SENDERS, SITE_DOMAIN, SITE_NAME } from '@/lib/constants';

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

interface ProfessionalHirePDFProps {
  professionalName: string;
  clientName: string;
  referenceNumber: string;
  hireDate: string;
  verificationDate: string;
}

export function ProfessionalHireSummaryPDF({
  professionalName,
  clientName,
  referenceNumber,
  hireDate,
  verificationDate,
}: ProfessionalHirePDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Professional Hire Summary</Text>
          <Text style={styles.subtitle}>{SITE_NAME}</Text>
        </View>

        <View style={styles.refBox}>
          <Text style={styles.refLabel}>Reference Number</Text>
          <Text style={styles.refNumber}>{referenceNumber}</Text>
        </View>

        <Text style={styles.paragraph}>
          Dear {professionalName}, congratulations on your placement with {clientName} through Baby Bloom. This document summarises the key terms and obligations of your arrangement.
        </Text>
        <Text style={styles.paragraph}>Hire confirmed: {hireDate}</Text>
        <Text style={styles.paragraph}>Your verification date: {verificationDate}</Text>

        <Text style={styles.sectionTitle}>1. Contractor Status</Text>
        <Text style={styles.paragraph}>
          You are an independent contractor, not an employee of Baby Bloom or the family. Baby Bloom does not control how you perform childcare, does not provide work equipment, and does not withhold tax from your payments. You may work for other platforms, families, or services simultaneously.
        </Text>

        <Text style={styles.sectionTitle}>2. ABN &amp; Insurance</Text>
        <Text style={styles.paragraph}>
          You are responsible for registering your ABN with the ATO, paying all income taxes, and arranging your own superannuation contributions and public liability insurance. You are not entitled to paid leave, sick leave, penalties, loadings, or other employee benefits.
        </Text>

        <Text style={styles.sectionTitle}>3. EdTech Tools</Text>
        <Text style={styles.paragraph}>
          You may optionally use Baby Bloom&apos;s EdTech developmental logging tools to record the child&apos;s milestones and activities. The family will have access to this data. Third-party AI analysis may be used.
        </Text>

        <Text style={styles.sectionTitle}>4. Affiliate Acknowledgment</Text>
        <Text style={styles.paragraph}>
          Baby Bloom may receive affiliate commissions from third-party products or services recommended on the Platform. These will always be disclosed.
        </Text>

        <Text style={styles.sectionTitle}>5. Confidentiality</Text>
        <Text style={styles.paragraph}>
          You must keep all information about the family, their children, household, location, and routines strictly confidential. You must not disclose any such information on any public or semi-public platform. This obligation survives termination of the arrangement.
        </Text>

        <Text style={styles.sectionTitle}>6. Baby Bloom&apos;s Commitments</Text>
        <Text style={styles.paragraph}>
          Baby Bloom commits to maintaining the Platform, providing support, and complying with the Privacy Act 1988 (Cth) and Australian Privacy Principles.
        </Text>

        <Text style={styles.sectionTitle}>7. Data Retention</Text>
        <Text style={styles.paragraph}>
          Your placement data will be retained for 5 years after the placement ends, as required for regulatory and dispute resolution purposes. You can request deletion of non-essential data at any time by contacting {SENDERS.privacy}.
        </Text>

        <Text style={styles.sectionTitle}>8. Email Preferences</Text>
        <Text style={styles.paragraph}>
          You can manage your email preferences at any time from your Baby Bloom dashboard settings. Essential emails (security, legal, placement-related) cannot be unsubscribed from.
        </Text>

        <Text style={styles.sectionTitle}>9. Important Links</Text>
        <Text style={styles.listItem}>Professional Terms of Service: {SITE_DOMAIN}/legal/professional-terms</Text>
        <Text style={styles.listItem}>Privacy Policy: {SITE_DOMAIN}/legal/privacy-policy</Text>
        <Text style={styles.listItem}>Code of Conduct: {SITE_DOMAIN}/legal/code-of-conduct</Text>
        <Text style={styles.listItem}>ATO ABN Registration: abr.business.gov.au</Text>

        <View style={styles.footer}>
          <Text>{SITE_NAME}</Text>
          <Text>Document generated: {new Date().toLocaleDateString('en-GB')}</Text>
          <Text>This document is for your records. Please retain it for the duration of the arrangement.</Text>
        </View>
      </Page>
    </Document>
  );
}
