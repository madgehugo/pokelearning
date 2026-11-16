/**
 * Convert Kaikki.org (English Wiktionary) German entries into dictionary rows.
 * Format: one JSON object per line, see https://kaikki.org/dictionary/rawdata.html
 */

export interface KaikkiEntry {
  word: string;
  pos: string;
  senses?: { glosses?: string[]; tags?: string[]; form_of?: { word: string }[]; alt_of?: { word: string }[] }[];
  forms?: { form: string; tags?: string[] }[];
  head_templates?: { args?: Record<string, string> }[];
}

export interface LexemeRow {
  lemma: string;
  pos: string;
  gender: string | null;
  plural: string | null;
  senses: { gloss: string; tags?: string[] }[];
  particle: string | null;
}

export interface FormRow {
  form: string;
  tags: string | null;
  /** Set when the form is the finite part of a split separable verb ("ruhe" … "aus"). */
  particle: string | null;
}

/** A form-of entry ("bin" → sein) to resolve once all lemmas are known. */
export interface PendingFormRow {
  form: string;
  lemma: string;
  pos: string;
  tags: string | null;
}

export interface ConvertedEntry {
  lexeme: LexemeRow | null;
  forms: FormRow[];
  pending: PendingFormRow[];
}

const SKIPPED_POS = new Set(["character", "symbol", "punct", "suffix", "prefix", "infix", "interfix", "affix", "romanization"]);

/** Tags on `forms` that describe the table rather than a word form. */
const META_FORM_TAGS = new Set([
  "table-tags", "inflection-template", "class", "auxiliary", "romanization", "error-unknown-tag",
  "canonical", // headword display form, e.g. "die CIA"; the lemma itself is added separately
]);

/** Grammatical tags dropped from form descriptions (already implied or noise). */
const NOISE_FORM_TAGS = new Set(["form-of", "strong", "weak", "mixed", "multiword-construction"]);

/** Usage labels worth showing next to a meaning. */
const SENSE_LABELS = new Set([
  "colloquial", "informal", "formal", "archaic", "obsolete", "dated", "rare", "figurative",
  "regional", "dialectal", "slang", "vulgar", "literary", "humorous", "pejorative",
  "transitive", "intransitive", "reflexive", "Austria", "Switzerland", "Southern-Germany",
]);

const GENDER_TAGS: Record<string, string> = { masculine: "m", feminine: "f", neuter: "n" };

const MAX_SENSES = 8;

type KaikkiSense = NonNullable<KaikkiEntry["senses"]>[number];

/**
 * Inflections ("dative plural of Haus") and variants ("obsolete form of Haus").
 * Contractions ("im: contraction of in + dem") are tagged alt-of too, but their
 * gloss is the meaning learners need, so they stay real senses.
 */
const isFormOfSense = (s: KaikkiSense) =>
  !(s.tags ?? []).includes("contraction") &&
  ((s.form_of?.length ?? 0) > 0 || (s.alt_of?.length ?? 0) > 0 ||
    (s.tags ?? []).includes("form-of") || (s.tags ?? []).includes("alt-of"));

/** Auxiliary-verb senses ("forms the perfect aspect") go after the real meaning ("to have"). */
const isAuxiliarySense = (s: KaikkiSense) => /^(forms|used to form|used as an auxiliary|auxiliary)\b/i.test(s.glosses?.at(-1) ?? "");

function describeTags(tags: string[] | undefined): string | null {
  const all = tags ?? [];
  const kept = all
    .filter((t) => !NOISE_FORM_TAGS.has(t) && !t.startsWith("error-"))
    // "subjunctive subjunctive-ii" → "subjunctive-ii"
    .filter((t) => !all.some((o) => o !== t && o.startsWith(`${t}-`)))
    .map((t) => (t === "alt-of" ? "alternative form" : t));
  return kept.length ? kept.join(" ") : null;
}

function genderOf(entry: KaikkiEntry): string | null {
  if (entry.pos !== "noun" && entry.pos !== "name") return null;
  const found = new Set<string>();
  let pluralOnly = false;
  for (const s of entry.senses ?? []) {
    for (const t of s.tags ?? []) {
      const g = GENDER_TAGS[t];
      if (g) found.add(g);
      if (t === "plural-only" || t === "plural") pluralOnly = true;
    }
  }
  if (found.size === 0) {
    // de-noun head template: first argument starts with the gender, e.g. "n,,^er" or "m,(e)s,^e"
    const arg = entry.head_templates?.[0]?.args?.["1"] ?? "";
    for (const g of arg.split(",")[0]!.split(/[./]/)) {
      if (g === "m" || g === "f" || g === "n") found.add(g);
      if (g === "p") pluralOnly = true;
    }
  }
  if (found.size === 0) return pluralOnly ? "pl" : null;
  return ["m", "f", "n"].filter((g) => found.has(g)).join(",");
}

/** Separable prefix from the verb head template, e.g. "aus.ruhen" → "aus". */
function particleOf(entry: KaikkiEntry): string | null {
  if (entry.pos !== "verb") return null;
  const arg = entry.head_templates?.[0]?.args?.["1"] ?? "";
  const m = arg.split("<")[0]!.match(/^([a-zäöü]+)\.[a-zäöüß]/);
  return m ? m[1]! : null;
}

export function convertEntry(entry: KaikkiEntry): ConvertedEntry {
  const empty: ConvertedEntry = { lexeme: null, forms: [], pending: [] };
  if (!entry.word || SKIPPED_POS.has(entry.pos)) return empty;

  const senses = entry.senses ?? [];
  const pending: PendingFormRow[] = [];
  for (const s of senses) {
    if (!isFormOfSense(s)) continue;
    for (const target of [...(s.form_of ?? []), ...(s.alt_of ?? [])]) {
      if (target.word && target.word !== entry.word) {
        pending.push({ form: entry.word, lemma: target.word, pos: entry.pos, tags: describeTags(s.tags) });
      }
    }
  }

  const realSenses = senses
    .filter((s) => !isFormOfSense(s) && s.glosses?.length)
    .sort((a, b) => Number(isAuxiliarySense(a)) - Number(isAuxiliarySense(b)))
    .slice(0, MAX_SENSES)
    .map((s) => {
      const labels = (s.tags ?? []).filter((t) => SENSE_LABELS.has(t));
      return labels.length ? { gloss: s.glosses!.at(-1)!, tags: labels } : { gloss: s.glosses!.at(-1)! };
    });
  if (realSenses.length === 0) return { ...empty, pending };

  const particle = particleOf(entry);
  const formsByText = new Map<string, FormRow>();
  const addForm = (form: string, tags: string | null, formParticle: string | null) => {
    const key = `${form}\u0000${formParticle ?? ""}`;
    const existing = formsByText.get(key);
    if (!existing) formsByText.set(key, { form, tags, particle: formParticle });
    else if (tags && existing.tags && !existing.tags.split("; ").includes(tags)) existing.tags += `; ${tags}`;
  };

  addForm(entry.word, null, null);
  let plural: string | null = null;
  for (const f of entry.forms ?? []) {
    const tags = f.tags ?? [];
    if (!f.form || f.form === "-" || tags.some((t) => META_FORM_TAGS.has(t))) continue;
    if (/[()[\]]/.test(f.form)) continue;
    if (!plural && entry.pos === "noun" && tags.includes("plural") && !tags.some((t) => /dative|genitive|accusative|diminutive/.test(t))) {
      plural = f.form;
    }
    const words = f.form.split(" ");
    if (words.length === 1) {
      addForm(f.form, describeTags(tags), null);
    } else if (particle && words.length >= 2 && words.at(-1) === particle && !words[0]!.includes("-")) {
      // "ruhe aus", "ruhe mich aus": the finite verb, with the particle at the clause end
      addForm(words[0]!, describeTags(tags), particle);
    }
  }

  return {
    lexeme: {
      lemma: entry.word,
      pos: entry.pos,
      gender: genderOf(entry),
      plural,
      senses: realSenses,
      particle,
    },
    forms: [...formsByText.values()],
    pending,
  };
}
