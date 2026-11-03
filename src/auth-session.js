export async function requestSession({
  fetchImpl = fetch,
  apiBaseUrl = "/api",
} = {}) {
  const response = await fetchImpl(`${apiBaseUrl}/auth/session`, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Session request failed.");
  }

  const session = await response.json();
  if (
    session &&
    typeof session === "object" &&
    !Array.isArray(session) &&
    session.authenticated === false &&
    session.user === null
  ) {
    return { state: "anonymous" };
  }

  if (
    session &&
    typeof session === "object" &&
    !Array.isArray(session) &&
    session.authenticated === true &&
    session.user &&
    typeof session.user === "object" &&
    typeof session.user.displayName === "string" &&
    session.user.displayName.trim()
  ) {
    return {
      state: "authenticated",
      displayName: session.user.displayName,
    };
  }

  throw new Error("Session response did not match the expected contract.");
}
