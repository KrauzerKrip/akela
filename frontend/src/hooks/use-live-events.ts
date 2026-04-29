import { useEffect, useRef } from "react";
import { connectLiveEvents } from "../api/client";
import { useWarRoomStore } from "../store/war-room-store";

const RECONNECT_DELAY_MS = 1500;

export function useLiveEvents(enabled: boolean): void {
  const appendLiveEvent = useWarRoomStore((state) => state.appendLiveEvent);
  const activeSession = useWarRoomStore((state) => state.activeSession);
  const reconnectTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let isUnmounted = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      socket = connectLiveEvents((event) => {
        const targetSession = event.sessionId ?? activeSession?.id;
        if (!targetSession) {
          return;
        }
        appendLiveEvent(targetSession, event);
      });

      socket.addEventListener("close", () => {
        if (!isUnmounted) {
          reconnectTimer.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current);
      }
      socket?.close();
    };
  }, [activeSession?.id, appendLiveEvent, enabled]);
}
