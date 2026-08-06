/**
 * Discord delivery, via an incoming webhook per campaign.
 *
 * Chosen as the first transport because it needs nothing installed on anyone's
 * phone: a group that plays together already has a server, already has it on
 * their phones, and has already decided how loudly it should buzz. Web push is
 * the more self-contained answer, but on iOS it only works once each player has
 * added the site to their Home Screen — a setup step people skip, after which
 * they silently receive nothing.
 */

/** Discord rejects anything longer; truncate rather than fail the send. */
const MAX_CONTENT = 2000;

export type DiscordMessage = {
  webhookUrl: string;
  /** Discord snowflakes to mention, so the right person's phone lights up. */
  mentionUserIds?: string[];
  title: string;
  body: string;
  url?: string;
};

/**
 * A webhook URL is a bearer credential — anyone holding it can post as the
 * table. This guards against a client talking the server into POSTing
 * elsewhere, which would leak the campaign's contents to an arbitrary host.
 */
export function isDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "discord.com" ||
        url.hostname === "discordapp.com" ||
        url.hostname === "canary.discord.com" ||
        url.hostname === "ptb.discord.com") &&
      url.pathname.startsWith("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

export function formatDiscord(message: Omit<DiscordMessage, "webhookUrl">): string {
  const mentions = (message.mentionUserIds ?? []).map((id) => `<@${id}>`).join(" ");
  const link = message.url ? `\n${message.url}` : "";
  const text = `${mentions ? `${mentions} ` : ""}**${message.title}**\n${message.body}${link}`;
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT - 1)}…` : text;
}

export async function sendDiscord(message: DiscordMessage): Promise<boolean> {
  if (!isDiscordWebhookUrl(message.webhookUrl)) return false;

  try {
    const response = await fetch(message.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: formatDiscord(message),
        // Only ping the people actually named. Without this a message
        // containing @everyone-shaped text could notify a whole server.
        allowed_mentions: { parse: [], users: message.mentionUserIds ?? [] },
      }),
    });
    if (!response.ok) {
      console.error(`Discord webhook returned ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    // A dead webhook must never take down the game action that triggered it.
    console.error("Discord webhook failed:", error);
    return false;
  }
}
