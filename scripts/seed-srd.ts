/**
 * Loads the vendored SRD 5.1 snapshot into the `srd_*` tables.
 *
 * The snapshot lives in `data/srd/2014` and is committed to the repo, so a
 * build never depends on a live third party. Re-running is safe: every row is
 * upserted on its primary key.
 *
 *   npm run db:seed
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

type SrdDoc = { index: string; name?: string } & Record<string, unknown>;

const DATA_DIR = join(process.cwd(), "data", "srd", "2014");

/** file (without extension) → destination table */
const SOURCES: Record<string, string> = {
  "5e-SRD-Ability-Scores": "srd_ability_scores",
  "5e-SRD-Alignments": "srd_alignments",
  "5e-SRD-Backgrounds": "srd_backgrounds",
  "5e-SRD-Classes": "srd_classes",
  "5e-SRD-Conditions": "srd_conditions",
  "5e-SRD-Damage-Types": "srd_damage_types",
  "5e-SRD-Equipment-Categories": "srd_equipment_categories",
  "5e-SRD-Equipment": "srd_equipment",
  "5e-SRD-Feats": "srd_feats",
  "5e-SRD-Features": "srd_features",
  "5e-SRD-Languages": "srd_languages",
  "5e-SRD-Levels": "srd_levels",
  "5e-SRD-Magic-Items": "srd_magic_items",
  "5e-SRD-Magic-Schools": "srd_magic_schools",
  "5e-SRD-Monsters": "srd_monsters",
  "5e-SRD-Proficiencies": "srd_proficiencies",
  "5e-SRD-Races": "srd_races",
  "5e-SRD-Rule-Sections": "srd_rule_sections",
  "5e-SRD-Rules": "srd_rules",
  "5e-SRD-Skills": "srd_skills",
  "5e-SRD-Spells": "srd_spells",
  "5e-SRD-Subclasses": "srd_subclasses",
  "5e-SRD-Subraces": "srd_subraces",
  "5e-SRD-Traits": "srd_traits",
  "5e-SRD-Weapon-Properties": "srd_weapon_properties",
};

function load(file: string): SrdDoc[] {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, `${file}.json`), "utf8"));
  return Array.isArray(raw) ? raw : [raw];
}

/** `srd_levels` documents carry no `name`; build a readable one from the index. */
function displayName(doc: SrdDoc): string {
  if (typeof doc.name === "string" && doc.name.length > 0) return doc.name;
  return doc.index
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  let grandTotal = 0;

  for (const [file, table] of Object.entries(SOURCES)) {
    const docs = load(file);
    // Spells are the one table with a denormalized column: a generated column
    // cannot contain a subquery, so the class list is flattened here instead.
    const isSpells = table === "srd_spells";

    const CHUNK = 100;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const rows: string[] = [];

      for (const doc of chunk) {
        const base = values.length;
        if (isSpells) {
          const classes = (
            (doc.classes as { index: string }[] | undefined) ?? []
          ).map((c) => c.index);
          rows.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}::text[])`);
          values.push(doc.index, displayName(doc), JSON.stringify(doc), classes);
        } else {
          rows.push(`($${base + 1}, $${base + 2}, $${base + 3}::jsonb)`);
          values.push(doc.index, displayName(doc), JSON.stringify(doc));
        }
      }

      const columns = isSpells
        ? `("index", "name", "data", "classes")`
        : `("index", "name", "data")`;
      const updates = isSpells
        ? `"name" = excluded."name", "data" = excluded."data", "classes" = excluded."classes"`
        : `"name" = excluded."name", "data" = excluded."data"`;

      await sql.query(
        `insert into "${table}" ${columns} values ${rows.join(", ")}
         on conflict ("index") do update set ${updates}`,
        values,
      );
    }

    grandTotal += docs.length;
    console.log(`  ${table.padEnd(28)} ${String(docs.length).padStart(4)} rows`);
  }

  console.log(`\nSeeded ${grandTotal} SRD documents across ${Object.keys(SOURCES).length} tables.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
