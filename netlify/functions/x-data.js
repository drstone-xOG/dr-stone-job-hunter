// netlify/functions/x-data.js
//
// Server-side proxy to TwitterAPIs.com (https://docs.twitterapis.com).
// The TWITTERAPIS_KEY secret lives only in Netlify's environment — it is
// read here on the server and is NEVER sent to or exposed in the browser.
//
// Supported query params:
//   type      = "profile" | "tweets"   (required)
//   username  = X handle, no @         (required)
//   cursor    = pagination cursor      (optional, "tweets" only)
//
// Base URL + auth per TwitterAPIs docs: Bearer token in the Authorization header.
const BASE_URL = "https://api.twitterapis.com/twitter";

exports.handler = async (event) => {
  const jsonHeaders = { "Content-Type": "application/json" };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.TWITTERAPIS_KEY;
  if (!apiKey) {
    // Deliberately generic — never echo env var names/values in a way that
    // could leak into logs a client can see.
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Server is not configured. Missing TwitterAPIs credentials." }),
    };
  }

  const { type, username, cursor } = event.queryStringParameters || {};

  if (!username || typeof username !== "string") {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Missing required 'username' parameter." }) };
  }
  const cleanUsername = username.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanUsername)) {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Invalid X username." }) };
  }

  let path;
  const params = new URLSearchParams({ username: cleanUsername });

  if (type === "profile") {
    path = "/user/info";
  } else if (type === "tweets") {
    path = "/user/tweets";
    if (cursor) params.set("cursor", cursor);
  } else {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Invalid 'type'. Use 'profile' or 'tweets'." }) };
  }

  const url = `${BASE_URL}${path}?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      // Pass through status + whatever message the upstream gave, but strip
      // anything that might contain the request's own auth header.
      return {
        statusCode: upstream.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "TwitterAPIs request failed.",
          status: upstream.status,
          detail: data && data.message ? data.message : data,
        }),
      };
    }

    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify(data) };
  } catch (err) {
    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Could not reach TwitterAPIs.", detail: String(err.message || err) }),
    };
  }
};
