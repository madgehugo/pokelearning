/**
 * First-launch setup (#/setup): downloads and prepares the data the
 * companion needs, with progress. The Mac app shows this in its own window.
 */
import { useCallback, useEffect, useState } from "react";
import type { SetupStatus, SetupStep, SetupStepId } from "@pokelearning/shared";

const STEPS: Record<SetupStepId, { title: string; about: string }> = {
  names: { title: "Game names", about: "German and English names of Pokémon, moves, items and places, from PokéAPI." },
  dictionary: { title: "German dictionary", about: "About 100 MB from Wiktionary, turned into a dictionary on your Mac." },
  model: { title: "Translation model", about: "About 110 MB. Translates on your Mac, without an internet connection." },
};

const STATE_TEXT: Record<SetupStep["state"], string> = {
  missing: "Not downloaded yet",
  waiting: "Waiting",
  running: "",
  ready: "Done",
  failed: "",
};

async function post(path: string) {
  await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}

export function Setup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [offline, setOffline] = useState(false);

  const start = useCallback(() => void post("/api/setup/start").catch(() => setOffline(true)), []);

  useEffect(() => {
    start();
    let stopped = false;
    const poll = async () => {
      try {
        const s = (await (await fetch("/api/setup")).json()) as SetupStatus;
        if (!stopped) [setStatus(s), setOffline(false)];
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) setTimeout(poll, 500);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [start]);

  const failed = status?.steps.some((s) => s.state === "failed");
  return (
    <main className="setup">
      <h1>{status?.ready ? "Pokélearning is ready" : "Getting Pokélearning ready"}</h1>
      <p className="setup__intro">
        {status?.ready
          ? "Everything is in place. Your game starts in a moment."
          : "This happens once. It downloads about 230 MB and takes a few minutes; after that, everything works without an internet connection."}
      </p>
      {offline && <p className="error">Can't reach the Pokélearning server. It should start by itself; if this stays, quit and reopen the app.</p>}
      <ol className="setup__steps">
        {(status?.steps ?? []).map((s) => (
          <li key={s.id} className="setup__step" data-state={s.state}>
            <div className="setup__head">
              <span className="setup__title">{STEPS[s.id].title}</span>
              <span className="setup__state">
                {s.state === "running" && s.progress !== null ? `${Math.round(s.progress * 100)}%` : STATE_TEXT[s.state]}
              </span>
            </div>
            <div
              className="setup__bar"
              role="progressbar"
              aria-label={STEPS[s.id].title}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={s.progress === null ? undefined : Math.round(s.progress * 100)}
            >
              <div
                className="setup__fill"
                data-indeterminate={s.state === "running" && s.progress === null ? "" : undefined}
                style={{ transform: `scaleX(${s.state === "ready" ? 1 : (s.progress ?? 0)})` }}
              />
            </div>
            <p className={s.state === "failed" ? "error" : "muted"}>
              {s.state === "running" || s.state === "failed" ? s.detail : STEPS[s.id].about}
            </p>
          </li>
        ))}
      </ol>
      {failed && (
        <button type="button" className="primary-button" onClick={start}>
          Try again
        </button>
      )}
    </main>
  );
}
