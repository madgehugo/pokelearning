import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LineMessage } from "@pokelearning/shared";
import { AppDb } from "./db/app-db.ts";
import { createGlossary } from "./language/glossary.ts";
import { LinePipeline } from "./pipeline.ts";
import { prepareForTranslation, prepareSentences, restoreSlots, splitSentences } from "./translate/prepare.ts";
import type { TranslationProvider } from "./translate/provider.ts";
import { isDegenerate, Translator } from "./translate/translator.ts";

const glossary = createGlossary([
  { match: ["Birk"], lemma: "Birk", pos: "name", glosses: ["Professor Birch"], mt: "Birch" },
]);

class FakeProvider implements TranslationProvider {
  readonly id = "fake";
  calls: string[] = [];
  supports(from: string, to: string) {
    return from === "de" && to === "en";
  }
  fail = false;
  async warmUp() {}
  async translate(text: string) {
    if (this.fail) throw new Error("model exploded");
    this.calls.push(text);
    return `EN(${text})`;
  }
}

const line = (text: string): LineMessage => ({
  type: "line", adapter: "test", game: "pokemon-emerald-de", lang: "de", line: text, timestamp: 0, meta: { source: "field" },
});

function setup() {
  const db = new AppDb(":memory:");
  const provider = new FakeProvider();
  const pipeline = new LinePipeline(db, { dictionary: null, glossary }, new Translator(provider, db, glossary), "en");
  return { db, provider, pipeline };
}

describe("prepareForTranslation", () => {
  it("normalises capitals, keeps acronyms, protects glossary names", () => {
    assert.equal(
      prepareForTranslation("Ich bin PROF. BIRK. Dein POKéMON hat keine KP!", glossary),
      "Ich bin Prof. X1. Dein Pokémon hat keine KP!",
    );
  });

  it("keeps stat abbreviations whole, full stops included", () => {
    assert.equal(prepareForTranslation("VERT.", glossary), "X1");
    assert.equal(prepareForTranslation("SP. ANG.", glossary), "X1");
    assert.equal(prepareForTranslation("SP. VER.", glossary), "X1");
    assert.equal(prepareForTranslation("INIT. von BIRK sinkt.", glossary), "X1 von X2 sinkt.");
    const sentences = prepareSentences("INIT. von BIRK sinkt.", glossary);
    assert.equal(sentences.length, 1);
    assert.deepEqual(sentences[0]!.slots, ["Speed", "Birch"]);
  });

  it("keeps the Spanish stat labels whole, and only for Spanish", () => {
    assert.equal(prepareForTranslation("AT. ESP.", glossary, "es"), "X1");
    assert.equal(prepareForTranslation("DEF. ESP.", glossary, "es"), "X1");
    assert.deepEqual(prepareSentences("VELOC.", glossary, "es")[0]!.slots, ["Speed"], "a label on its own");
    const inLine = prepareSentences("Recupera PS y VELOC.", glossary, "es")[0]!;
    assert.deepEqual([inLine.text, inLine.slots], ["Recupera X1 y velocidad.", ["HP"]], "spelt out inside a sentence");
    assert.equal(prepareSentences("¡VELOCID. de TORCHIC bajó!", glossary, "es")[0]!.text, "¡Velocidad de Torchic bajó!");
    assert.notEqual(prepareForTranslation("VERT.", glossary, "es"), "X1", "German labels are not applied to Spanish");
    assert.equal(prepareForTranslation("PS", glossary), "PS", "and Spanish labels not to German");
  });

  it("gives the battle menu labels their English names", () => {
    assert.deepEqual(prepareSentences("HUIDA", glossary, "es")[0]!.slots, ["Run"]);
    assert.deepEqual(prepareSentences("MOCHILA", glossary, "es")[0]!.slots, ["Bag"]);
    assert.deepEqual(prepareSentences("FLUCHT", glossary)[0]!.slots, ["Run"]);
  });

  it("gives the German menu labels their English names, only when they stand alone", () => {
    const slots = (text: string) => prepareSentences(text, glossary).flatMap((s) => s.slots);
    for (const [label, english] of [["ZURÜCK", "Back"], ["EIN", "On"], ["AUS", "Off"], ["SICHERN", "Save"], ["ORDEN", "Badges"], ["KNOPFBELEGUNG", "Button Mode"], ["ITEMS", "Items"]] as const) {
      assert.deepEqual(slots(label), [english], label);
    }
    assert.deepEqual(slots("BEUTEL SCHLIESSEN"), ["Close Bag"], "not 'Bag Close'");
    assert.deepEqual(slots("BITTE NICHT AUSSCHALTEN"), [], "words that merely contain a label");
    assert.deepEqual(slots("Mach das Licht aus."), [], "only in capitals");
  });

  it("rewords German the translator gets wrong", () => {
    const text = (t: string) => prepareSentences(t, glossary).map((s) => s.text).join(" ");
    assert.equal(text("Wenn wir schon mal hier sind…"), "Da wir ohnehin hier sind…");
    assert.equal(text("Und wenn ich schon einmal da bin, frage ich."), "Und da ich ohnehin da bin, frage ich.");
    assert.equal(text("Wenn wir schon dabei sind, gehen wir."), "Wo wir gerade dabei sind, gehen wir.");
    assert.equal(text("Wenn wir hier sind, schlafen wir."), "Wenn wir hier sind, schlafen wir.", "other sentences are left alone");
    assert.equal(text("Es gibt bereits einen Spielstand."), "Es gibt bereits ein gespeichertes Spiel.");
    assert.equal(text("Das ist ein PKMN-SUPERMARKT."), "Das ist ein Pokémon-Supermarkt.");
    assert.equal(text("ZIGZACHS (Wild) wurde besiegt!"), "Das wilde Zigzachs wurde besiegt!");
    assert.equal(text("Es füllte KP von ZIGZACHS (Wild) auf!"), "Es füllte KP von Zigzachs (wild) auf!");
  });

  it("normalises names written in capitals with a lowercase ending, and words the model mistranslates", () => {
    const de = (t: string) => prepareSentences(t, glossary).map((s) => s.text).join(" ");
    assert.equal(de("Es gibt keine TRAINERn mehr."), "Es gibt keine X1 mehr.");
    assert.deepEqual(prepareSentences("Alle RÜPEL und das EI.", glossary)[0]!.slots, ["Grunt", "Egg"]);
    assert.deepEqual(prepareSentences("Die Geschichte eines TRAINERs.", glossary)[0]!.slots, ["Trainer"]);
    assert.deepEqual(prepareSentences("Mit den TRAINERn.", glossary)[0]!.slots, ["Trainers"]);
    assert.equal(de("Die EINZELKAMPF-Hallen."), "Die Einzelkampf-Hallen.");
    assert.deepEqual(prepareSentences("Der POKéNAV klingelt.", glossary)[0]!.slots, ["PokéNav"]);
    assert.equal(prepareSentences("Senkt den ANGR.-Wert.", glossary)[0]!.text, "Senkt den Angriff-Wert.");
    const es = (t: string) => prepareSentences(t, glossary, "es")[0]!;
    assert.deepEqual(es("¿Qué BAYA debería plantar?").slots, ["Berry"]);
    assert.equal(es("Suben el AT. de ASH.").text.startsWith("Suben el ataque"), true, "spelt out in a sentence");
    assert.equal(es("Esos malandrines.").text, "Esos granujas.");
  });

  it("gives the Spanish options and trainer card labels their English names", () => {
    const slots = (text: string) => prepareSentences(text, glossary, "es").flatMap((s) => s.slots);
    assert.deepEqual(slots("VELOC. TEXTO"), ["Text Speed"], "not just Speed");
    assert.deepEqual(slots("TIEMPO J."), ["Play Time"]);
    assert.deepEqual(slots("VELOCID."), ["Speed"]);
    assert.deepEqual(slots("MONO"), ["Mono"], "not the monkey");
    assert.deepEqual(slots("OBJETOS"), ["Items"]);
    assert.deepEqual(slots("MT / MO"), ["TMs/HMs"]);
    assert.deepEqual(slots("lo que debe hacer todo ENTRENADOR."), ["Trainer"]);
    assert.deepEqual(slots("Un mono y su tiempo."), [], "only in capitals");
  });

  it("rewords Spanish the translator gets wrong, keeping the first letter's case", () => {
    const text = (t: string) => prepareSentences(t, glossary, "es").map((s) => s.text).join(" ");
    assert.equal(text("¡Estupendo!"), "¡Genial!");
    assert.equal(text("Nuestro retoño es estupenda."), "Nuestro niño es genial.");
    assert.equal(text("Ya que estamos, vamos."), "Ya que estamos en ello, vamos.");
    assert.equal(text("Puedo oír cómo chillan."), "Puedo oír cómo gritan.");
    assert.equal(prepareSentences("Estupendo", glossary)[0]!.text, "Estupendo", "German is left alone");
    assert.equal(prepareForTranslation("Die Flucht gelingt.", glossary), "Die Flucht gelingt.", "only in capitals");
  });

  it("restores placeholders, or reports one that went missing", () => {
    assert.equal(restoreSlots("X2 uses X1!", ["Ember", "Zigzagoon"]), "Zigzagoon uses Ember!");
    assert.equal(restoreSlots("You got an X1!", ["Super Potion"]), "You got a Super Potion!");
    assert.equal(restoreSlots("A X1 hits.", ["Ember"]), "An Ember hits.");
    assert.equal(restoreSlots("Zigzagoon uses fire!", ["Zigzagoon"]), null);
  });

  it("splits sentences but not after abbreviations", () => {
    assert.deepEqual(splitSentences("Hallo! Ich bin Prof. Birch. Und du?"), ["Hallo!", "Ich bin Prof. Birch.", "Und du?"]);
  });
});

describe("speaker labels", () => {
  const known = new Set(["mamá", "abedul"]);
  const isWord = (w: string) => known.has(w.toLowerCase());
  const run = async (text: string) => {
    const provider = new FakeProvider();
    const out = await new Translator(provider, new AppDb(":memory:"), glossary).translateLine(text, "de", "en", glossary, isWord);
    return { text: out.text, calls: provider.calls };
  };

  it("keeps a speaker's name as written, so the model can't drop or mangle it", async () => {
    const r = await run("MR. TRUMM: Hast du meinen Auftrag vergessen?");
    assert.equal(r.text, "Mr. Trumm: EN(Hast du meinen Auftrag vergessen?)");
    assert.deepEqual(r.calls, ["Hast du meinen Auftrag vergessen?"]);
    assert.equal((await run("JO: Wirklich, wir sind viel besser geworden.")).text.startsWith("Jo: "), true);
  });

  it("translates a role that is a plain word, and a name the glossary knows", async () => {
    assert.equal((await run("MAMÁ: Hola, cariño, ¿cómo estás?")).text, "EN(Mamá): EN(Hola, cariño, ¿cómo estás?)");
    assert.equal((await run("BIRK: Hallo, ich bin hier, komm herein.")).text, "EN(Birch): EN(Hallo, ich bin hier, komm herein.)");
    assert.equal((await run("PROF. ABEDUL: Hola, cariño, ¿cómo estás?")).text, "EN(Prof. Abedul): EN(Hola, cariño, ¿cómo estás?)", "a title plus a plain word");
  });

  it("is not a speaker without a space after the colon", async () => {
    assert.equal((await run("TIPO:NORMAL")).text, "EN(Tipo:Normal)");
  });
});

describe("degenerate translations", () => {
  it("spots a loop or runaway output, not ordinary text", () => {
    assert.equal(isDegenerate("Items", "♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪ ♪"), true);
    assert.equal(isDegenerate("Hallo", "x".repeat(200)), true);
    assert.equal(isDegenerate("Hallo!", "Hello!"), false);
    assert.equal(isDegenerate("Ha ha ha ha ha ha ha ha", "Ha ha ha ha ha ha ha ha"), false, "a repeated source is allowed");
  });

  it("retries once, then shows the original", async () => {
    const db = new AppDb(":memory:");
    const provider = new FakeProvider();
    provider.translate = async (text: string) => (text === "Items" ? "♪ ".repeat(40) : text === "Items." ? "Items." : "EN");
    const t = new Translator(provider, db, glossary);
    assert.equal((await t.translateLine("Items", "de", "en")).text, "Items", "the retry worked");
    provider.translate = async () => "♪ ".repeat(40);
    assert.equal((await t.translateLine("Dinge", "de", "en")).text, "Dinge", "gave up: the original");
  });
});

describe("LinePipeline", () => {
  it("translates a menu screen one label per line", async () => {
    const { provider, pipeline } = setup();
    const out = await pipeline.submit({ ...line("WEITER\nSPIELZEIT"), meta: { source: "menu" } });
    assert.equal(out?.translation?.text, "EN(Continue)\nEN(Spielzeit)");
    assert.deepEqual(provider.calls, ["X1", "Spielzeit"]);
  });

  it("stores, translates per sentence and emits the line", async () => {
    const { db, provider, pipeline } = setup();
    const emitted: unknown[] = [];
    pipeline.on("line", (l) => emitted.push(l));

    const out = await pipeline.submit(line("Hallo! Ich bin BIRK."));
    assert.equal(out?.translation?.text, "EN(Hallo!) EN(Ich bin Birch.)");
    assert.equal(out?.translation?.cached, false);
    assert.equal(out?.source, "field");
    assert.ok(out?.analysis);
    assert.deepEqual(provider.calls, ["Hallo!", "Ich bin X1."]);
    assert.equal(emitted.length, 1);

    const row = db.db.prepare("SELECT text, translation FROM lines WHERE id = ?").get(out!.id) as Record<string, string>;
    assert.equal(row.translation, "EN(Hallo!) EN(Ich bin Birch.)");
    assert.ok(db.db.prepare("SELECT 1 FROM line_analyses WHERE line_id = ?").get(out!.id));
  });

  it("falls back to written-in names if the translator drops a placeholder", async () => {
    const db = new AppDb(":memory:");
    const provider = new FakeProvider();
    provider.translate = async (text: string) => {
      provider.calls.push(text);
      return text.includes("X1") ? "Hello there!" : `EN(${text})`;
    };
    const pipeline = new LinePipeline(db, { dictionary: null, glossary }, new Translator(provider, db, glossary), "en");
    const out = await pipeline.submit(line("Ich bin BIRK."));
    assert.equal(out?.translation?.text, "EN(Ich bin Birch.)");
    assert.deepEqual(provider.calls, ["Ich bin X1.", "Ich bin Birch."]);
  });

  it("serves repeated sentences from the cache", async () => {
    const { provider, pipeline } = setup();
    await pipeline.submit(line("Hallo!"));
    const second = await pipeline.submit(line("Hallo! Tschüss!"));
    assert.deepEqual(provider.calls, ["Hallo!", "Tschüss!"]);
    assert.equal(second?.translation?.cached, false);
    const third = await pipeline.submit(line("Hallo! Tschüss!"));
    assert.equal(third?.translation?.cached, true);
  });

  it("keeps the line when translation fails", async () => {
    const { provider, pipeline } = setup();
    const errors: string[] = [];
    pipeline.on("error", (e) => errors.push(e.message));
    provider.fail = true;
    const out = await pipeline.submit(line("Hallo!"));
    assert.equal(out?.translation, null);
    assert.ok(out?.analysis);
    assert.deepEqual(errors, ["model exploded"]);
  });

  it("counts how often a line came up before", async () => {
    const { pipeline } = setup();
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 0);
    await pipeline.submit(line("Tschüss!"));
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 1);
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 2);
  });

  it("stores lines in languages the translator can't handle, without an error", async () => {
    const { pipeline } = setup();
    const errors: string[] = [];
    pipeline.on("error", (e) => errors.push(e.message));
    const out = await pipeline.submit({ ...line("Un RONFLEX sauvage apparaît !"), lang: "fr" });
    assert.equal(out?.translation, null);
    assert.equal(out?.analysis, null);
    assert.deepEqual(errors, []);
  });

  it("processes lines in arrival order", async () => {
    const { pipeline } = setup();
    const order: string[] = [];
    pipeline.on("line", (l) => order.push(l.text));
    await Promise.all(["eins", "zwei", "drei"].map((t) => pipeline.submit(line(t))));
    assert.deepEqual(order, ["eins", "zwei", "drei"]);
  });
});
