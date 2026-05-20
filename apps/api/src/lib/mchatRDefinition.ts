/**
 * Canonical M-CHAT-R bilingual screening definition (20 items).
 * Parent UI is driven from this JSON; PDF checkmarks use staff-mapped coordinates in pdf_template_fields.
 */

export type MchatQuestionDef = {
  field_id: string;
  index: number;
  label_en: string;
  label_es: string;
  display_options_en: [string, string];
  display_options_es: [string, string];
};

export const MCHAT_FORM_META = {
  formName: 'M-CHAT-R Bilingual',
  formType: 'pediatric_autism_screening',
  languages: ['english', 'spanish'] as const,
  template_key: 'mchat',
  form_id: 'mchat',
  title: 'M-CHAT-R Bilingual',
  version: '1.0.0',
  question_count: 20,
};

const EN = [
  'If you point at something across the room, does your child look at it? (FOR EXAMPLE, if you point at a toy or an animal, does your child look at the toy or animal?)',
  'Have you ever wondered if your child might be deaf?',
  'Does your child play pretend or make-believe? (FOR EXAMPLE, pretend to drink from an empty cup, pretend to talk on a phone, or pretend to feed a doll or stuffed animal?)',
  'Does your child like climbing on things? (FOR EXAMPLE, furniture, playground equipment, or stairs)',
  'Does your child make unusual finger movements near his or her eyes? (FOR EXAMPLE, does your child wiggle his or her fingers close to his or her eyes?)',
  'Does your child point with one finger to ask for something or to get help? (FOR EXAMPLE, pointing to a snack or toy that is out of reach)',
  'Does your child point with one finger to show you something interesting? (FOR EXAMPLE, pointing to an airplane in the sky or a big truck in the road)',
  'Is your child interested in other children? (FOR EXAMPLE, does your child watch other children, smile at them, or go to them?)',
  'Does your child show you things by bringing them to you or holding them up for you to see, not to get help, but just to share? (FOR EXAMPLE, showing you a flower, a stuffed animal, or a toy truck)',
  'Does your child respond when you call his or her name? (FOR EXAMPLE, does he or she look up, talk or babble, or stop what he or she is doing when you call his or her name?)',
  'When you smile at your child, does he or she smile back at you?',
  'Does your child get upset by everyday noises? (FOR EXAMPLE, does your child scream or cry to noise such as a vacuum cleaner or loud music?)',
  'Does your child walk?',
  'Does your child look you in the eye when you are talking to him or her, playing with him or her, or dressing him or her?',
  'Does your child try to copy what you do? (FOR EXAMPLE, wave bye-bye, clap, or make a funny noise when you do)',
  'If you turn your head to look at something, does your child look around to see what you are looking at?',
  'Does your child try to get you to watch him or her? (FOR EXAMPLE, does your child look at you for praise, or say “look” or “watch me”?)',
  'Does your child understand when you tell him or her to do something? (FOR EXAMPLE, if you don’t point, can your child understand “put the book on the chair” or “bring me the blanket”?)',
  'If something new happens, does your child look at your face to see how you feel about it? (FOR EXAMPLE, if he or she hears a strange or funny noise, or sees a new toy, will he or she look at your face?)',
  'Does your child like movement activities? (FOR EXAMPLE, being swung or bounced on your knee)',
] as const;

const ES = [
  '¿Si usted señala un objeto del otro lado del cuarto, su hijo/a lo mira? (POR EJEMPLO ¿Si usted señala un juguete o un animal, su hijo/a mira al juguete o al animal?)',
  '¿Alguna vez se ha preguntado si su hijo/a es sordo/a?',
  '¿Su hijo/a juega juegos de fantasía o imaginación? (POR EJEMPLO finge beber de una taza vacía, finge hablar por teléfono o finge darle de comer a una muñeca o un peluche)',
  '¿A su hijo/a le gusta treparse a las cosas? (POR EJEMPLO muebles, escaleras o juegos infantiles)',
  '¿Su hijo/a hace movimientos inusuales con los dedos cerca de sus ojos? (POR EJEMPLO ¿Mueve sus dedos cerca de sus ojos de manera inusual?)',
  '¿Su hijo/a apunta o señala con un dedo cuando quiere pedir algo o pedir ayuda? (POR EJEMPLO señala un juguete o algo para comer que está fuera de su alcance)',
  '¿Su hijo/a apunta o señala con un dedo cuando quiere mostrarle algo interesante? (POR EJEMPLO señala un avión en el cielo o un camión grande en el camino)',
  '¿Su hijo/a muestra interés en otros niños? (POR EJEMPLO ¿mira con atención a otros niños, les sonríe o se les acerca?)',
  '¿Su hijo/a le muestra cosas acercándoselas a usted o levantándolas para que usted las vea, no para pedir ayuda sino para compartirlas con usted? (POR EJEMPLO le muestra una flor, un peluche o un camión/carro de juguete)',
  '¿Su hijo/a responde cuando usted le llama por su nombre? (POR EJEMPLO ¿Cuando usted lo llama por su nombre: lo mira a usted, habla, balbucea, o deja de hacer lo que estaba haciendo?)',
  '¿Cuándo usted le sonríe a su hijo/a, él o ella le devuelve la sonrisa?',
  '¿A su hijo/a le molestan los ruidos cotidianos? (POR EJEMPLO ¿Llora o grita cuando escucha la aspiradora o música muy fuerte?)',
  '¿Su hijo/a camina?',
  '¿Su hijo/a le mira a los ojos cuando usted le habla, juega con él/ella o lo/la viste?',
  '¿Su hijo/a trata de imitar sus movimientos? (POR EJEMPLO decir adiós con la mano, aplaudir o algún ruido chistoso que usted haga)',
  '¿Si usted se voltea a ver algo, su hijo/a trata de ver que es lo que usted está mirando?',
  '¿Su hijo/a trata que usted lo mire? (POR EJEMPLO ¿Busca que usted lo/la halague, o dice “mirame”?)',
  '¿Su hijo/a le entiende cuando usted le dice que haga algo? (POR EJEMPLO ¿Su hijo/a entiende “pon el libro en la silla” o “tráeme la cobija” sin que usted haga señas?)',
  '¿Si algo nuevo ocurre, su hijo/a lo mira a la cara para ver cómo se siente usted al respecto? (POR EJEMPLO ¿Si oye un ruido extraño o ve un juguete nuevo, se voltearía a ver su cara?)',
  '¿A su hijo/a le gustan las actividades con movimiento? (POR EJEMPLO Le gusta que lo mezan/columpien, o que lo haga saltar en sus rodillas)',
] as const;

export const MCHAT_QUESTIONS: MchatQuestionDef[] = EN.map((label_en, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    field_id: `mchat_q${n}`,
    index: i + 1,
    label_en,
    label_es: ES[i]!,
    display_options_en: ['Yes', 'No'],
    display_options_es: ['Sí', 'No'],
  };
});

export function isMchatTemplateKey(templateKey: string): boolean {
  const k = templateKey.toLowerCase();
  return k === 'mchat' || k === 'm-chat' || k.includes('mchat');
}

export function mchatFieldIdForIndex(index: number): string {
  return `mchat_q${String(index).padStart(2, '0')}`;
}

/** Export shape matching the problem-statement JSON (for staff/docs). */
export function buildMchatProblemStatementJson() {
  const english: Record<string, unknown> = {};
  const spanish: Record<string, unknown> = {};
  for (const q of MCHAT_QUESTIONS) {
    const spec = {
      value: null,
      type: 'boolean',
      allowedValues: [true, false],
      displayOptions: q.display_options_en,
    };
    english[q.label_en] = spec;
    spanish[q.label_es] = { ...spec, displayOptions: q.display_options_es };
  }
  return {
    formName: MCHAT_FORM_META.formName,
    formType: MCHAT_FORM_META.formType,
    languages: [...MCHAT_FORM_META.languages],
    responses: { english, spanish },
  };
}
