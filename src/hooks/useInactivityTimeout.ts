import { useEffect, useRef, useState, useCallback } from "react";

const INACTIVITY_WARNING_MS = 30 * 60 * 1000; // 30 minutes
const INACTIVITY_LOGOUT_MS = 35 * 60 * 1000; // 35 minutes

export function useInactivityTimeout(onLogout: () => void) {
  const [showWarning, setShowWarning] = useState(false);
  const warningTimer = useRef<ReturnType<typeof setTimeout>>();
  const logoutTimer = useRef<ReturnType<typeof setTimeout>>();

  const resetTimers = useCallback(() => {
    setShowWarning(false);
    clearTimeout(warningTimer.current);
    clearTimeout(logoutTimer.current);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
    }, INACTIVITY_WARNING_MS);

    logoutTimer.current = setTimeout(() => {
      onLogout();
    }, INACTIVITY_LOGOUT_MS);
  }, [onLogout]);

  useEffect(() => {
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimers));
    resetTimers();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimers));
      clearTimeout(warningTimer.current);
      clearTimeout(logoutTimer.current);
    };
  }, [resetTimers]);

  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    resetTimers();
  }, [resetTimers]);

  return { showWarning, dismissWarning };
}
