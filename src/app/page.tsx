export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Dungeon Master</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          A multiplayer D&amp;D 5e table where the app is the referee and the AI is
          the storyteller.
        </p>
      </div>
      <p className="text-sm text-neutral-500">
        Foundation in progress — see{" "}
        <a className="underline underline-offset-4" href="/status">
          /status
        </a>{" "}
        for what is built and what is not.
      </p>
    </main>
  );
}
