'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { openai } from '@/lib/ai/client';
import { V2_SYSTEM_PROMPT, buildV2Prompt, parseAIProfileSections, generateV2Checklist } from '@/lib/ai/nanny-profile-prompts';
import { cleanHtml, cleanHtmlDeep } from '@/lib/safe-html';

interface GenerateAIContentResult {
  success: boolean;
  bio?: string;
  aiContent?: Record<string, unknown>;
  error?: string;
}

// ── Main function ──

export async function generateOnboardingAIContent(leadId: string): Promise<GenerateAIContentResult> {
  const adminClient = createAdminClient();

  try {
    // Fetch lead data
    const { data: lead, error } = await adminClient
      .from('nanny_leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      return { success: false, error: 'Lead not found' };
    }

    const identity = lead.identity || {};
    const experience = lead.experience || {};
    const qualifications = lead.qualifications || {};
    const residency = lead.residency || {};
    const preferences = lead.preferences || {};
    const matching = lead.matching || {};
    // Build the structured prompt with all V2 data
    const userMessage = buildV2Prompt({
      firstName: lead.first_name,
      lastName: lead.last_name,
      suburb: residency.suburb,
      dateOfBirth: experience.date_of_birth,
      nationality: residency.nationality,
      motivation: identity.motivation,
      personalityTraits: identity.personality_traits || [],
      levelOfSupport: identity.level_of_support || [],
      professionalValues: identity.professional_values || [],
      totalExperience: experience.total_experience,
      under3Experience: experience.under_3_experience,
      newbornExperience: experience.newborn_experience,
      childcareRoles: experience.childcare_roles || [],
      highestQualification: qualifications.has_qualifications ? qualifications.highest_qualification : null,
      certificates: qualifications.has_certificates ? (qualifications.certificates || []) : [],
      roleTypes: preferences.role_types || [],
      minAge: preferences.min_age,
      maxAge: preferences.max_age,
      additionalNeeds: preferences.additional_needs,
      languages: matching.languages || [],
      driversLicense: matching.drivers_license,
      hasCar: matching.has_car,
      vaccinationStatus: matching.vaccination_status,
      comfortableWithPets: preferences.comfortable_with_pets,
      nonSmoker: matching.non_smoker,
    });

    // Call o4-mini for full 8-section generation
    const completion = await openai.chat.completions.create({
      model: 'o4-mini',
      messages: [
        { role: 'developer', content: V2_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: 10000,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return { success: false, error: 'No content generated' };
    }

    // Parse the 8 sections
    const sections = parseAIProfileSections(raw);

    // Generate programmatic checklist from V2 data
    const checklist = generateV2Checklist({
      personalityTraits: identity.personality_traits || [],
      childcareRoles: experience.childcare_roles || [],
      totalExperience: experience.total_experience,
      under3Experience: experience.under_3_experience,
      newbornExperience: experience.newborn_experience,
      highestQualification: qualifications.has_qualifications ? qualifications.highest_qualification : null,
      certificates: qualifications.has_certificates ? (qualifications.certificates || []) : [],
      roleTypes: preferences.role_types || [],
      levelOfSupport: identity.level_of_support || [],
      minAge: preferences.min_age,
      maxAge: preferences.max_age,
      driversLicense: matching.drivers_license,
      hasCar: matching.has_car,
      comfortableWithPets: preferences.comfortable_with_pets,
      vaccinationStatus: matching.vaccination_status,
      nonSmoker: matching.non_smoker,
    });

    // Build ai_content JSONB (other tags, blocks and comments removed)
    const aiContent: Record<string, unknown> = cleanHtmlDeep({
      headline: sections.headline || '',
      parent_pitch: sections.bio || '',
      bio_summary: {
        about: sections.about || '',
        personality: sections.personality || '',
        values: sections.values || '',
        background: sections.background || '',
        what_i_offer: sections.what_i_offer || '',
      },
      experience_summary: sections.experience || '',
      skills_highlight: checklist,
      ai_model: 'o4-mini',
      generated_at: new Date().toISOString(),
    });

    const aiBio = cleanHtml(sections.bio || '');

    // Save to nanny_leads
    await adminClient
      .from('nanny_leads')
      .update({
        ai_bio: aiBio,
        ai_content: aiContent,
        lead_status: 'ai_generated',
        funnel_step: 'N4',
        last_active_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    return { success: true, bio: aiBio, aiContent };
  } catch (err: unknown) {
    const e = err as Error & { status?: number; code?: string };
    console.error('[AI-gen] Error for lead', leadId, ':', e.message, 'status:', e.status, 'code:', e.code);
    return { success: false, error: `AI generation failed: ${e.message}` };
  }
}


