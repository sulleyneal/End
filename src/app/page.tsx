"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Field, inputClass } from "@/components/ui";

type User = { id: string; displayName: string };
type Campaign = {
  id: string;
  name: string;
  joinCode: string;
  status: string;
  role: string;
  genre: string | null;
};

export default function Lobby() {
  const [user, setUser] = useState<User | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [reclaimCode, setReclaimCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    const session = await api<{ user: User | null }>("/api/session");
    setUser(session.user);
    if (session.user) {
      const { campaigns } = await api<{ campaigns: Campaign[] }>("/api/campaigns");
      setCampaigns(campaigns);
    }
    setLoading(false);
  };

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Shell>
        <p className="text-[var(--muted)]">Loading…</p>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <SignIn
          onDone={(code) => {
            setReclaimCode(code);
            refresh().catch((e: Error) => setError(e.message));
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {reclaimCode && (
        <Card className="border-[var(--accent)] bg-[var(--accent-soft)]">
          <h2 className="font-semibold">Save your reclaim code</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            This is the only time it is shown. It moves you to another device — no account needed.
          </p>
          <p className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2 text-lg font-semibold tracking-wide tabular">
            {reclaimCode}
          </p>
        </Card>
      )}

      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Your tables</h1>
        <span className="text-sm text-[var(--muted)]">{user.displayName}</span>
      </div>

      <ErrorNote>{error}</ErrorNote>

      {campaigns.length === 0 ? (
        <p className="text-[var(--muted)]">
          No campaigns yet. Start one below, or join with a friend&rsquo;s code.
        </p>
      ) : (
        <ul className="grid gap-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                href={`/campaign/${c.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--accent)]"
              >
                <span>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-sm text-[var(--muted)]">
                    {c.genre ?? "No genre set"} · {c.role === "co_dm" ? "co-DM" : c.role}
                  </span>
                </span>
                <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-sm font-semibold tracking-wider tabular">
                  {c.joinCode}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <CreateCampaign onDone={() => void refresh()} />
        <JoinCampaign onDone={() => void refresh()} />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      {children}
      <footer className="mt-auto pt-8 text-xs text-[var(--muted)]">
        <Link href="/status" className="underline">
          Build status
        </Link>
      </footer>
    </main>
  );
}

function SignIn({ onDone }: { onDone: (reclaimCode: string | null) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (body: Record<string, string>) => {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ reclaimCode: string | null }>("/api/session", {
        method: "POST",
        json: body,
      });
      onDone(res.reclaimCode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">AI Dungeon Master</h1>
        <p className="mt-2 text-[var(--muted)]">
          A D&amp;D 5e table where the app is the referee and the AI tells the story. No account —
          just a name.
        </p>
      </div>

      <Card className="grid gap-4">
        <Field label="What should the table call you?">
          <input
            className={inputClass}
            value={name}
            maxLength={40}
            placeholder="Ozzy"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Button
          disabled={busy || name.trim().length === 0}
          onClick={() => void submit({ displayName: name })}
        >
          Start playing
        </Button>
      </Card>

      <Card className="grid gap-4">
        <Field label="Played before?" hint="Use the reclaim code you were given.">
          <input
            className={inputClass}
            value={code}
            placeholder="silver-raven-4127"
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={busy || code.trim().length === 0}
          onClick={() => void submit({ reclaimCode: code })}
        >
          Reclaim my player
        </Button>
      </Card>

      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

function CreateCampaign({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [premise, setPremise] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="grid gap-3">
      <h2 className="font-semibold">Start a campaign</h2>
      <input
        className={inputClass}
        placeholder="Campaign name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={inputClass}
        placeholder="Genre (optional)"
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
      />
      <textarea
        className={`${inputClass} min-h-20`}
        placeholder="Premise (optional) — what is this story about?"
        value={premise}
        onChange={(e) => setPremise(e.target.value)}
      />
      <Button
        disabled={busy || name.trim().length === 0}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/api/campaigns", {
              method: "POST",
              json: { name, genre: genre || undefined, premise: premise || undefined },
            });
            setName("");
            setGenre("");
            setPremise("");
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Create
      </Button>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

function JoinCampaign({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="grid gap-3">
      <h2 className="font-semibold">Join a table</h2>
      <p className="text-sm text-[var(--muted)]">Enter the six-character code from your DM.</p>
      <input
        className={`${inputClass} text-lg uppercase tracking-[0.3em] tabular`}
        placeholder="ABC123"
        maxLength={10}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={busy || code.trim().length === 0}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api("/api/campaigns/join", { method: "POST", json: { code } });
            setCode("");
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Join
      </Button>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}
