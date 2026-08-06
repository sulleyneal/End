import { describe, expect, it } from "vitest";
import { formatDiscord, isDiscordWebhookUrl } from "./discord";

describe("isDiscordWebhookUrl", () => {
  it("accepts the real thing", () => {
    expect(
      isDiscordWebhookUrl("https://discord.com/api/webhooks/123456/abcdef-token"),
    ).toBe(true);
    expect(
      isDiscordWebhookUrl("https://discordapp.com/api/webhooks/123456/abcdef"),
    ).toBe(true);
  });

  it("refuses a URL pointing anywhere else", () => {
    // The server POSTs the table's narrative to whatever this says. A client
    // that can set it to their own host has exfiltrated the campaign.
    expect(isDiscordWebhookUrl("https://evil.example.com/api/webhooks/1/x")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com.evil.example/api/webhooks/1/x")).toBe(
      false,
    );
  });

  it("refuses plaintext http even on the right host", () => {
    expect(isDiscordWebhookUrl("http://discord.com/api/webhooks/123/abc")).toBe(false);
  });

  it("refuses a Discord URL that is not a webhook endpoint", () => {
    expect(isDiscordWebhookUrl("https://discord.com/channels/123/456")).toBe(false);
  });

  it("refuses nonsense without throwing", () => {
    expect(isDiscordWebhookUrl("")).toBe(false);
    expect(isDiscordWebhookUrl("not a url")).toBe(false);
    expect(isDiscordWebhookUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("formatDiscord", () => {
  it("mentions the people it is for", () => {
    const text = formatDiscord({
      mentionUserIds: ["111", "222"],
      title: "Your turn",
      body: "Thorin is up.",
    });
    expect(text).toContain("<@111> <@222>");
    expect(text).toContain("**Your turn**");
  });

  it("works with nobody to mention", () => {
    const text = formatDiscord({ title: "Session over", body: "Recap is up." });
    expect(text.startsWith("**Session over**")).toBe(true);
  });

  it("appends a link when there is one", () => {
    const text = formatDiscord({
      title: "T",
      body: "B",
      url: "https://example.com/campaign/1",
    });
    expect(text.endsWith("https://example.com/campaign/1")).toBe(true);
  });

  it("truncates past Discord's limit instead of being rejected", () => {
    const text = formatDiscord({ title: "T", body: "x".repeat(5000) });
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith("…")).toBe(true);
  });
});
