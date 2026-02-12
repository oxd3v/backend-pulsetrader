
export const timeoutPromise = new Promise((resolve) =>
  setTimeout(() => {
    // We don't 'reject', we 'resolve' so the function can return
    // whatever results it gathered so far.
    resolve("TIMEOUT_REACHED");
  }, timeoutMs),
);
