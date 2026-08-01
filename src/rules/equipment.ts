import type { SrdChoice, SrdClass, SrdEquipmentCategory, SrdOption } from "@/srd/types";
import { BuildError } from "./build";

/**
 * Starting equipment.
 *
 * The SRD expresses a class's kit as a list of choice blocks — "(a) chain mail
 * or (b) leather armour, a longbow and 20 arrows" — where an option can be a
 * single item, a bundle, or a nested choice drawn from a whole equipment
 * category ("a martial weapon"). The client sends which branch it took; this
 * resolves that into concrete items and rejects anything the class was never
 * offered.
 */

export type EquipmentSelection = {
  /** Index into the class's `starting_equipment_options`. */
  block: number;
  /** Which branch of that block was taken. */
  option: number;
  /** One entry per nested choice inside the branch, in order. */
  picks?: string[];
};

export type ResolvedItem = { itemIndex: string; quantity: number };

/** A choice block flattened for the UI to render. */
export type EquipmentChoiceView = {
  block: number;
  description: string;
  options: {
    option: number;
    label: string;
    /** Nested picks the player must also make, in order. */
    picks: { label: string; from: string[] }[];
  }[];
};

type Categories = Pick<SrdEquipmentCategory, "index" | "equipment">[];

function categoryItems(categories: Categories, index: string): string[] {
  const category = categories.find((c) => c.index === index);
  if (!category) throw new BuildError(`Unknown equipment category "${index}".`);
  return category.equipment.map((e) => e.index);
}

/** The concrete item indexes a nested choice may draw from. */
function allowedFor(choice: SrdChoice, categories: Categories): string[] {
  if (choice.from.option_set_type === "equipment_category") {
    const index = choice.from.equipment_category?.index;
    if (!index) throw new BuildError("Malformed equipment category choice.");
    return categoryItems(categories, index);
  }
  return (choice.from.options ?? []).flatMap((o) =>
    o.of ? [o.of.index] : o.item ? [o.item.index] : [],
  );
}

/**
 * Expands one branch into items, consuming `picks` in order for any nested
 * choices it contains.
 */
function expandOption(
  option: SrdOption,
  picks: string[],
  cursor: { i: number },
  categories: Categories,
  label: string,
): ResolvedItem[] {
  switch (option.option_type) {
    case "counted_reference":
      if (!option.of) throw new BuildError(`${label}: malformed equipment entry.`);
      return [{ itemIndex: option.of.index, quantity: option.count ?? 1 }];

    case "reference":
      if (!option.item) throw new BuildError(`${label}: malformed equipment entry.`);
      return [{ itemIndex: option.item.index, quantity: 1 }];

    case "multiple":
      return (option.items ?? []).flatMap((item) =>
        expandOption(item, picks, cursor, categories, label),
      );

    case "choice": {
      if (!option.choice) throw new BuildError(`${label}: malformed nested choice.`);
      const allowed = new Set(allowedFor(option.choice, categories));
      const count = option.choice.choose;
      const out: ResolvedItem[] = [];
      for (let n = 0; n < count; n++) {
        const pick = picks[cursor.i++];
        if (pick === undefined) {
          throw new BuildError(`${label}: ${option.choice.desc ?? "a choice"} was not made.`);
        }
        if (!allowed.has(pick)) {
          throw new BuildError(`${label}: "${pick}" is not an allowed choice here.`);
        }
        out.push({ itemIndex: pick, quantity: 1 });
      }
      return out;
    }

    default:
      throw new BuildError(`${label}: unsupported equipment option "${option.option_type}".`);
  }
}

/**
 * Resolves a class's fixed kit plus one branch per choice block.
 *
 * Every block must be answered exactly once — a request that skips one, answers
 * one twice, or reaches for an option that was not offered is rejected rather
 * than partially applied.
 */
export function resolveStartingEquipment(
  classDoc: SrdClass,
  selections: EquipmentSelection[],
  categories: Categories,
): ResolvedItem[] {
  const blocks = classDoc.starting_equipment_options ?? [];
  const items: ResolvedItem[] = (classDoc.starting_equipment ?? []).map((entry) => ({
    itemIndex: entry.equipment.index,
    quantity: entry.quantity,
  }));

  const seen = new Set<number>();
  for (const selection of selections) {
    if (selection.block < 0 || selection.block >= blocks.length) {
      throw new BuildError(`${classDoc.name} has no equipment choice ${selection.block + 1}.`);
    }
    if (seen.has(selection.block)) {
      throw new BuildError(`Equipment choice ${selection.block + 1} was answered twice.`);
    }
    seen.add(selection.block);
  }

  for (const [index, block] of blocks.entries()) {
    const selection = selections.find((s) => s.block === index);
    if (!selection) {
      throw new BuildError(
        `Equipment choice ${index + 1} (${block.desc ?? "unnamed"}) was not answered.`,
      );
    }

    const label = `Equipment choice ${index + 1}`;
    const picks = selection.picks ?? [];

    // Some blocks have no branches at all — they are a straight pick from a
    // category ("a holy symbol", "any simple weapon").
    if (block.from.option_set_type === "equipment_category") {
      const allowed = new Set(allowedFor(block, categories));
      if (picks.length !== block.choose) {
        throw new BuildError(
          `${label}: choose exactly ${block.choose} (${block.desc ?? "item"}), got ${picks.length}.`,
        );
      }
      for (const pick of picks) {
        if (!allowed.has(pick)) {
          throw new BuildError(`${label}: "${pick}" is not an allowed choice here.`);
        }
        items.push({ itemIndex: pick, quantity: 1 });
      }
      continue;
    }

    const option = (block.from.options ?? [])[selection.option];
    if (!option) {
      throw new BuildError(`Equipment choice ${index + 1} has no option ${selection.option + 1}.`);
    }

    const cursor = { i: 0 };
    items.push(...expandOption(option, picks, cursor, categories, label));

    if (cursor.i < picks.length) {
      throw new BuildError(`${label}: more choices were sent than this option needs.`);
    }
  }

  // Merge duplicates so a character holds one row of 40 arrows, not two of 20.
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.itemIndex, (merged.get(item.itemIndex) ?? 0) + item.quantity);
  }
  return [...merged].map(([itemIndex, quantity]) => ({ itemIndex, quantity }));
}

/** Flattens a class's equipment blocks into something a form can render. */
export function equipmentChoicesFor(
  classDoc: SrdClass,
  categories: Categories,
): EquipmentChoiceView[] {
  return (classDoc.starting_equipment_options ?? []).map((block, blockIndex) => {
    const description = block.desc ?? `Choice ${blockIndex + 1}`;

    // A category block is a single implicit branch: pick N from the category.
    if (block.from.option_set_type === "equipment_category") {
      const from = allowedFor(block, categories);
      return {
        block: blockIndex,
        description,
        options: [
          {
            option: 0,
            label: description,
            picks: Array.from({ length: block.choose }, () => ({
              label: description,
              from,
            })),
          },
        ],
      };
    }

    return {
      block: blockIndex,
      description,
      options: (block.from.options ?? []).map((option, optionIndex) => {
        const picks: { label: string; from: string[] }[] = [];
        const labels: string[] = [];

        const walk = (o: SrdOption) => {
          if (o.option_type === "counted_reference" && o.of) {
            labels.push(o.count && o.count > 1 ? `${o.count} ${o.of.name}` : o.of.name);
          } else if (o.option_type === "reference" && o.item) {
            labels.push(o.item.name);
          } else if (o.option_type === "multiple") {
            for (const item of o.items ?? []) walk(item);
          } else if (o.option_type === "choice" && o.choice) {
            const desc = o.choice.desc ?? "a choice";
            labels.push(desc);
            for (let n = 0; n < o.choice.choose; n++) {
              picks.push({
                label: desc,
                from: allowedFor(o.choice, categories),
              });
            }
          }
        };
        walk(option);

        return { option: optionIndex, label: labels.join(", "), picks };
      }),
    };
  });
}
