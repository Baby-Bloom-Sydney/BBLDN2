import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Client Terms of Service | Baby Bloom',
};

export default function ClientTermsPage() {
  return (
    <article>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Baby Bloom &mdash; Client Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Version 1.0 | Last updated: 13 March 2026 | Effective date: 13 March 2026</p>
      </header>
      <div className="prose prose-sm prose-slate max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:text-slate-600 prose-li:text-slate-600">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the Baby Bloom platform (&ldquo;Platform&rdquo;) operated by Baby Bloom, Sydney (&ldquo;Baby Bloom&rdquo;, &ldquo;the Agency&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By creating a Client account, you agree to be bound by these Terms and our <Link href="/legal/privacy-policy">Privacy Policy</Link>.
        </p>

        <hr />

        <h2>1. Definitions</h2>
        <p>In these Terms:</p>
        <ul>
          <li><strong>&ldquo;Client&rdquo;</strong> or <strong>&ldquo;Legal Guardian&rdquo;</strong> means a parent or legal guardian who creates a Client account on the Platform.</li>
          <li><strong>&ldquo;Childcare Professional&rdquo;</strong> or <strong>&ldquo;Professional&rdquo;</strong> means a nanny, carer, or babysitter registered on the Platform.</li>
          <li><strong>&ldquo;Baby Bloom&rdquo;</strong> or <strong>&ldquo;the Agency&rdquo;</strong> means Baby Bloom, Sydney, ABN 17 463 812 867.</li>
          <li><strong>&ldquo;Connection&rdquo;</strong> means a facilitated introduction between a Client and a Childcare Professional through the Platform (whether via matchmaking or babysitting booking).</li>
          <li><strong>&ldquo;Hire&rdquo;</strong> means the point at which both parties confirm to Baby Bloom that an ongoing care arrangement has been agreed.</li>
          <li><strong>&ldquo;Platform&rdquo;</strong> means the Baby Bloom website and all associated services.</li>
          <li><strong>&ldquo;EdTech SaaS&rdquo;</strong> means Baby Bloom&apos;s educational technology software subscription bundle, activated after a Hire is confirmed.</li>
          <li><strong>&ldquo;WWCC&rdquo;</strong> means a Working With Children Check issued under the Child Protection (Working with Children) Act 2012 (NSW).</li>
        </ul>

        <hr />

        <h2>2. Platform Nature &amp; Facilitator Acknowledgment</h2>
        <p>2.1. Baby Bloom is a digital facilitator and educational technology software provider. Baby Bloom is <strong>not</strong> an employer, recruitment agency, labour hire firm, or placement service.</p>
        <p>2.2. Baby Bloom facilitates introductions between Clients and Childcare Professionals and provides EdTech software tools for use after a Hire is confirmed. Baby Bloom does not employ, manage, supervise, or direct Childcare Professionals.</p>
        <p>2.3. You acknowledge that any care arrangement entered into following a Connection is a direct relationship between you and the Childcare Professional. Baby Bloom is not a party to that arrangement.</p>
        <p>2.4. <strong>Explicit Informed Consent</strong>: By creating your account or proceeding to a Connection, you confirm that: (a) you have read this entire Terms of Service and the Privacy Policy; (b) you understand and agree to be bound by these Terms; (c) you are at least 18 years old and are the legal guardian of any child(ren) on your account; (d) you consent to the collection and use of your personal information as described in the Privacy Policy; and (e) you understand that Baby Bloom&apos;s role is limited to facilitation and that you bear responsibility for conducting your own due diligence on any Professional you hire.</p>

        <hr />

        <h2>3. Eligibility &amp; Age Verification</h2>
        <p>3.1. To create a Client account, you must:</p>
        <ul>
          <li>(a) be at least 18 years of age;</li>
          <li>(b) reside in New South Wales, Australia; and</li>
          <li>(c) be the legal guardian of any child(ren) registered on your account.</li>
        </ul>
        <p>3.2. Your age and identity are verified during the registration process. If you do not reside in NSW, you will be unable to access the Platform&apos;s connection and service features.</p>

        <hr />

        <h2>4. Account Registration &amp; Responsibilities</h2>
        <p>4.1. You agree to provide accurate, current, and complete information when creating your account and to update this information promptly if it changes.</p>
        <p>4.2. You are responsible for maintaining a valid email address associated with your account. Legal notices, Hire documents, and material updates are sent to this email address. Baby Bloom is not responsible for communications you do not receive due to an invalid or unmonitored email address.</p>
        <p>4.3. You are responsible for maintaining the security of your account credentials. You must notify Baby Bloom immediately if you become aware of any unauthorised use of your account.</p>
        <p>4.4. Each household may hold one Client account.</p>

        <hr />

        <h2>5. The Connection Process</h2>
        <p>5.1. A <strong>Connection</strong> is a facilitated introduction between you and a Childcare Professional. There are two types:</p>
        <ul>
          <li>(a) <strong>Matchmaking Connection:</strong> Baby Bloom matches you with a Professional based on your stated preferences, availability, and location. Upon connection, you receive the Professional&apos;s phone number.</li>
          <li>(b) <strong>Babysitting Connection:</strong> You post a babysitting request, which is broadcast to matching Professionals. Upon mutual approval, you receive the Professional&apos;s phone number and the Professional receives your home address.</li>
        </ul>
        <p>5.2. Before each Connection, you will be asked to accept a Connection Agreement. This is a separate consent at the moment of action, specific to that connection. It includes your explicit consent for contact details to be shared.</p>
        <p>5.3. <strong>Verification scope:</strong> Baby Bloom verifies each Professional&apos;s WWCC validity and identity at onboarding. Baby Bloom does <strong>not</strong> conduct police or criminal background checks, reference checks, qualification verification, conduct interviews, or physical vetting. You are responsible for conducting your own due diligence, including reference checks, trial shifts, and interviews, before hiring any Professional.</p>
        <p>5.4. <strong>Verification Levels</strong>:</p>
        <ul>
          <li><strong>Level 3 (Provisionally Verified)</strong>: Identity and WWCC documents have been uploaded and verified by Baby Bloom&apos;s system. The Professional&apos;s profile is visible to you but Connections are disabled until final verification is complete.</li>
          <li><strong>Level 4 (Fully Verified)</strong>: The Professional has passed human review of identity and WWCC. The Professional&apos;s profile is fully visible and Connections are enabled. Final verification typically takes 3-5 business days from submission.</li>
        </ul>
        <p>Connections are <strong>only enabled</strong> with Fully Verified (Level 4) Professionals.</p>
        <p>5.5. <strong>The Gap Period</strong>: The period between a Connection and a Hire (including meet and greets, trial shifts, and decision-making) is between you and the Professional. Baby Bloom does not monitor or supervise these interactions.</p>
        <p><strong>However</strong>, Baby Bloom remains responsible for the accuracy of its verification at the time of Connection. If you later discover that the Professional&apos;s WWCC was expired or invalid at the time of Connection due to Baby Bloom&apos;s verification error, Baby Bloom remains liable for that breach of duty. Additionally, Baby Bloom continues to monitor the Professional&apos;s WWCC status during the Gap Period. If the Professional&apos;s WWCC expires or is revoked, Baby Bloom will pause their account and notify you immediately.</p>

        <hr />

        <h2>6. The Hire Process</h2>
        <p>6.1. A <strong>Hire</strong> occurs when both you and the Professional confirm to Baby Bloom that an ongoing care arrangement has been agreed.</p>
        <p>6.2. Upon Hire confirmation, Baby Bloom sends you a congratulatory email with your Client Hire PDF attached. This PDF is your formal legal record of the Hire and summarises your obligations as an employer. If email delivery fails, Baby Bloom will notify you via in-platform inbox.</p>
        <p>6.3. The EdTech SaaS subscription activates upon Hire confirmation.</p>

        <hr />

        <h2>7. Employer of Record &amp; Whole-of-Relationship Test</h2>
        <p>7.1. When you hire a Childcare Professional, <strong>you become the employer</strong>. Baby Bloom is not the employer and does not assume any employer obligations.</p>
        <p>7.2. <strong>IMPORTANT: Fair Work Act Whole-of-Relationship Test</strong>: Under the Fair Work Act 2009 (Cth) s.15AA (effective 26 August 2024), courts must examine the <strong>substance and practical reality</strong> of the working relationship, not just the contract label. The Professional&apos;s status as an &ldquo;independent contractor&rdquo; (as set out in their ToS) will be respected <strong>only if</strong> the relationship genuinely reflects independent contractor characteristics in practice. Your obligations as an employer include:</p>
        <ul>
          <li>Treating the Professional fairly and consistently with the contract terms</li>
          <li>Not exercising excessive control or direction over how work is performed</li>
          <li>Respecting the Professional&apos;s freedom to decline work or work for other families</li>
          <li>Paying agreed rates in full and on time</li>
          <li>Providing a safe workplace environment</li>
        </ul>
        <p>If you exercise control over the Professional&apos;s work in a way that contradicts their independent contractor status (e.g., requiring exclusive availability, setting rates unilaterally, directing how care is provided), you may be found to be the employer for Fair Work purposes, with liability for unpaid superannuation, leave entitlements, and penalties.</p>
        <p>7.3. As the employer, you are responsible for:</p>
        <ul>
          <li>(a) <strong>PAYG tax withholding</strong> &mdash; withholding and remitting income tax to the Australian Taxation Office at the applicable rate, with penalties for non-compliance reaching up to 200% of tax owing;</li>
          <li>(b) <strong>Superannuation Guarantee</strong> &mdash; contributing to superannuation at the current rate of 11.5% of ordinary time earnings for ongoing employees earning $450 or more per month, with penalties of 110% of contributions owed for non-payment; and</li>
          <li>(c) <strong>Workers&apos; Compensation</strong> &mdash; obtaining domestic workers&apos; compensation insurance through icare NSW before the Professional commences work, available at <a href="https://www.icare.nsw.gov.au" target="_blank" rel="noopener noreferrer">https://www.icare.nsw.gov.au</a>.</li>
        </ul>
        <p>7.4. <strong>Required Before Hire Commences</strong>: Before the Professional begins work, you <strong>must</strong>:</p>
        <ul>
          <li>Provide the Professional with a written Employment Contract or Services Agreement setting out: hours of work, rate of pay, superannuation arrangement, tax file number requirements, and workers&apos; compensation insurance details</li>
          <li>Collect a completed Tax File Number declaration from the Professional</li>
          <li>Register with the ATO if you have not already done so</li>
          <li>Obtain icare domestic workers&apos; compensation insurance (use the icare Premium Estimator at <a href="https://www.icare.nsw.gov.au" target="_blank" rel="noopener noreferrer">https://www.icare.nsw.gov.au</a>)</li>
          <li>Provide the Professional with a Fair Work Information Statement (available from <a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer">https://www.fairwork.gov.au</a>)</li>
        </ul>
        <p>7.5. Your Client Hire PDF includes detailed guidance on these obligations and links to ATO and icare NSW resources. This guidance is for informational purposes only and does not constitute tax, legal, or financial advice. You <strong>must</strong> seek independent professional advice from an accountant or tax advisor for your specific circumstances, especially regarding withholding rates, superannuation, and workers&apos; compensation premium estimation.</p>
        <p>For specialized legal or compliance questions about your obligations as an employer, contact <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a>. You may also contact:</p>
        <ul>
          <li><strong>ATO:</strong> 13 28 61 | <a href="https://www.ato.gov.au" target="_blank" rel="noopener noreferrer">https://www.ato.gov.au</a></li>
          <li><strong>icare NSW:</strong> 13 16 50 | <a href="https://www.icare.nsw.gov.au" target="_blank" rel="noopener noreferrer">https://www.icare.nsw.gov.au</a></li>
          <li><strong>Fair Work Ombudsman:</strong> 13 13 94 | <a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer">https://www.fairwork.gov.au</a></li>
        </ul>
        <p>7.6. <strong>Discrimination and Fair Treatment</strong>: You agree to treat the Professional fairly and without discrimination based on protected attributes (race, colour, national or ethnic origin, age, sex, sexual orientation, gender identity, intersex status, marital or relationship status, pregnancy, disability, religion, or any other attribute protected under the Anti-Discrimination Act 1977 (NSW) or applicable Commonwealth legislation). You may not change rates, terms, or working conditions on a discriminatory basis.</p>

        <hr />

        <h2>8. Working With Children Check Monitoring</h2>
        <p>8.1. Baby Bloom verifies each Professional&apos;s WWCC at the point of onboarding. Baby Bloom maintains a verification audit trail of this check.</p>
        <p>8.2. Baby Bloom automatically checks WWCC status daily by 9:00 AM AEDT. If a WWCC is expired or revoked, the Professional&apos;s account is automatically paused within 24 hours and all active Connections are cancelled. The Professional is notified of the pause immediately.</p>
        <p>8.3. <strong>Your Independent Monitoring Obligation</strong>: You are responsible for linking yourself to the Professional&apos;s WWCC via Service NSW to receive real-time alerts of any changes to WWCC status. <strong>Do not rely solely on Baby Bloom&apos;s verification.</strong> To verify a Professional&apos;s WWCC:</p>
        <ul>
          <li><strong>Step 1:</strong> Visit <a href="https://www.service.nsw.gov.au/transaction/verify-a-working-with-children-check" target="_blank" rel="noopener noreferrer">https://www.service.nsw.gov.au/transaction/verify-a-working-with-children-check</a></li>
          <li><strong>Step 2:</strong> Enter the Professional&apos;s Working With Children Check number</li>
          <li><strong>Step 3:</strong> Verify that the status is &lsquo;CURRENT&rsquo; or &lsquo;CONDITIONAL&rsquo;</li>
          <li><strong>Step 4:</strong> Register for automatic status alerts to be notified of any future changes</li>
        </ul>
        <p>Instructions are provided in your Client Hire PDF.</p>
        <p>8.4. Baby Bloom&apos;s verification confirms the Professional&apos;s WWCC validity <strong>at the time of onboarding only</strong>. Circumstances may change after onboarding. You bear the responsibility for confirming the Professional&apos;s WWCC status independently via Service NSW before work commences and during the care arrangement.</p>

        <hr />

        <h2>9. Vetting Responsibilities</h2>
        <p>9.1. <strong>Baby Bloom&apos;s responsibilities:</strong></p>
        <ul>
          <li>(a) Verify the Professional&apos;s WWCC validity at onboarding;</li>
          <li>(b) Verify the Professional&apos;s identity via biometric matching at onboarding;</li>
          <li>(c) Automatically pause accounts when a WWCC expires or is revoked.</li>
        </ul>
        <p>9.2. <strong>Your responsibilities:</strong></p>
        <ul>
          <li>(a) Interview the Professional;</li>
          <li>(b) Conduct reference checks;</li>
          <li>(c) Arrange and supervise a trial shift;</li>
          <li>(d) Conduct any additional due diligence you consider necessary; and</li>
          <li>(e) Monitor the Professional&apos;s ongoing WWCC status via Service NSW.</li>
        </ul>
        <p>9.3. Baby Bloom does <strong>not</strong> interview, reference-check, physically vet, or assess the suitability of Childcare Professionals. The decision to hire is yours alone.</p>

        <hr />

        <h2>10. Fees and Charges</h2>
        <p>10.1. <strong>Connection Fees</strong>: Baby Bloom&apos;s matchmaking and babysitting connection services are provided at no charge. You will not be charged a fee for connecting with a Professional.</p>
        <p>10.2. <strong>Optional Premium Matching (Future)</strong>: In future, Baby Bloom may offer optional premium matching services (e.g., faster response times, larger Professional pool) at a disclosed fee. Any premium fees will be clearly disclosed before you are charged.</p>

        <hr />

        <h2>11. EdTech SaaS Subscription</h2>
        <p>11.1. The EdTech SaaS subscription is a separate product from the matchmaking or babysitting connection. The subscription provides educational technology tools including AI-generated activity suggestions, developmental logging, lesson plans, and developmental insights.</p>
        <p>11.2. The EdTech SaaS subscription is automatically activated upon Hire confirmation. The subscription fee is charged at the rate disclosed at the time of Hire confirmation and is due on the date specified in the Hire confirmation.</p>
        <p>11.3. <strong>Cooling-Off Right</strong>: Under Australian Consumer Law, you have a statutory right to cancel your EdTech SaaS subscription within 14 days of purchase without penalty or fees. After the 14-day cooling-off period, you may cancel anytime with a pro-rata refund for any unused subscription time.</p>
        <p>11.4. If the Childcare Professional leaves or the care arrangement ends, your EdTech SaaS subscription remains active unless you cancel it. You may cancel the subscription at any time in accordance with our SaaS Refund &amp; Cancellation Policy.</p>
        <p>11.5. Upon cancellation, you will receive a pro-rata refund for any unused subscription time. Full details are set out in our SaaS Refund &amp; Cancellation Policy. For cancellation requests, email <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>.</p>
        <p>11.6. <strong>Overseas AI Processing Disclosure</strong>: The EdTech SaaS tools use third-party AI providers (including Google Gemini and Anthropic Claude) located in the United States to generate activity suggestions, developmental insights, and lesson plans. Your children&apos;s developmental data and activity history is processed overseas. Baby Bloom has Data Processing Agreements in place with these providers. For full details about overseas data processing, cross-border data transfers, and your rights, see our <Link href="/legal/privacy-policy">Privacy Policy Section 7</Link>.</p>

        <hr />

        <h2>11A. Payment Processing</h2>
        <p>11A.1. All payments for EdTech SaaS subscriptions are processed by <strong>Stripe Payments Australia Pty Ltd</strong> (&ldquo;Stripe&rdquo;). Baby Bloom does not store, process, or have access to your full card number, CVV, or expiry date. All card data is tokenised by Stripe before reaching Baby Bloom&apos;s systems.</p>
        <p>11A.2. Baby Bloom receives from Stripe only: (a) a payment token, (b) last four digits of your card, (c) card brand (Visa, Mastercard, etc.), (d) transaction status, (e) transaction amount, and (f) billing postcode. This information is retained for 7 years in accordance with Australian tax record-keeping obligations.</p>
        <p>11A.3. Stripe is a certified <strong>PCI DSS Level 1 Service Provider</strong> &mdash; the highest level of payment security certification. Stripe&apos;s privacy policy is available at <a href="https://stripe.com/au/privacy" target="_blank" rel="noopener noreferrer">https://stripe.com/au/privacy</a>.</p>
        <p>11A.4. Stripe processes Australian payments within Australia. For fraud detection purposes, Stripe may transfer limited data (IP address, device fingerprint) to Stripe Inc. in the United States. This is disclosed in our <Link href="/legal/privacy-policy">Privacy Policy Section 9</Link>.</p>
        <p>11A.5. <strong>Refunds</strong> are processed through Stripe and typically appear on your statement within 5-10 business days. For refund requests, see our SaaS Refund &amp; Cancellation Policy or contact <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>.</p>
        <p>11A.6. <strong>Chargebacks and disputes</strong>: If you dispute a charge with your bank, Baby Bloom will respond through Stripe&apos;s dispute process. We encourage you to contact <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a> before initiating a bank dispute, as we can often resolve issues faster directly. See our SaaS Refund &amp; Cancellation Policy for our dispute resolution process.</p>

        <hr />

        <h2>12. AI-Generated Content &amp; Safety</h2>
        <p>12.1. The EdTech SaaS tools use artificial intelligence provided by third-party providers (including but not limited to Google Gemini and Anthropic Claude) to generate activity suggestions, lesson plans, and developmental insights.</p>
        <p>12.2. <strong>AI-generated content is not human-reviewed.</strong> You and the Childcare Professional are responsible for assessing all AI-generated activities for age-appropriateness, choking hazards, allergens, and general safety before use with your child(ren).</p>
        <p>12.3. AI-generated developmental insights are educational estimates only. They are <strong>not</strong> paediatric diagnoses, medical advice, or developmental assessments. They do not replace consultation with qualified health professionals.</p>
        <p>12.4. All AI-generated educational content is freely usable and shareable by you and the Childcare Professional. Baby Bloom does not claim intellectual property rights over AI-generated activities.</p>
        <p>12.5. Baby Bloom retains only the right to use genuinely anonymised, aggregated data to improve its AI models. &ldquo;Anonymised&rdquo; means no individual child can be re-identified from the data, in accordance with the OAIC&apos;s guidance on de-identification.</p>

        <hr />

        <h2>13. AI Verification Pipeline</h2>
        <p>13.1. Baby Bloom uses artificial intelligence to assist in identity verification, including passport and ID document reading, selfie-to-ID facial matching, and WWCC card extraction.</p>
        <p>13.2. AI-assisted verification is one layer of a multi-step process. AI is <strong>not</strong> the sole decision-maker. Cases flagged by AI undergo human review by authorised Baby Bloom staff.</p>
        <p>13.3. Baby Bloom maintains audit trails of all AI-assisted verification decisions.</p>
        <p>13.4. <strong>Right to Request Human Review</strong>: If you believe an AI-assisted decision has been made incorrectly (e.g., your identity verification was rejected or flagged), you may request a human review by contacting <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a>. Baby Bloom will conduct a manual review and respond within 5 business days.</p>

        <hr />

        <h2>14. Algorithmic Matching</h2>
        <p>14.1. When you request a matchmaking connection, the Platform uses an algorithm to identify suitable Childcare Professionals based on your stated preferences, availability, location, and the Professional&apos;s verification status.</p>
        <p>14.2. <strong>Transparency</strong>: Baby Bloom will provide you with a detailed explanation of the algorithmic matching process, available at <a href="https://babybloomsydney.com.au/how-matching-works" target="_blank" rel="noopener noreferrer">https://babybloomsydney.com.au/how-matching-works</a>. If you believe the algorithm has made a discriminatory match suggestion (e.g., excluded qualified Professionals on a protected attribute basis), you may report this via <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>. Baby Bloom will review and take corrective action if necessary within 5 business days.</p>
        <p>14.3. <strong>Right to Opt-Out</strong>: You may request manual matching (if available) instead of algorithmic matching by contacting <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>.</p>
        <p>14.4. <strong>Right to Request Human Review</strong>: You may request a human review of an algorithmic matching decision by contacting <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>. Baby Bloom will review the decision and respond within 5 business days.</p>
        <p>14.5. The anti-discrimination provisions in Section 20 apply to algorithmic matching as well as to manually posted job advertisements.</p>

        <hr />

        <h2>15. Children&apos;s Data</h2>
        <p>14.1. <strong>Data Minimization for Babysitting Requests</strong>: When you post a babysitting request, only your children&apos;s ages are shared with potential Childcare Professionals during the broadcast. Detailed information (including special needs, medical conditions, allergies, and dietary requirements) is shared only with the Professional who is matched and approved for the specific booking.</p>
        <p>14.2. <strong>EdTech SaaS Processing</strong>: If you proceed to a Hire, the Childcare Professional may use Baby Bloom&apos;s EdTech tools to log your child&apos;s developmental milestones and activity participation.</p>
        <p>14.3. <strong>Separate Consent for Sensitive Children&apos;s Information</strong>: You will be presented with a standalone <strong>Children&apos;s Sensitive Information Consent Form</strong> at the time of Hire confirmation. This form requires your explicit consent to process sensitive information about your child(ren), including:</p>
        <ul>
          <li>Medical conditions and allergies</li>
          <li>Dietary requirements</li>
          <li>Special needs or developmental concerns</li>
          <li>Medications or emergency medical procedures</li>
        </ul>
        <p>You must tick the categories of sensitive information you consent to before confirming the Hire. <strong>Your acceptance of these Terms does not automatically consent to processing of sensitive children&apos;s information.</strong></p>
        <p>14.4. <strong>Data Retention</strong>: Children&apos;s data is retained for the life of your active account plus 90 days after account closure, in accordance with our <Link href="/legal/privacy-policy">Privacy Policy</Link>. Sensitive children&apos;s information is retained separately and deleted upon your request, subject to legal retention requirements.</p>

        <hr />

        <h2>16. Code of Conduct &amp; Professional Standards</h2>
        <p>16.1. All Childcare Professionals on the Platform are required to comply with Baby Bloom&apos;s <strong>Code of Conduct</strong>, available at <Link href="/legal/code-of-conduct">https://babybloomsydney.com.au/code-of-conduct</Link>. The Code sets out community standards including confidentiality, communication, safe care, and platform integrity. Breaches of the Code may result in account suspension or termination.</p>
        <p>16.2. While Baby Bloom verifies WWCC and identity, <strong>you</strong> are responsible for additional due diligence on any Professional you hire, including background checks, references, and trial periods, as described in Section 9.2.</p>

        <hr />

        <h2>17. User Notifications</h2>
        <p>17.1. Baby Bloom will notify you of material changes to your status on the Platform, including (but not limited to): a Professional declining or being unavailable for a connection, a connection being cancelled by the other party, changes to your account status, and babysitting booking outcomes.</p>
        <p>17.2. Notifications may be delivered via in-platform inbox, email, or both.</p>

        <hr />

        <h2>18. Privacy &amp; Data</h2>
        <p>17.1. Baby Bloom collects, uses, and discloses your personal information in accordance with our <Link href="/legal/privacy-policy">Privacy Policy</Link>. By creating an account, you consent to the collection and use of your personal information as described in the Privacy Policy.</p>
        <p>17.2. You are responsible for ensuring your registered email address is current and monitored. Legal documents (including Hire PDFs) and material notices are sent to this address.</p>

        <hr />

        <h2>20. Online Safety</h2>
        <p>20.1. Baby Bloom complies with the Online Safety Act 2021 (Cth). The Platform provides a mechanism for reporting harmful content.</p>
        <p>20.2. If you encounter harmful, abusive, or threatening content on the Platform, you may report it through the Platform&apos;s reporting mechanism. Baby Bloom will respond to removal notices from the eSafety Commissioner.</p>

        <hr />

        <h2>21. Anti-Discrimination</h2>
        <p>21.1. You must not make any discriminatory request, post any discriminatory job advertisement, or engage in any discriminatory conduct based on race, colour, national or ethnic origin, age, sex, sexual orientation, gender identity, intersex status, marital or relationship status, pregnancy, disability, religion, or any other attribute protected under the Anti-Discrimination Act 1977 (NSW) or applicable Commonwealth legislation.</p>

        <hr />

        <h2>22. Indemnification</h2>
        <p>22.1. You agree to indemnify and hold harmless Baby Bloom, its officers, employees, and agents from and against any claims, damages, losses, liabilities, and expenses (including reasonable legal fees) arising out of or relating to:</p>
        <ul>
          <li>(a) your use of the Platform in breach of these Terms;</li>
          <li>(b) your breach of your obligations as an employer (e.g., failure to withhold tax, provide workers&apos; compensation, pay superannuation);</li>
          <li>(c) any dispute with the Professional regarding the terms of employment, rates of pay, or working conditions;</li>
          <li>(d) any breach of your confidentiality obligations toward the Professional; or</li>
          <li>(e) any illegal conduct by you on or through the Platform.</li>
        </ul>
        <p>22.2. <strong>Excluded from Indemnity</strong>: This indemnity does <strong>not</strong> extend to any liability arising from:</p>
        <ul>
          <li>Baby Bloom&apos;s own negligence, gross negligence, or wilful misconduct</li>
          <li>Baby Bloom&apos;s breach of these Terms or the Privacy Policy</li>
          <li>Baby Bloom&apos;s failure to properly verify the Professional&apos;s WWCC or identity</li>
          <li>Any failure by Baby Bloom to monitor WWCC status as required by Section 8</li>
          <li>Misleading or deceptive conduct by Baby Bloom</li>
          <li>Death or personal injury caused by Baby Bloom&apos;s negligence</li>
        </ul>
        <p>22.3. <strong>Interpretation</strong>: This indemnity is narrowly construed. In case of doubt, the indemnity does not apply to harm caused (in whole or part) by Baby Bloom&apos;s conduct.</p>
        <p>22.4. <strong>Asymmetric Indemnity Protection &mdash; MABLE Compliance</strong>: Baby Bloom acknowledges that this indemnity structure is asymmetric (Client indemnifies Baby Bloom; Baby Bloom does not reciprocally indemnify Client for Clients&apos; employer liability). This reflects the allocation of risk: <strong>Client assumes employer liability by hiring the Professional; Baby Bloom assumes liability for defective facilitation/verification.</strong> This structure was endorsed by the ACCC in the Mable Technologies enforcement action (June 2025) as appropriate for digital facilitators, provided: (a) Baby Bloom does not dictate employment terms to Clients, (b) Baby Bloom&apos;s liability for verification is preserved, (c) the indemnity does not cover Baby Bloom&apos;s own negligence. All three conditions are satisfied in this Terms of Service.</p>

        <hr />

        <h2>23. Limitation of Liability</h2>
        <p>23.1. <strong>Limitation of Liability Cap</strong>: To the maximum extent permitted by the Australian Consumer Law, Baby Bloom&apos;s total liability to you for any claim arising out of or in connection with these Terms or the Platform is limited to the greater of:</p>
        <ul>
          <li>(a) the re-supply of the relevant services; or</li>
          <li>(b) the total EdTech SaaS subscription fees you have paid to Baby Bloom in the 12 months preceding the claim.</li>
        </ul>
        <p>23.2. <strong>Carve-Outs from Limitation</strong>: Notwithstanding s.23.1, <strong>nothing in these Terms excludes or limits</strong> Baby Bloom&apos;s liability for:</p>
        <ul>
          <li>(a) Death or personal injury caused by Baby Bloom&apos;s negligence or gross negligence</li>
          <li>(b) Fraud or intentional misrepresentation by Baby Bloom</li>
          <li>(c) Breach of Baby Bloom&apos;s confidentiality obligations</li>
          <li>(d) Breach of the Australian Consumer Guarantees under the ACL (including implied warranties of acceptable quality, fitness for purpose, or safety)</li>
          <li>(e) Misleading or deceptive conduct under ACL s.134</li>
          <li>(f) Any other liability that cannot be excluded under the Australian Consumer Law</li>
        </ul>
        <p>23.3. <strong>Consumer Guarantees Apply</strong>: Baby Bloom is a service provider under the ACL. The Consumer Guarantees in ACL s.139A apply to the Platform and Baby Bloom&apos;s services. These include implied warranties that services will be provided with due care and skill, within a reasonable time, and at a reasonable cost. Baby Bloom&apos;s liability for breach of these guarantees is not limited by s.23.1 and is not excluded by any other term in these Terms.</p>
        <p>23.4. <strong>Consumer Guarantee Rights Statement</strong>: Nothing in these Terms excludes, restricts, or modifies any consumer guarantee rights you may have under the Australian Consumer Law. These guarantees cannot be excluded and your rights remain fully available.</p>

        <hr />

        <h2>24. Fair Termination</h2>
        <p>24.1. Baby Bloom may terminate or suspend your account in the following circumstances:</p>
        <ul>
          <li>(a) <strong>Immediate termination:</strong> Serious misconduct including child safety violations, fraud, or illegal activity.</li>
          <li>(b) <strong>Termination with notice:</strong> Breach of these Terms, with written notice specifying the breach and 7 days to remedy. If you remedy the breach within 7 days, your account will be restored.</li>
          <li>(c) <strong>Termination with notice:</strong> Any other reasonable grounds, with written notice and a reasonable opportunity to respond.</li>
        </ul>
        <p>24.2. In <strong>all</strong> cases of termination by Baby Bloom, unused EdTech SaaS subscription fees will be refunded to you on a pro-rata basis.</p>
        <p>24.3. <strong>Right to Appeal Termination:</strong> If Baby Bloom terminates your account for breach, you may appeal the termination decision within 14 days by contacting <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> with supporting evidence or documentation.</p>
        <p>24.4. You may terminate your account at any time. Upon termination, the SaaS Refund &amp; Cancellation Policy applies.</p>
        <p>24.5. Full details of cancellation, refunds, and data export are set out in our SaaS Refund &amp; Cancellation Policy.</p>

        <hr />

        <h2>25. Dispute Resolution</h2>
        <p>25.1. Before escalating to external authorities, you may email <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a> with a detailed description of your concern. Baby Bloom will respond within 10 business days.</p>
        <p>25.2. For disputes related to your use of the Platform or alleged breaches of these Terms, Baby Bloom offers internal dispute resolution. If the matter cannot be resolved internally, you may pursue the following:</p>
        <p><strong>For disputes under $10,000:</strong></p>
        <ul>
          <li>NSW Civil and Administrative Tribunal (NCAT): <a href="https://www.ncat.nsw.gov.au" target="_blank" rel="noopener noreferrer">www.ncat.nsw.gov.au</a> | Phone: 1300 006 228</li>
        </ul>
        <p><strong>For broader consumer or employment concerns:</strong></p>
        <ul>
          <li>NSW Fair Trading: <a href="https://www.fairtrading.nsw.gov.au" target="_blank" rel="noopener noreferrer">https://www.fairtrading.nsw.gov.au</a> | Phone: 13 32 20</li>
          <li>Fair Work Ombudsman: <a href="https://www.fairwork.gov.au" target="_blank" rel="noopener noreferrer">https://www.fairwork.gov.au</a> | Phone: 13 13 94 (for employment-related disputes)</li>
          <li>Australian Competition and Consumer Commission (ACCC): <a href="https://www.accc.gov.au" target="_blank" rel="noopener noreferrer">https://www.accc.gov.au</a></li>
        </ul>
        <p>25.3. Baby Bloom is not a mediator or arbitrator. Baby Bloom does not resolve disputes between you and a Childcare Professional regarding wages, hours, working conditions, or any other aspect of the care arrangement. These are employment/contractual matters between you and the Professional.</p>
        <p>25.4. If you have a concern about the Platform&apos;s operation or a Childcare Professional&apos;s conduct on the Platform itself, you may raise it through Baby Bloom&apos;s support channels at <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a>.</p>

        <hr />

        <h2>26. Communications &amp; Email Compliance</h2>
        <p>26.1. All emails sent by Baby Bloom comply with the Spam Act 2003 (Cth) and include clear sender identification, a functional unsubscribe mechanism, and Baby Bloom&apos;s contact details.</p>

        <hr />

        <h2>27. Consumer Data Right</h2>
        <p>27.1. Baby Bloom does not currently collect or process financial data that triggers obligations under the Consumer Data Right (CDR) framework. If Baby Bloom introduces financial data features in the future, CDR compliance will be assessed and implemented before those features are launched.</p>

        <hr />

        <h2>28. Governing Law &amp; Jurisdiction</h2>
        <p>28.1. These Terms are governed by and construed in accordance with the laws of New South Wales and the Commonwealth of Australia.</p>
        <p>28.2. You submit to the non-exclusive jurisdiction of the courts of New South Wales.</p>
        <p>28.3. The Platform is available to residents of New South Wales only. This is verified during the registration process.</p>

        <hr />

        <h2>29. Amendments</h2>
        <p>29.1. Baby Bloom may amend these Terms from time to time. We will notify you of any material changes by email and/or in-platform notification at least <strong>21 days</strong> before the changes take effect.</p>
        <p>29.2. <strong>Material Changes Affecting Employer Obligations</strong>: If we make a material change to your obligations as an employer (including PAYG withholding, superannuation contributions, or workers&apos; compensation requirements), you may terminate your account without penalty within 21 days of receiving notice and receive a pro-rata refund of any unused EdTech subscription fees. Continued use after the 21-day notice period constitutes your acceptance of the amended Terms. If you do not agree with the amendments, you may terminate your account.</p>
        <p>29.3. <strong>Non-Material Changes</strong>: For non-material changes (updates to contact information, clarifications, or corrections), we may make changes with shorter notice or implement immediately.</p>

        <hr />

        <h2>Contact Us</h2>
        <p><strong>Baby Bloom, Sydney</strong><br />
        ABN: 17 463 812 867<br />
        Address: 19 St Neot Avenue, Sydney NSW 2011<br />
        Website: <Link href="/legal">https://babybloomsydney.com.au/legal</Link></p>
        <p><strong>Contact Channels:</strong></p>
        <ul>
          <li><strong>General Inquiries:</strong> <a href="mailto:contact@babybloomsydney.com.au">contact@babybloomsydney.com.au</a></li>
          <li><strong>Support:</strong> <a href="mailto:support@babybloomsydney.com.au">support@babybloomsydney.com.au</a></li>
          <li><strong>Compliance &amp; Legal:</strong> <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a></li>
        </ul>

        <hr />

        <p><em>This document should be reviewed by a qualified legal professional before publication.</em></p>
      </div>
    </article>
  );
}
