import { chromium } from "playwright";

const B = "http://localhost:3100";
const D = process.env.SHOT_DIR ?? "/tmp";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// Two fully independent contexts = two players on two devices.
const dm = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const player = await browser.newContext({ viewport: { width: 390, height: 844 } }); // phone

const step = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    console.log(`  FAIL ${label}: ${e.message}`);
    throw e;
  }
};

const a = await dm.newPage();
a.on("pageerror", (e) => console.log("  [console error]", e.message));

console.log("== Lobby: sign in ==");
await a.goto(B);
await step("sign-in form renders", async () => {
  await a.waitForSelector('input[placeholder="Ozzy"]');
});
await a.fill('input[placeholder="Ozzy"]', "Ozzy");
await a.click('button:has-text("Start playing")');
await step("reclaim code shown once", async () => {
  await a.waitForSelector("text=Save your reclaim code", { timeout: 15000 });
});

console.log("== Create a campaign ==");
await a.fill('input[placeholder="Campaign name"]', "The Hollow Mile");
await a.fill('input[placeholder="Genre (optional)"]', "frontier horror");
await a.fill('textarea', "A mining road where the last three shifts never came back up.");
await a.click('button:has-text("Create")');
await step("campaign appears in the list", async () => {
  await a.waitForSelector("text=The Hollow Mile", { timeout: 15000 });
});
await a.screenshot({ path: `${D}/shot-1-lobby.png`, fullPage: true });

const joinCode = await a.textContent(".tabular.tracking-wider");
console.log(`  join code: ${joinCode}`);

console.log("== Character builder ==");
await a.click("text=The Hollow Mile");
await a.waitForSelector("text=Make a character", { timeout: 15000 });
await a.click("text=Make a character to join the story");
await step("builder loads SRD options", async () => {
  await a.waitForSelector("text=Starting equipment", { timeout: 20000 });
});
await a.fill('input[placeholder="Roland Vahn"]', "Roland Vahn");
await step("skill chips are pickable", async () => {

  await a.locator('h2:has-text("Skills") + div button').first().click();
  await a.locator('h2:has-text("Skills") + div button').nth(1).click();
});
await a.screenshot({ path: `${D}/shot-2-builder.png`, fullPage: true });
await step("create button enables and submits", async () => {
  const btn = a.locator('button:has-text("Create character")');
  await btn.waitFor();
  if (await btn.isDisabled()) throw new Error("still disabled — a required choice is unsatisfied");
  await btn.click();
  await a.waitForSelector("text=Roland Vahn", { timeout: 25000 });
});

console.log("== Play screen ==");
await step("party panel shows derived AC/HP", async () => {
  await a.waitForSelector("text=/AC \\d+/", { timeout: 15000 });
});
const partyText = await a.textContent("aside");
console.log("  party panel:", partyText.replace(/\s+/g, " ").slice(0, 140));

console.log("== Second player joins on a phone ==");
const b = await player.newPage();
await b.goto(B);
await b.waitForSelector('input[placeholder="Ozzy"]');
await b.fill('input[placeholder="Ozzy"]', "Bramble");
await b.click('button:has-text("Start playing")');
await b.waitForSelector("text=Save your reclaim code", { timeout: 15000 });
await b.fill('input[placeholder="ABC123"]', joinCode.trim());
await b.click('button:has-text("Join")');
await step("second player sees the campaign", async () => {
  await b.waitForSelector("text=The Hollow Mile", { timeout: 15000 });
});
await b.click("text=The Hollow Mile");
await b.waitForSelector("text=Story", { timeout: 15000 });
await b.screenshot({ path: `${D}/shot-3-phone.png`, fullPage: true });

console.log("== A turn with the AI DM, seen live by both ==");
await a.fill('input[placeholder*="What does"]', "I shoulder open the mine office door and look for the shift log.");
await a.press('input[placeholder*="What does"]', "Enter");
await step("the player's own action appears in the log within a second", async () => {
  await a.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="story-log"]')
        ?.innerText.includes("shoulder open the mine office door"),
    { timeout: 15000 },
  );
});

await step("DM narrates, and the narration is substantial prose", async () => {
  await a.waitForFunction(
    () => {
      const log = document.querySelector('[data-testid="story-log"]');
      if (!log) return false;
      // Wait for real narration, not the placeholder or the thinking line.
      return log.innerText.length > 500 && !log.innerText.includes("The DM is thinking");
    },
    { timeout: 240000 },
  );
  const text = await a.innerText('[data-testid="story-log"]');
  console.log("       log is " + text.length + " chars, " +
    (await a.locator('[data-testid="story-log"] > *').count()) + " entries");
});

await step("the identical narration reaches the phone over SSE", async () => {
  const expected = (await a.innerText('[data-testid="story-log"]')).slice(-200);
  await b.waitForFunction(
    (tail) => document.querySelector('[data-testid="story-log"]')?.innerText.includes(tail),
    expected,
    { timeout: 90000 },
  );
  console.log("       phone received the same trailing 200 chars of narration");
});

await a.screenshot({ path: `${D}/shot-4-play.png`, fullPage: true });
await b.screenshot({ path: `${D}/shot-5-phone-live.png`, fullPage: true });

console.log("== Mid-combat refresh loses nothing ==");
const before = await a.innerText('[data-testid="story-log"]');
await a.reload();
await a.waitForSelector('[data-testid="story-log"]', { timeout: 20000 });
await a.waitForFunction(
  (len) => (document.querySelector('[data-testid="story-log"]')?.innerText.length ?? 0) >= len,
  before.length,
  { timeout: 30000 },
);
const after = await a.innerText('[data-testid="story-log"]');
await step(`the whole log survives a reload (${before.length} -> ${after.length} chars)`, async () => {
  if (after.length < before.length) throw new Error("log shrank after reload");
  if (!after.includes(before.slice(-200))) throw new Error("tail of the log was lost");
});

console.log("== Status page ==");
await a.goto(`${B}/status`);
await step("status page reports live checks", async () => {
  await a.waitForSelector("text=Build status");
  const text = await a.innerText("main");
  if (!text.includes("spells")) throw new Error("no live database detail");
  for (const line of text.split("\n").filter((l) => /spells|dice rolled|classes|API key/.test(l))) {
    console.log("       " + line.trim());
  }
});
await a.screenshot({ path: `${D}/shot-6-status.png`, fullPage: true });

await browser.close();
console.log("\nAll UI checks passed.");
