// One connection budget spans handshake + server ready. A short recording waits
// for the remainder of this budget rather than immediately uploading it again.
export function connectionGate(signal, unavailable, timeoutMs = 10000) {
  let settled = false;
  let resolve;
  let timer;
  const ready = new Promise((done) => { resolve = done; });
  const settle = (ok, reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    resolve(ok);
    if (!ok && reason) unavailable(reason);
  };
  const abort = () => settle(false);
  timer = setTimeout(() => settle(false, "Aqua connection did not become ready within 10 seconds"), timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { ready, accept: () => settle(true), fail: (reason) => settle(false, reason) };
}
