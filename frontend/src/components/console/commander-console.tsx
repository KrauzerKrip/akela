import { useState, type JSX } from "react";
import { sendIntervention } from "../../api/client";
import { useWarRoomStore } from "../../store/war-room-store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const AGENTS = ["ExecutionAgent", "PlanAgent", "IntelAgent"];

export function CommanderConsole(): JSX.Element {
  const [message, setMessage] = useState("");
  const [targetAgent, setTargetAgent] = useState("ExecutionAgent");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSession = useWarRoomStore((state) => state.activeSession);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeSession || !message.trim()) {
      return;
    }

    setSending(true);
    setError(null);
    try {
      await sendIntervention(activeSession.id, targetAgent, message.trim());
      setMessage("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send command.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="border-t border-zinc-800 bg-zinc-950 p-3">
      <form className="flex items-end gap-2" onSubmit={onSubmit}>
        <div className="w-44">
          <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Target</label>
          <select
            className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
            value={targetAgent}
            onChange={(event) => setTargetAgent(event.currentTarget.value)}
          >
            {AGENTS.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">Override Command</label>
          <Input
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder="Cmd+K style override: Re-task Alpha to hold at grid 102.42-054.10"
          />
        </div>
        <Button type="submit" variant="default" disabled={sending || !activeSession}>
          {sending ? "Sending..." : "Transmit"}
        </Button>
      </form>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
