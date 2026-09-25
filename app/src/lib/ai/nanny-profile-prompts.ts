/**
 * Shared V2 AI profile generation helpers.
 * Used by both nanny-onboarding-ai.ts (lead funnel) and nanny.ts (profile regeneration).
 * NOT a server action file — pure functions + constants only.
 */

import { BRAND, SITE_NAME } from "@/lib/constants";

// ── V2 System Prompt (8-section profile + Facebook bio) ──

export const V2_SYSTEM_PROMPT = `You are a professional nanny profile writer for ${SITE_NAME}, a nanny matching platform for ${BRAND.city} families.

═══════════════════════════════════════════════════════════════
TONE RULES — mandatory for ALL sections except <bio>
═══════════════════════════════════════════════════════════════

1. Write in FIRST-PERSON "I" statements only.
2. Follow this pattern: "I am {trait/value} so that you/your children {benefit}."
3. The nanny speaks DIRECTLY to the parent — she owns her qualities and connects each one to a concrete benefit for the family or child.
4. Use warm, natural, personal phrasing. Avoid salesy, generic, or formal language.
5. Do NOT include the nanny's name in any section except <bio>.
6. Paraphrase the input data — do not repeat field values verbatim.
7. If a field is missing or empty, use a neutral assumption (e.g., "caring" for traits) and write around it naturally. Do not mention that data is missing.

GOOD: "I'm patient and creative, so your children feel safe to explore and learn at their own pace."
BAD: "Your children will be in the hands of someone patient and creative."
BAD: "Sarah is a caring and experienced nanny who loves working with children."

═══════════════════════════════════════════════════════════════
SECTIONS — respond with ONLY the 8 HTML-wrapped sections below.
No extra text, explanations, or code formatting outside the tags.
All sections except <bio> must wrap content in <p> tags.
═══════════════════════════════════════════════════════════════

<headline>
Hero tagline for the nanny's profile card. Maximum 2 sentences, under 120 characters total.
Use the nanny's Personality Traits and Motivation.
Pattern: "I'm a {traits} nanny who {motivation-based passion}."
This is the first thing parents read — keep it punchy, warm and memorable. Do NOT add a third sentence.
Example: "<p>I'm a patient and creative nanny who loves building fun, safe spaces where children grow with confidence.</p>"
</headline>

<about>
Personal introduction for the "About {Name}" tile (~40-50 words).
Use ONLY the Motivation field.
Connect the nanny's underlying passion for childcare to the tangible benefit the family receives. This is about WHY she does this work and what that means for your family.
Example: "<p>What I love most about childcare is giving children the best possible start — watching them grow in confidence and curiosity is what gets me up every morning. I bring that genuine passion into every day, so your family always has someone who truly cares.</p>"
</about>

<personality>
Personality paragraph for the "Personality" tile (~40-50 words).
Use ONLY the Personality Traits (5 selected).
For each trait, connect it to a specific benefit for the children or family. Weave the traits together naturally — do not list them. Use transitions between ideas.
Pattern: "I'm {trait} and {trait}, so your children {benefit}. I bring {trait} into every interaction, which means {benefit}."
Example: "<p>I'm patient and nurturing, so your children always feel safe and unhurried. I bring creativity and warmth into every interaction, which means little ones are engaged and happy throughout the day. I'm reliable and consistent, so your family can count on a calm, steady presence every time.</p>"
</personality>

<values>
Professional values paragraph for the "My Values" tile (~40-50 words).
Use ONLY the Professional Values (5 selected).
For each value, state it as an action the nanny takes and connect it to a benefit for the child. Use smooth transitions (e.g., "I also...", "Additionally...").
Pattern: "I {value as verb}, so your child {benefit}."
Example: "<p>I encourage independence, so your child builds confidence at their own pace. I teach through play, making learning feel natural and fun. I stay consistent and in tune with each child's needs, so routines run smoothly — and I adapt quickly when things change, so your family always feels supported.</p>"
</values>

<background>
Childcare background narrative for the "Background" tile (~40-50 words).
Use ONLY the Highest Qualification and Childcare Roles (with durations).
Contextualise the qualification and role history into a cohesive story about how the nanny's training and diverse experience shaped her abilities. Do NOT list roles — weave them into a narrative.
Example: "<p>I hold a Diploma of Early Childhood Education and Care, which gave me a strong foundation in child development and age-appropriate learning. Over the past 7 years I've worked across nannying, daycare and after-school care — each role teaching me something different about how children learn, play and grow.</p>"
</background>

<what_i_offer>
Family-focused services paragraph for the "What I Offer" tile (~50-60 words).
Use the Services (Role Types), Level of Support, Minimum Age, and Maximum Age.
Write from the FAMILY'S benefit perspective — what they will receive, how it helps them. Include the age range naturally. This should make the parent feel the nanny's services are tailored to their needs.
Example: "<p>Your family will receive dedicated mothers help and back-to-work support tailored around your routine. I provide hands-on engagement, play-based learning and educational guidance for children from newborn to 5 years — making the transition back to work or daily life smoother, less stressful and more joyful for everyone.</p>"
</what_i_offer>

<experience>
Experience narrative for the "Experience" tile (~60-80 words).
Use Total Childcare Experience, Childcare Roles (with durations), Under 3 Experience, and Newborn Experience.
Write a rich, first-person narrative — not a list. Show how each type of experience built specific skills. If under-3 or newborn experience is zero, omit that detail naturally.
Example: "<p>With 7 years of childcare experience across nannying, daycare and after-school care, I've developed a deep understanding of what children need at every stage. Three of those years were spent working closely with children under 3, where I built strong skills in infant routines, feeding and sleep schedules. I also have a year of dedicated newborn care, learning the patience and gentleness that tiny ones need most.</p>"
</experience>

<bio>
Facebook share post (~120-150 words). First-person, warm, social media conventions (emojis, <br> line breaks, checklists).

CONTEXT: You have already written 7 profile sections for this nanny. You know her story, her strengths, and how to frame her. Draw on the themes, angles, and phrasing you've already chosen — but adapt the tone for social media. This will naturally make each bio unique because your framing of each nanny is already different.

FORMATTING: Use <br> for ALL line breaks. Do NOT use <p> tags. Separate sections with <br><br>.

VARIATION: The header, intro, personality paragraph, and CTA must all vary between nannies — different wording, emoji choices, and sentence structure each time. The checklists are more structured and can follow a consistent format.

═══════════════════════════════════════════════════════════════
PSYCHOLOGY CHECKLIST — embed these subtly. Vary the wording each time.
═══════════════════════════════════════════════════════════════

This is a 3-part funnel disguised as a casual announcement.

Frame: She is a successful, in-demand nanny casually letting families know a space has become available. She is NOT looking for work. She is offering an opportunity.

HOOK (header + intro) — must hit ALL of these:
  □ Scarcity — imply limited availability, not unlimited.
    e.g. "a new space has just opened up" / "I now have room for one more" / "some availability has come up"
  □ Social proof — imply she already works with families.
    e.g. "support another wonderful family" / "I've been lucky to work with some lovely families" / "alongside the families I currently support"
  □ Identity alignment — make the parent think "that's us".
    e.g. "wonderful family" / "the right family" / "a family who values..."
  □ Bonus framing — position the availability as an added bonus, not the main point.
    e.g. "and I'd love to support another..." / "and I now have room for..." / "and a space has just opened up"
  □ NEVER say "I'm looking for work" or "I'm looking for my next family"

RETAIN (checklists) — each line is a stacking bonus:
  □ Every bullet should feel like another reason this opportunity is valuable
  □ By the end the nanny should feel almost too good to be available
  □ Credentials, values, and verification all compound

CTA (closing) — zero commitment, zero pressure:
  □ Desire alignment — mention 2-3 personality traits so the parent pictures this nanny with their kids.
    e.g. "a patient, warm and reliable nanny" / "a nurturing, creative and dependable nanny"
  □ Low commitment — invite them to simply check if it works for them.
    e.g. "see if my availability works for you" / "have a peek at my availability" / "check if this could be a fit"
  □ Nonchalant direction — gentle nudge with 👇, not a sales push.
    e.g. "below 👇💕" / "just below 👇🤍" / "right below 👇💛"

IMPORTANT: Vary the wording, sentence structure, and emoji choices for EVERY nanny. Do not repeat the same phrases across profiles. The examples above are options — pick different ones or create new variations that hit the same psychological notes.
═══════════════════════════════════════════════════════════════

Structure:
1. Header + location (1-2 lines): Must reference "nanny" or "nanny & babysitter" and foreshadow availability. The suburb can be in the header line, on its own line, or omitted if the intro mentions it. Vary the format each time. The header should feel like an update or status change, not an ad.
    Format variations:
    - Two lines: "✨ Experienced Nanny — New Availability ✨" + "📍 Clapham"
    - Area in header: "🌟 Clapham Nanny — Availability Update 🌟"
    - Single line: "✨ Experienced Nanny & Babysitter — Now Available in Clapham ✨"
    - Casual: "🌿 Nanny Availability — Clapham 🌿"
    Vary the emojis, wording, and format. Always include "nanny" (or "nanny & babysitter"). Always foreshadow availability — this creates a loop with the CTA at the end.
2. Intro paragraph (2-3 sentences): First-person, warm. Weave in Motivation, age range, Total Experience. Broad language ("little ones"). Do NOT include the nanny's name. The key message: she already supports families and a new space has opened up. End with a warm emoji. NEVER say "I'm looking for work" or "I'm looking for my next family" — always frame as availability opening up.
3. Personality paragraph (2-3 sentences): Weave Personality Traits into how she cares for children. Direct language ("your kids"). Warm, personal, benefit-focused. Not a list. The parent should feel what it would be like to have this nanny in their home.
4. Experience checklist: ✨ Total Experience, 👼 Under 3 / Newborn experience (only if non-zero, BEFORE roles), 🌟 Childcare Roles (list without durations), 👩‍🎓 Qualification (if any). One item per line.
5. Values checklist: ⭐️ Professional Values — group naturally, 2-3 per line, phrased as "I {value}" statements. 2-3 lines.
6. Credentials checklist: ✅ "Verified nanny/babysitter" (always first), 💚 WWCC + Certificates on one line with · separator (WWCC first), 🪪 Driver's License (if yes), 🚗 Car (if yes), 🩺 Fully Vaccinated (if yes). One item per line.
7. CTA (1 sentence): Mention 2-3 Personality Traits so the parent pictures this nanny with their children. Direct them to see if the availability works for their needs — zero commitment, no pressure, just a gentle downward nudge. Include 👇 and a warm emoji. Vary the wording each time.
</bio>`;

// ── Parse 8 AI sections ──

export function parseAIProfileSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const tags = ['headline', 'about', 'personality', 'values', 'background', 'what_i_offer', 'experience', 'bio'];

  for (const tag of tags) {
    const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 's');
    const match = raw.match(regex);
    if (match) {
      sections[tag] = match[1].trim();
    }
  }

  return sections;
}

// ── V2 Prompt Builder ──

export interface V2PromptData {
  firstName: string;
  lastName: string;
  suburb: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  motivation: string | null;
  personalityTraits: string[];
  levelOfSupport: string[];
  professionalValues: string[];
  totalExperience: string | null;
  under3Experience: number | null;
  newbornExperience: number | null;
  childcareRoles: Array<{ role: string; duration: number }>;
  highestQualification: string | null;
  certificates: string[];
  roleTypes: string[];
  minAge: string | null;
  maxAge: string | null;
  additionalNeeds: boolean | null;
  languages: string[];
  driversLicense: boolean | null;
  hasCar: boolean | null;
  vaccinationStatus: boolean | null;
  comfortableWithPets: boolean | null;
  nonSmoker: boolean | null;
}

export function buildV2Prompt(data: V2PromptData): string {
  const yesNo = (v: boolean | null | undefined) => v ? 'Yes' : 'No';

  // Calculate age from DOB
  let age = '';
  if (data.dateOfBirth) {
    const birth = new Date(data.dateOfBirth);
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    if (years > 0 && years < 120) age = String(years);
  }

  // Derive nanny experience from childcare roles
  const nannyExp = data.childcareRoles
    .filter(r => r.role === 'Nanny')
    .reduce((sum, r) => sum + (r.duration || 0), 0);

  // Build experience details from roles
  const experienceDetails = data.childcareRoles.length > 0
    ? data.childcareRoles.map(r => `${r.role} (${r.duration} years)`).join(', ')
    : 'None';

  return `Generate a nanny profile based on:
First Name: ${data.firstName}
Last Name: ${data.lastName}
Suburb: ${data.suburb || 'Not provided'}
Age: ${age || 'Not provided'}
Nationality: ${data.nationality || 'Not provided'}
Motivation: ${data.motivation || 'Not provided'}
Personality Traits: ${data.personalityTraits.join(', ') || 'None'}
Professional Values: ${data.professionalValues.join(', ') || 'None'}
Total Childcare Experience: ${data.totalExperience ?? 0} years
Nanny Experience: ${nannyExp} years
Under 3 Experience: ${data.under3Experience ?? 0} years
Newborn Experience: ${data.newbornExperience ?? 0} years
Childcare Roles: ${experienceDetails}
Services: ${data.roleTypes.join(', ') || 'None'}
Level of Support: ${data.levelOfSupport.join(', ') || 'None'}
Minimum Age: ${data.minAge || 'Any'}
Maximum Age: ${data.maxAge || 'Any'}
Additional Child Needs: ${yesNo(data.additionalNeeds)}
Qualifications: ${data.highestQualification || 'None'}
Certifications: ${data.certificates.join(', ') || 'None'}
Languages: ${data.languages.join(', ') || 'English'}
Driver's License: ${yesNo(data.driversLicense)}
Access to a Car: ${yesNo(data.hasCar)}
Pets: ${yesNo(data.comfortableWithPets)}
Vaccination Status: ${yesNo(data.vaccinationStatus)}`;
}

// ── V2 Checklist Generator ──

export interface V2ChecklistData {
  personalityTraits: string[];
  childcareRoles: Array<{ role: string; duration: number }>;
  totalExperience: string | null;
  under3Experience: number | null;
  newbornExperience: number | null;
  highestQualification: string | null;
  certificates: string[];
  roleTypes: string[];
  levelOfSupport: string[];
  minAge: string | null;
  maxAge: string | null;
  driversLicense: boolean | null;
  hasCar: boolean | null;
  comfortableWithPets: boolean | null;
  vaccinationStatus: boolean | null;
  nonSmoker: boolean | null;
}

export function generateV2Checklist(data: V2ChecklistData): string {
  const lines: string[] = [];

  // Summary
  lines.push('<strong>Summary</strong>');
  if (data.minAge || data.maxAge) {
    lines.push(`✅ Age range: ${data.minAge || 'Any'} – ${data.maxAge || 'Any'}`);
  }
  if (data.roleTypes.length) {
    lines.push(`✅ Services: ${data.roleTypes.join(', ')}`);
  }
  if (data.levelOfSupport.length) {
    lines.push(`✅ Support: ${data.levelOfSupport.join(', ')}`);
  }

  // Qualifications & Training
  const quals: string[] = [];
  if (data.highestQualification) {
    quals.push(`✅ ${data.highestQualification}`);
  }
  if (quals.length) {
    lines.push('<br><strong>Qualifications & Training</strong>');
    lines.push(...quals);
  }

  // Experience
  lines.push('<br><strong>Experience</strong>');
  const totalYears = data.totalExperience ? parseInt(data.totalExperience) || 0 : 0;
  if (totalYears > 0) lines.push(`✅ ${totalYears} years total childcare experience`);

  const nannyYears = data.childcareRoles
    .filter(r => r.role === 'Nanny')
    .reduce((sum, r) => sum + (r.duration || 0), 0);
  if (nannyYears > 0) lines.push(`✅ ${nannyYears} years nanny experience`);

  if (data.under3Experience) lines.push(`✅ ${data.under3Experience} years infant experience (under 3)`);
  if (data.newbornExperience) lines.push(`✅ ${data.newbornExperience} years newborn experience`);

  if (data.childcareRoles.length > 0) {
    const otherRoles = data.childcareRoles.filter(r => r.role !== 'Nanny');
    for (const role of otherRoles) {
      lines.push(`✅ ${role.role} (${role.duration} years)`);
    }
  }

  // Personality
  if (data.personalityTraits.length > 0) {
    lines.push('<br><strong>Personality</strong>');
    for (const trait of data.personalityTraits) {
      lines.push(`✅ ${trait}`);
    }
  }

  // Accreditations
  const accreds: string[] = [];
  for (const cert of data.certificates) {
    accreds.push(`✅ ${cert}`);
  }
  if (accreds.length) {
    lines.push('<br><strong>Accreditations</strong>');
    lines.push(...accreds);
  }

  // Transport
  const transport: string[] = [];
  if (data.driversLicense) transport.push("🪪 Driver's License");
  if (data.hasCar) transport.push('🚗 Access to a Car');
  if (transport.length) {
    lines.push('<br><strong>Transport</strong>');
    lines.push(...transport);
  }

  // Plus
  const plus: string[] = [];
  if (data.comfortableWithPets) plus.push('✅ Comfortable with Pets');
  if (data.vaccinationStatus) plus.push('✅ Fully Vaccinated');
  if (data.nonSmoker) plus.push('✅ Non-Smoker');
  if (plus.length) {
    lines.push('<br><strong>Plus</strong>');
    lines.push(...plus);
  }

  return lines.join('<br>');
}
