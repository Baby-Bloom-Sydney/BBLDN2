import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Legal & Contact Information | Baby Bloom',
};

export default function DisclaimerPage() {
  return (
    <article>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Baby Bloom, Sydney &mdash; Legal &amp; Contact Information</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: 13 March 2026</p>
      </header>
      <div className="prose prose-sm prose-slate max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:text-slate-600 prose-li:text-slate-600">

        <h2>1. About Baby Bloom, Sydney</h2>
        <p>Baby Bloom, Sydney is a childcare technology platform that connects families with qualified childcare professionals across New South Wales, Australia. The platform provides a facilitated introduction service (matchmaking and babysitting) and an optional post-hire EdTech SaaS subscription.</p>
        <p>Baby Bloom, Sydney is <strong>not</strong> an employer, employment agency, or recruitment agency. We operate as a technology-enabled facilitator under a Product-Led Growth model. All employment relationships are formed directly between Clients and Childcare Professionals.</p>

        <hr />

        <h2>2. Business Details</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Detail</th>
                <th>Information</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Trading name</strong></td>
                <td>Baby Bloom, Sydney</td>
              </tr>
              <tr>
                <td><strong>ABN</strong></td>
                <td>17 463 812 867</td>
              </tr>
              <tr>
                <td><strong>Jurisdiction</strong></td>
                <td>New South Wales, Australia</td>
              </tr>
              <tr>
                <td><strong>Governing law</strong></td>
                <td>Laws of New South Wales and the Commonwealth of Australia</td>
              </tr>
              <tr>
                <td><strong>Registered Office</strong></td>
                <td>19 St Neot Avenue, Sydney NSW 2011</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr />

        <h2>3. Contact Information</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>General enquiries</strong></td>
                <td><a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a></td>
              </tr>
              <tr>
                <td><strong>Support</strong></td>
                <td><a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a></td>
              </tr>
              <tr>
                <td><strong>Compliance &amp; Legal</strong></td>
                <td><a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a></td>
              </tr>
              <tr>
                <td><strong>Website</strong></td>
                <td><a href="https://babybloomsydney.com.au" target="_blank" rel="noopener noreferrer">https://babybloomsydney.com.au</a></td>
              </tr>
              <tr>
                <td><strong>Physical address</strong></td>
                <td>19 St Neot Avenue, Sydney NSW 2011</td>
              </tr>
              <tr>
                <td><strong>Response time</strong></td>
                <td>We aim to respond to all enquiries within 2 business days</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr />

        <h2>4. Privacy &amp; Data Enquiries</h2>
        <p>For requests relating to access, correction, or deletion of your personal information under the Australian Privacy Principles:</p>
        <ul>
          <li><strong>Privacy enquiries:</strong> <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> (preferred) or <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a></li>
          <li><strong>Subject line:</strong> &ldquo;Privacy Request &mdash; [Your Name]&rdquo; (required for us to prioritize and track your request)</li>
          <li><strong>Email:</strong> <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> (preferred for privacy enquiries)</li>
          <li><strong>Response time:</strong> Acknowledgement within 5 business days of receipt; resolution within 30 days of receipt (not from acknowledgement)</li>
        </ul>
        <p><strong>Example calculation:</strong></p>
        <ul>
          <li>Request received: Monday, 14 March 2026</li>
          <li>Acknowledgement sent: Friday, 18 March 2026 (5 business days)</li>
          <li>Response deadline: Friday, 11 April 2026 (30 days from receipt, not from acknowledgement)</li>
        </ul>

        <h3>Privacy Complaints to OAIC</h3>
        <p>If you believe Baby Bloom has breached the Australian Privacy Principles, you have the right to lodge a complaint with the Office of the Australian Information Commissioner (OAIC):</p>
        <ul>
          <li><strong>Website:</strong> <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">www.oaic.gov.au</a></li>
          <li><strong>Email:</strong> <a href="mailto:enquiries@oaic.gov.au">enquiries@oaic.gov.au</a></li>
          <li><strong>Phone:</strong> 1300 363 424</li>
          <li><strong>Postal address:</strong> Level 3, 175 Pitt Street, Sydney NSW 2000</li>
        </ul>
        <p><strong>What to include in your complaint:</strong></p>
        <ul>
          <li>Your name and contact details</li>
          <li>Description of how Baby Bloom handled your personal information</li>
          <li>Which Australian Privacy Principle(s) you believe were breached (e.g., &ldquo;APP 1 &mdash; collection without consent&rdquo;)</li>
          <li>What harm or loss you suffered (if any)</li>
          <li>What outcome you are seeking (e.g., correction of data, compensation)</li>
        </ul>
        <p><strong>Response from OAIC:</strong></p>
        <ul>
          <li>The OAIC will assess your complaint and may investigate</li>
          <li>If the OAIC finds a breach, it can recommend changes and award compensation up to $4,500 (or more if pursued in court)</li>
          <li>The OAIC process is free and independent of Baby Bloom</li>
        </ul>
        <p><strong>Note:</strong> Before complaining to the OAIC, you should first lodge a complaint with Baby Bloom (see Section 5 &mdash; Complaints). The OAIC prefers disputes to be resolved internally first.</p>

        <hr />

        <h2>5. Complaints &amp; Disputes</h2>

        <h3>Internal Complaint Process</h3>
        <p>If you have a complaint about the Platform or our services:</p>
        <ol>
          <li><strong>Step 1:</strong> Email <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a> or <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> with the subject line &ldquo;Complaint &mdash; [Brief Description]&rdquo;</li>
          <li><strong>Step 2:</strong> We will acknowledge your complaint within 5 business days</li>
          <li><strong>Step 3:</strong> We will investigate and provide a written response within 14 business days</li>
          <li><strong>Step 4:</strong> If your complaint is resolved to your satisfaction, the matter is closed</li>
        </ol>

        <h3>External Dispute Resolution (ACL Compliance)</h3>
        <p>If you are not satisfied with Baby Bloom&apos;s response or the complaint is not resolved, you have the right to access an external, independent dispute resolution scheme:</p>
        <p><strong>For disputes under $10,000:</strong></p>
        <ul>
          <li><strong>NSW Civil and Administrative Tribunal (NCAT)</strong>
            <ul>
              <li>Website: <a href="https://www.ncat.nsw.gov.au" target="_blank" rel="noopener noreferrer">www.ncat.nsw.gov.au</a></li>
              <li>Phone: 1300 006 228</li>
              <li>NCAT can hear complaints about consumer rights and can award compensation</li>
            </ul>
          </li>
        </ul>
        <p><strong>For privacy complaints:</strong></p>
        <ul>
          <li><strong>Office of the Australian Information Commissioner (OAIC)</strong>
            <ul>
              <li>Website: <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">www.oaic.gov.au</a></li>
              <li>Email: <a href="mailto:enquiries@oaic.gov.au">enquiries@oaic.gov.au</a></li>
              <li>Phone: 1300 363 424</li>
              <li>The OAIC can investigate privacy breaches and award compensation for loss or damage</li>
            </ul>
          </li>
        </ul>
        <p><strong>For broader consumer law concerns:</strong></p>
        <ul>
          <li><strong>Australian Competition and Consumer Commission (ACCC)</strong>
            <ul>
              <li>Website: <a href="https://www.accc.gov.au" target="_blank" rel="noopener noreferrer">www.accc.gov.au</a></li>
              <li>Lodge a complaint at <a href="https://www.accc.gov.au/contact-us" target="_blank" rel="noopener noreferrer">www.accc.gov.au/contact-us</a></li>
            </ul>
          </li>
        </ul>
        <p><strong>For consumer rights in NSW:</strong></p>
        <ul>
          <li><strong>NSW Fair Trading</strong>
            <ul>
              <li>Website: <a href="https://www.fairtrading.nsw.gov.au" target="_blank" rel="noopener noreferrer">www.fairtrading.nsw.gov.au</a></li>
              <li>Phone: 13 32 20</li>
            </ul>
          </li>
        </ul>
        <p><strong>Baby Bloom&apos;s Commitment:</strong></p>
        <p>We will cooperate fully with any external dispute resolution investigation and provide requested information promptly.</p>
        <p><strong>Note on Timelines:</strong></p>
        <p>External bodies may take longer than 14 days to resolve disputes. See each body&apos;s website for timeframes.</p>

        <hr />

        <h2>6. Legal Documents</h2>
        <p>The following legal documents govern your use of the Baby Bloom platform. All documents are available for review at any time.</p>

        <h3>For Clients (Parents &amp; Families)</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><Link href="/legal/client-terms">Client Terms of Service</Link></td>
                <td>Your agreement with Baby Bloom when using the platform as a Client</td>
              </tr>
              <tr>
                <td><Link href="/legal/privacy-policy">Privacy Policy</Link></td>
                <td>How we collect, use, and protect your personal information</td>
              </tr>
              <tr>
                <td><Link href="/legal/code-of-conduct">Code of Conduct</Link></td>
                <td>Expected behaviour standards for all platform users</td>
              </tr>
              <tr>
                <td><Link href="/legal/cookies">Cookie Policy</Link></td>
                <td>How we use cookies and similar tracking technologies</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>For Childcare Professionals (Nannies)</h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><Link href="/legal/professional-terms">Professional Terms of Service</Link></td>
                <td>Your agreement with Baby Bloom when using the platform as a Childcare Professional</td>
              </tr>
              <tr>
                <td><Link href="/legal/privacy-policy">Privacy Policy</Link></td>
                <td>How we collect, use, and protect your personal information</td>
              </tr>
              <tr>
                <td><Link href="/legal/biometric-notice">Biometric Data Collection Notice</Link></td>
                <td>How we collect and process biometric data during identity verification</td>
              </tr>
              <tr>
                <td><Link href="/legal/code-of-conduct">Code of Conduct</Link></td>
                <td>Expected behaviour standards for all platform users</td>
              </tr>
              <tr>
                <td><Link href="/legal/cookies">Cookie Policy</Link></td>
                <td>How we use cookies and similar tracking technologies</td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr />

        <h2>7. Reporting</h2>

        <h3>Report Through Baby Bloom</h3>
        <p>If you want to also report through Baby Bloom (for platform records), use:</p>
        <ul>
          <li><strong>In-app:</strong> Use the &ldquo;Report Concern&rdquo; function in your dashboard</li>
          <li><strong>Email:</strong> <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a> with the subject line &ldquo;URGENT &mdash; Child Safety&rdquo;</li>
        </ul>
        <h3>Platform Safety &amp; Misconduct</h3>
        <p>To report misconduct, inappropriate behaviour, or a safety concern relating to a platform user:</p>
        <ul>
          <li><strong>In-app:</strong> Use the Incident &amp; Accident Report form available in your dashboard</li>
          <li><strong>Email:</strong> <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a> with the subject line &ldquo;Safety Report &mdash; [Brief Description]&rdquo;</li>
        </ul>

        <h3>Online Safety (eSafety Commissioner)</h3>
        <p>If you believe content on Baby Bloom (messages, posts, photos) is harmful or violates online safety laws (e.g., cyberbullying, image-based abuse, adult content involving minors), you can report to the eSafety Commissioner:</p>
        <ul>
          <li><strong>Website:</strong> <a href="https://www.esafety.gov.au" target="_blank" rel="noopener noreferrer">www.esafety.gov.au</a></li>
          <li>The eSafety Commissioner can investigate and require content to be removed</li>
          <li><strong>Examples of reportable content:</strong> harassment, bullying, image-based abuse, harmful content involving minors</li>
        </ul>

        <hr />

        <h2>8. External Regulators &amp; Resources</h2>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Body</th>
                <th>Jurisdiction</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Office of the Australian Information Commissioner (OAIC)</strong></td>
                <td>Privacy complaints</td>
                <td><a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">www.oaic.gov.au</a></td>
              </tr>
              <tr>
                <td><strong>Australian Competition &amp; Consumer Commission (ACCC)</strong></td>
                <td>Consumer rights and unfair contract terms</td>
                <td><a href="https://www.accc.gov.au" target="_blank" rel="noopener noreferrer">www.accc.gov.au</a></td>
              </tr>
              <tr>
                <td><strong>NSW Fair Trading</strong></td>
                <td>Consumer complaints (NSW)</td>
                <td><a href="https://www.fairtrading.nsw.gov.au" target="_blank" rel="noopener noreferrer">www.fairtrading.nsw.gov.au</a></td>
              </tr>
              <tr>
                <td><strong>eSafety Commissioner</strong></td>
                <td>Online safety complaints</td>
                <td><a href="https://www.esafety.gov.au" target="_blank" rel="noopener noreferrer">www.esafety.gov.au</a></td>
              </tr>
              <tr>
                <td><strong>Office of the Children&apos;s Guardian (NSW)</strong></td>
                <td>Working With Children Check enquiries</td>
                <td><a href="https://www.ocg.nsw.gov.au" target="_blank" rel="noopener noreferrer">www.ocg.nsw.gov.au</a></td>
              </tr>
              <tr>
                <td><strong>Fair Work Ombudsman</strong></td>
                <td>Employment entitlements (for hired professionals)</td>
                <td><a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer">www.fairwork.gov.au</a></td>
              </tr>
            </tbody>
          </table>
        </div>

        <hr />

        <h2>9. Spam Act 2003 &mdash; Sender Identification</h2>
        <p>This page serves as the sender identification record for all commercial electronic messages sent by Baby Bloom, Sydney, in compliance with the Spam Act 2003 (Cth). All commercial emails sent by Baby Bloom include:</p>
        <ul>
          <li>The sender&apos;s name (Baby Bloom, Sydney)</li>
          <li>The sender&apos;s ABN (17 463 812 867)</li>
          <li>A link to this page for full contact details and physical address</li>
          <li>A functional unsubscribe mechanism</li>
        </ul>
        <p><strong>Note:</strong> All commercial emails sent by Baby Bloom include a link to this page as required by the Spam Act 2003 (Cth). This satisfies our obligation to provide you with the sender&apos;s identity and contact information in every marketing email.</p>

        <hr />

        <h2>10. Accessibility</h2>
        <p><strong>Commitment:</strong> Baby Bloom is committed to providing an accessible website for all users, including those with disabilities.</p>
        <p><strong>Standards Compliance:</strong> This website aims to conform to WCAG 2.1 Level AA (Web Content Accessibility Guidelines).</p>
        <p><strong>Accessibility Features:</strong></p>
        <ul>
          <li>Text alternatives for images</li>
          <li>Keyboard navigation</li>
          <li>High color contrast</li>
          <li>Readable fonts and resizable text</li>
          <li>Clear document structure and headings</li>
        </ul>
        <p><strong>Request Alternative Formats:</strong></p>
        <p>If you have difficulty accessing any of our legal documents or features, or require them in an alternative format (large print, Braille, audio, plain language), please contact us:</p>
        <ul>
          <li><strong>Email:</strong> <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a></li>
          <li><strong>Subject:</strong> &ldquo;Accessibility Request&rdquo;</li>
          <li>We will make reasonable efforts to accommodate your request within 5 business days</li>
        </ul>
        <p><strong>Accessibility Issues:</strong></p>
        <p>If you identify an accessibility issue on this website, please report it to us immediately so we can fix it. Email: <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a></p>

        <hr />

        <p><em>Baby Bloom, Sydney | ABN: 17 463 812 867 | <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a> | <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a> | <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> | <a href="https://babybloomsydney.com.au" target="_blank" rel="noopener noreferrer">https://babybloomsydney.com.au</a> | Office hours: Monday-Friday, 9am-5pm AEDT</em></p>
      </div>
    </article>
  );
}
