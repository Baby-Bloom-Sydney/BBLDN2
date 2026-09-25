import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Biometric Data Collection Notice | Baby Bloom',
};

export default function BiometricNoticePage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const backHref = searchParams.from === '/nanny/verification' ? '/nanny/verification' : '/';
  const backLabel = searchParams.from === '/nanny/verification' ? 'Back to Verification' : 'Back to Baby Bloom';

  return (
    <article>
      <nav className="mb-6">
        <Link href={backHref} className="text-sm text-violet-600 hover:text-violet-700 hover:underline">
          &larr; {backLabel}
        </Link>
      </nav>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Baby Bloom &mdash; Biometric Data Collection Notice</h1>
        <p className="mt-2 text-sm text-slate-500">Version 1.0 | Last reviewed: 14 March 2026 | Next review: 14 March 2027 (or upon change of AI provider)</p>
      </header>
      <div className="prose prose-sm prose-slate max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:text-slate-600 prose-li:text-slate-600">

        <h2>How We Verify Your Identity</h2>
        <p>Before you can be connected with families on Baby Bloom, we need to verify that you are who you say you are. This notice explains how we use your biometric data during the verification process.</p>
        <p><strong>Please read this notice carefully before consenting.</strong></p>

        <hr />

        <h2>What Data We Collect</h2>
        <p>During the verification process, we collect:</p>
        <ul>
          <li><strong>Facial geometry:</strong> We extract measurements of your facial features from the selfie photograph you take during verification.</li>
          <li><strong>ID document data:</strong> We extract information from your uploaded passport or government-issued ID (name, photo, document number, expiry date).</li>
          <li><strong>WWCC card data:</strong> We extract information from your uploaded Working With Children Check card.</li>
        </ul>

        <hr />

        <h2>What We Compare</h2>
        <p>Your selfie photograph is compared against the photograph on your identity document using AI facial recognition technology. This confirms that the person creating the account is the same person shown on the ID document.</p>

        <hr />

        <h2>Overseas Processing and Your Risks</h2>
        <p><strong>OpenAI (United States):</strong> Your biometric data (facial geometry and identity document images) is transmitted to and processed by OpenAI&apos;s servers located in the United States (specifically, AWS US-East region).</p>
        <p><strong>Data Agreement:</strong> Baby Bloom has executed a Data Processing Agreement with OpenAI that requires:</p>
        <ul>
          <li>OpenAI to process your biometric data only as instructed by Baby Bloom.</li>
          <li>OpenAI to implement security measures to protect your data.</li>
          <li>OpenAI to not share your biometric data with third parties without Baby Bloom&apos;s consent.</li>
          <li>OpenAI to delete your data upon Baby Bloom&apos;s instruction.</li>
        </ul>
        <p><strong>OpenAI&apos;s Privacy Policy:</strong> OpenAI has its own privacy policy available at <a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer">https://openai.com/privacy</a>. You should read it to understand how OpenAI handles data.</p>
        <p><strong>US Government Access:</strong> Because your biometric data is processed in the United States:</p>
        <ul>
          <li>US law enforcement may access your data under court order or warrant.</li>
          <li>US intelligence agencies may access your data under FISA (Foreign Intelligence Surveillance Act) Section 702, which allows bulk surveillance of non-US persons&apos; international communications. Unlike Australian law, FISA does not require a warrant or showing of probable cause for foreign persons.</li>
          <li>Baby Bloom has <strong>no ability to prevent or disclose such access</strong> to you &mdash; US law prohibits companies from disclosing FISA requests.</li>
          <li>The US does not provide the same legal protections as Australian privacy law. Australian Privacy Principles do not apply to US government access.</li>
          <li><strong>You have limited recourse</strong> if your data is accessed by US authorities. You cannot sue the US government for damages, and you may never know if your data was accessed.</li>
        </ul>
        <p><strong>Your Choice:</strong> You must consent to overseas processing to use Baby Bloom. If you do not consent to your data being processed in the United States, you cannot create an account with Baby Bloom.</p>
        <p><strong>Data Retention at OpenAI:</strong> Your biometric data is retained by OpenAI for 7 days after Baby Bloom receives the verification result, then deleted from OpenAI&apos;s systems.</p>
        <p><strong>Potential Changes to AI Provider:</strong> If Baby Bloom changes the AI provider used for facial verification, Baby Bloom will:</p>
        <ol>
          <li>Notify all professionals via email of the change.</li>
          <li>Provide a new Biometric Data Collection Notice specific to the new provider.</li>
          <li>Require affirmative consent to the new provider before using their data.</li>
        </ol>
        <p>Until you affirmatively consent to the new provider, your account will be suspended (you will not be able to accept new matches). If you do not consent within 30 days, Baby Bloom may close your account and refund any unused EdTech subscription fees on a pro-rata basis.</p>

        <hr />

        <h2>How AI and Human Review Work Together</h2>
        <p><strong>AI Facial Matching:</strong> Baby Bloom uses OpenAI facial recognition (GPT-4o or similar) to compare your selfie against your ID photo. The AI produces a &ldquo;match score&rdquo; (0-100%, indicating confidence that the selfie matches the ID photo).</p>
        <p><strong>Flagging Threshold:</strong> Cases with a match score <strong>below 85%</strong> are flagged for human review. This threshold was chosen to ensure high confidence matches bypass manual review, while borderline cases receive human assessment.</p>
        <p><strong>Human Review:</strong> A Baby Bloom staff member reviews flagged cases manually. The human reviewer:</p>
        <ul>
          <li>Compares your selfie and ID photo themselves.</li>
          <li>Considers factors the AI may have missed (lighting, angle, facial hair, age, natural aging, makeup, etc.).</li>
          <li>Makes the final <strong>VERIFICATION DECISION</strong> (approved or rejected).</li>
          <li>Is not bound by the AI&apos;s match score; human judgment overrides AI.</li>
          <li>If a case is approved despite AI match score below 85%, the human reviewer documents their reasoning.</li>
        </ul>
        <p><strong>No Automatic Bias:</strong> Baby Bloom does not use AI match score alone to reject applicants. If your case shows a lower match score due to age, gender, ethnicity, or other factors, it will receive manual human review before rejection.</p>
        <p><strong>Audit Trail:</strong> Baby Bloom records:</p>
        <ul>
          <li>The date of your verification.</li>
          <li>The AI match score and flagging decision.</li>
          <li>Whether your case was manually reviewed.</li>
          <li>The human reviewer&apos;s name (or ID) and decision.</li>
          <li>The date and time of all decisions.</li>
          <li>Any notes or reasons for rejection or approval.</li>
        </ul>
        <p><strong>Access to Your Records:</strong> You can request a copy of your verification audit trail (including the AI match score, flagging decision, and human reviewer&apos;s notes) at any time by contacting <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a>. Baby Bloom will respond within 10 business days.</p>
        <p><strong>Appeal Process:</strong> If your verification is rejected, you can contact Baby Bloom within 14 days to request:</p>
        <ul>
          <li>A detailed explanation of why you were rejected, including the AI match score and reviewer notes.</li>
          <li>A manual review by a different staff member (senior to the original reviewer).</li>
          <li>A copy of your AI match score and any notes made by reviewers.</li>
          <li>Baby Bloom will provide a written response within 7 business days of receiving your appeal request.</li>
        </ul>
        <p><strong>System Performance:</strong> Baby Bloom&apos;s AI system achieves approximately 99.5% accuracy on facial matching. The system is reviewed regularly for bias and accuracy across different age groups, genders, and ethnicities. We publish a bias and accuracy report annually.</p>

        <hr />

        <h2>How Long We Keep Your Identity Verification Data</h2>
        <p><strong>Your Biometric Data (Facial Geometry):</strong></p>
        <ul>
          <li><strong>While your account is active:</strong> Retained permanently.</li>
          <li><strong>After account closure:</strong> Permanently deleted 90 days after closure.</li>
        </ul>
        <p><strong>Your Identity Documents (Passport, Driver&apos;s License, WWCC Card):</strong></p>
        <ul>
          <li><strong>While your account is active:</strong> Retained permanently.</li>
          <li><strong>After account closure:</strong> Permanently deleted 90 days after closure.</li>
        </ul>
        <p><strong>Your Verification Result (What Baby Bloom Keeps Permanently):</strong></p>
        <p>Baby Bloom retains the following information permanently, even after account closure, in de-identified form (meaning it is not linked to your name or personal account):</p>
        <ul>
          <li>Document type verified (e.g., &ldquo;Australian Passport&rdquo;)</li>
          <li>Document number (last 4 digits only, no full number)</li>
          <li>Verification outcome (approved/rejected, not name-linked)</li>
          <li>Verification date</li>
          <li>AI match score (but not linked to your identity)</li>
        </ul>
        <p><strong>Purpose of Permanent Retention:</strong> This information is retained for:</p>
        <ol>
          <li><strong>Fraud prevention:</strong> To identify patterns of document reuse across multiple accounts, without identifying the individuals.</li>
          <li><strong>Regulatory compliance:</strong> To maintain records in case of government childcare regulator inquiries about our verification procedures.</li>
          <li><strong>System improvement:</strong> To measure AI system accuracy and bias across different demographics.</li>
          <li><strong>Dispute resolution:</strong> To resolve disputes about whether a verification decision was made fairly (if needed, we can re-identify the record only with your explicit consent).</li>
        </ol>
        <p><strong>What &ldquo;De-identified&rdquo; Means:</strong> Your verification result is stored separately from your account and personal information. It cannot be used to identify you without additional information. However, if you request access to your results or appeal a verification decision, we can match the result back to your account for that purpose.</p>
        <p><strong>Deletion Request:</strong> You can request deletion of your verification result by contacting <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a>.</p>
        <ul>
          <li>If the result is still linked to your account, we will delete it upon request.</li>
          <li>If the result has been de-identified and separated from your account, deletion may not be possible, but we will explain why and offer alternatives (such as requesting we do not use it for any purpose).</li>
          <li>Deletion does not affect your ability to reapply for verification using new documents.</li>
        </ul>
        <p><strong>Relationship to Your Account:</strong> Your verification result is linked to your account. If your account is closed, the verification result remains linked to your account record, even though your biometric data and documents are deleted.</p>
        <p><strong>Sharing with Third Parties:</strong> Baby Bloom does not share verification results with third parties, except:</p>
        <ul>
          <li>Childcare regulators (if Baby Bloom is asked to verify your suitability).</li>
          <li>Law enforcement, upon warrant or subpoena.</li>
        </ul>

        <hr />

        <h2>Your Rights and Consequences of Withdrawing Biometric Consent</h2>
        <p><strong>You have the right to:</strong></p>
        <ul>
          <li><strong>Access:</strong> Request access to the biometric data we hold about you at any time.</li>
          <li><strong>Deletion:</strong> Request deletion of your biometric data. Please note that if your biometric data is deleted, you may need to complete the verification process again to continue using the Platform.</li>
          <li><strong>Withdraw consent:</strong> You may withdraw your consent for biometric data processing at any time.</li>
        </ul>
        <p><strong>However, withdrawing consent means:</strong></p>
        <ol>
          <li><strong>Your account will be immediately suspended.</strong> You will not be able to:
            <ul>
              <li>Create new matches with families.</li>
              <li>Accept babysitting jobs.</li>
              <li>Access the EdTech tools.</li>
              <li>View or communicate with existing clients.</li>
            </ul>
          </li>
          <li><strong>Active care arrangements are NOT affected.</strong> If you are already working for a family, withdrawal of biometric consent does not terminate your care arrangement with that family. Baby Bloom does not manage or control active care arrangements &mdash; those are separate contracts between you and the family.</li>
          <li><strong>Your account can be reactivated.</strong> If you withdraw consent and later change your mind, you can request reactivation. Baby Bloom will re-verify your identity and you must re-consent to biometric processing before your account is reactivated.</li>
          <li><strong>Data deletion upon withdrawal.</strong> If you withdraw consent, your biometric data is deleted immediately. Your verification results remain in de-identified form.</li>
          <li><strong>Timeline:</strong> Withdrawal takes effect immediately upon request. Any pending verification requests are cancelled.</li>
        </ol>
        <p><strong>To exercise any of these rights, contact:</strong></p>
        <ul>
          <li>Email: <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a></li>
          <li>Phone: Monday-Friday 9am-5pm AEST</li>
          <li>Post to Baby Bloom, Sydney NSW</li>
        </ul>
        <p><strong>Baby Bloom will respond within 30 days.</strong></p>

        <hr />

        <h2>What If Your Verification Is Rejected?</h2>
        <p>If Baby Bloom notifies you that your verification has been rejected, you have the right to:</p>
        <ol>
          <li><strong>Request a detailed explanation</strong> within 7 days. Baby Bloom will provide:
            <ul>
              <li>The reason for rejection (e.g., &ldquo;facial geometry did not match ID photo,&rdquo; &ldquo;document was not authentic,&rdquo; &ldquo;verification flagged as suspicious&rdquo;).</li>
              <li>The AI match score (if applicable).</li>
              <li>Notes made by any human reviewers.</li>
            </ul>
          </li>
          <li><strong>Request re-verification</strong> at any time:
            <ul>
              <li>You can submit a new selfie and/or new identity documents.</li>
              <li>Re-verification is free (no additional charge).</li>
              <li>Re-verification uses the same process as your original verification.</li>
              <li>Re-verification can be requested up to 3 times. After 3 rejections, contact Baby Bloom support to discuss further options.</li>
            </ul>
          </li>
          <li><strong>Request manual escalation</strong> if you believe the rejection was unfair:
            <ul>
              <li>Contact <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a> with the subject &ldquo;Verification Appeal.&rdquo;</li>
              <li>A senior Baby Bloom staff member (not the original reviewer) will review your case.</li>
              <li>This escalation should take no more than 7 business days.</li>
              <li>You can submit additional documents or evidence supporting your appeal.</li>
            </ul>
          </li>
          <li><strong>Lodge a complaint</strong> if you are not satisfied with the appeal outcome:
            <ul>
              <li>Contact the OAIC at <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">www.oaic.gov.au</a> (if you believe your privacy has been breached).</li>
              <li>Contact ACCC (if you believe you have been treated unfairly or misled).</li>
            </ul>
          </li>
        </ol>

        <hr />

        <h2>Security of Your Biometric Data</h2>
        <p><strong>In Transit:</strong> Your biometric data (selfie and ID photos) are encrypted using TLS 1.2+ when transmitted to OpenAI&apos;s servers.</p>
        <p><strong>At Rest:</strong> Your biometric data is encrypted in Baby Bloom&apos;s and OpenAI&apos;s databases using AES-256 encryption.</p>
        <p><strong>Access Controls:</strong> Only authorised Baby Bloom staff with a specific business need (e.g., fraud investigation, verification review) can access your biometric data. Access is logged and audited.</p>
        <p><strong>Incident Response:</strong> If Baby Bloom discovers a security breach involving biometric data, Baby Bloom will:</p>
        <ol>
          <li>Notify affected professionals within 30 days.</li>
          <li>Provide free credit monitoring or identity theft protection services.</li>
          <li>Cooperate with law enforcement and the OAIC.</li>
        </ol>

        <hr />

        <h2>Legal Basis for Biometric Verification</h2>
        <p>Baby Bloom requires biometric verification because NSW childcare regulations and the Working With Children Check scheme require identity verification for anyone providing childcare services to children they do not know.</p>
        <p>Biometric verification (facial recognition) is Baby Bloom&apos;s chosen method of ensuring that the person providing childcare is the same person who has been cleared by NSW authorities.</p>
        <p>This is not optional &mdash; if you do not consent to biometric verification, you cannot be connected with families through Baby Bloom for childcare services.</p>

        <hr />

        <h2>Liveness Detection and Spoofing Prevention</h2>
        <p>When you submit your selfie, Baby Bloom uses &ldquo;liveness detection&rdquo; to confirm that the selfie is of a real, live person (not a printed photo, video, or mask).</p>
        <p>Your selfie must be taken in real-time using your device&apos;s camera during the verification process. You cannot use a stored photo from your phone.</p>
        <p>Liveness detection checks for:</p>
        <ul>
          <li>Eye movement and blinking.</li>
          <li>Facial expressions.</li>
          <li>Head movement (you may be asked to turn your head or move your lips).</li>
        </ul>
        <p>If liveness detection fails (e.g., if you try to use a printed photo), the verification will be rejected and you will be asked to re-submit a new selfie.</p>

        <hr />

        <h2>What Is Facial Geometry?</h2>
        <p>&ldquo;Facial geometry&rdquo; is a mathematical representation of your face &mdash; specifically, the measurements and positions of key facial features such as:</p>
        <ul>
          <li>Distance between your eyes.</li>
          <li>Shape and size of your nose.</li>
          <li>Shape of your jawline.</li>
          <li>Distance from your chin to your forehead.</li>
        </ul>
        <p>Facial geometry is NOT a photograph. It is a set of numbers and measurements. This is important because:</p>
        <ul>
          <li>The AI cannot use facial geometry to create a new photo of your face.</li>
          <li>Facial geometry is smaller and faster to process than a full photograph.</li>
          <li>Facial geometry is more resistant to changes in lighting or angle.</li>
        </ul>

        <hr />

        <h2>Your Explicit Consent (Required to Use This Platform)</h2>
        <p><strong>IMPORTANT:</strong> Before you can use Baby Bloom&apos;s connection and matching features, you must explicitly consent to biometric data processing. This is <strong>mandatory</strong> &mdash; you cannot use the platform without this consent.</p>
        <p><strong>Please read and confirm your understanding of each statement below. You will need to check each checkbox in the UI before you can proceed.</strong></p>

        <h3>What Biometric Data Means:</h3>
        <p>I understand that &ldquo;biometric data&rdquo; includes:</p>
        <ul>
          <li>Facial geometry: mathematical measurements of my face (distance between eyes, nose shape, jawline, etc.)</li>
          <li>Liveness detection: a check that my selfie is of a real, live person (not a photo or video)</li>
          <li>These are extracted from a selfie photo that I take in real-time during verification</li>
        </ul>

        <h3>What Baby Bloom Does With Your Biometric Data:</h3>
        <p>I understand that Baby Bloom will:</p>
        <ul>
          <li>Compare my facial geometry against the photo on my identity document using artificial intelligence to verify that I am the same person</li>
          <li>Send my biometric data and identity documents to OpenAI (a US company) for processing</li>
          <li>Retain my biometric data until 90 days after I close my account, then permanently delete it</li>
          <li>Retain my verification result (pass/fail, date, AI match score, document type) permanently in de-identified form</li>
        </ul>

        <h3>Overseas Processing and Risks:</h3>
        <p>I understand that my biometric data will be processed by OpenAI, a company located in the United States. This means:</p>
        <ul>
          <li>My data will be transferred outside Australia and stored on US servers</li>
          <li>US law enforcement may access my data under court order or US national security laws</li>
          <li>The US does not provide the same legal protections as Australian privacy law</li>
          <li>I have limited recourse if my data is accessed by US authorities</li>
          <li>Baby Bloom has limited ability to prevent or disclose such access</li>
        </ul>

        <h3>How AI and Human Review Work:</h3>
        <p>I understand that:</p>
        <ul>
          <li>An AI system will produce a &ldquo;match score&rdquo; (0-100%) comparing my selfie to my ID photo</li>
          <li>Cases with a match score below 85% are flagged for manual review by a Baby Bloom staff member</li>
          <li>A human reviewer will make the final verification decision and is not bound by the AI&apos;s score</li>
          <li>If I am rejected, I can request a detailed explanation and manual review by a different staff member within 14 days</li>
          <li>Baby Bloom maintains records of the AI match score and human reviewer&apos;s decision</li>
        </ul>

        <h3>Data Retention and Your Rights:</h3>
        <p>I understand that:</p>
        <ul>
          <li>My facial biometric data will be deleted 90 days after I close my account</li>
          <li>The verification result will be retained permanently in de-identified form for fraud prevention and regulatory purposes</li>
          <li>I can request access to my biometric data and the AI match score at any time</li>
          <li>I can request deletion of my verification results (Baby Bloom may refuse if required by law)</li>
          <li>If I withdraw consent, I cannot use Baby Bloom&apos;s connection features, but my active care arrangements are not affected</li>
        </ul>

        <h3>No Cooling-Off Period for Biometric Processing:</h3>
        <p>I understand that:</p>
        <ul>
          <li>Biometric processing is mandatory to use Baby Bloom</li>
          <li>I cannot partially consent (e.g., I cannot consent to identity verification without consenting to AI processing)</li>
          <li>If I withdraw consent, I must re-consent and re-verify to use the platform again</li>
        </ul>

        <h3>Final Explicit Consent:</h3>
        <p>By checking the final consent box in the UI, I confirm that:</p>
        <p><strong>I have read and fully understand this entire Biometric Data Collection Notice. I voluntarily consent to Baby Bloom collecting my facial biometric data, facial geometry, and identity documents, and processing them via OpenAI for the sole purpose of verifying my identity. I understand that:</strong></p>
        <ul>
          <li><strong>This consent is mandatory for platform access.</strong></li>
          <li><strong>This consent is separate from my agreement to Baby Bloom&apos;s Terms of Service and Privacy Policy.</strong></li>
          <li><strong>I can withdraw this consent at any time by contacting <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a>, but withdrawal means I cannot use Baby Bloom&apos;s connection features.</strong></li>
          <li><strong>I have the right to access my biometric data and AI match score.</strong></li>
          <li><strong>OAIC contact details are provided at the end of this notice if I have privacy concerns.</strong></li>
        </ul>

        <hr />

        <h2>Complaints About Your Privacy Rights</h2>
        <p>If you believe Baby Bloom has breached your privacy rights under the Privacy Act 1988, you can lodge a complaint with:</p>
        <p><strong>Office of the Australian Information Commissioner (OAIC)</strong></p>
        <ul>
          <li>Website: <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">www.oaic.gov.au</a></li>
          <li>Phone: 1300 363 992</li>
        </ul>
        <p>The OAIC can investigate complaints about:</p>
        <ul>
          <li>Breaches of Australian Privacy Principles (APPs).</li>
          <li>Mishandling of sensitive information (biometric data).</li>
          <li>Denial of access to personal information.</li>
          <li>Failure to respond to privacy complaints.</li>
        </ul>

        <hr />

        <p><strong>Baby Bloom, Sydney</strong><br />
        ABN: 17 463 812 867<br />
        Compliance: <a href="mailto:compliance@babybloomsydney.com.au">compliance@babybloomsydney.com.au</a><br />
        Website: <a href="https://babybloomsydney.com.au" target="_blank" rel="noopener noreferrer">https://babybloomsydney.com.au</a></p>

        <hr />

        <p><em>This document should be reviewed by a qualified legal professional before publication.</em></p>
      </div>
    </article>
  );
}
