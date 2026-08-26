// netlify/functions/x-data.js
// Server-side proxy for TwitterAPIs.com.
// The TWITTERAPIS_KEY stays inside Netlify environment variables.

const BASE_URL = "https://api.twitterapis.com/twitter";

exports.handler = async (event) => {
  const jsonHeaders = {
    "Content-Type": "application/json",
  };

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.TWITTERAPIS_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Server is not configured. Missing TwitterAPIs credentials.",
      }),
    };
  }

  const {
    type,
    username,
    cursor,
  } = event.queryStringParameters || {};

  if (!username || typeof username !== "string") {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Missing required 'username' parameter.",
      }),
    };
  }

  const cleanUsername = username.replace(/^@/, "").trim();

  if (!/^[A-Za-z0-9_]{1,15}$/.test(cleanUsername)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Invalid X username.",
      }),
    };
  }

  let path;

  // IMPORTANT: TwitterAPIs expects "username"
  const params = new URLSearchParams({
    username: cleanUsername,
  });

  if (type === "profile") {
    path = "/user/info";
  } else if (type === "tweets") {
    path = "/user/tweets";

    if (cursor) {
      params.set("cursor", cursor);
    }
  } else {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Invalid 'type'. Use 'profile' or 'tweets'.",
      }),
    };
  }

  const url = `${BASE_URL}${path}?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await upstream.text();

    let raw;

    try {
      raw = JSON.parse(text);
    } catch {
      raw = { raw: text };
    }

    if (!upstream.ok) {
      return {
        statusCode: upstream.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "TwitterAPIs request failed.",
          status: upstream.status,
          detail: raw?.message || raw,
        }),
      };
    }

    // ---------------------------------------------------------
    // PROFILE
    // Convert TwitterAPIs fields into the fields Signal HQ uses.
    // ---------------------------------------------------------

    if (type === "profile") {
      const p =
        raw?.data ||
        raw?.user ||
        raw?.result ||
        raw;

      const profile = {
        userName:
          p?.userName ??
          p?.username ??
          p?.screen_name ??
          cleanUsername,

        name:
          p?.name ??
          p?.display_name ??
          p?.displayName ??
          "",

        description:
          p?.description ??
          p?.bio ??
          "",

        location:
          p?.location ??
          "",

        followers:
          p?.followers ??
          p?.followers_count ??
          p?.public_metrics?.followers_count ??
          0,

        following:
          p?.following ??
          p?.following_count ??
          p?.friends_count ??
          p?.public_metrics?.following_count ??
          0,

        statusesCount:
          p?.statusesCount ??
          p?.statuses_count ??
          p?.tweet_count ??
          p?.tweets_count ??
          p?.public_metrics?.tweet_count ??
          0,

        createdAt:
          p?.createdAt ??
          p?.created_at ??
          "",

        isBlueVerified:
          p?.isBlueVerified ??
          p?.is_blue_verified ??
          p?.verified ??
          false,

        profileImageUrl:
          p?.profileImageUrl ??
          p?.profile_image_url ??
          p?.profile_image_url_https ??
          "",
      };

      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          data: profile,
          raw: raw,
        }),
      };
    }

    // ---------------------------------------------------------
    // TWEETS
    // Normalize different TwitterAPIs response structures.
    // ---------------------------------------------------------

    if (type === "tweets") {
      let tweets = [];

      if (Array.isArray(raw?.tweets)) {
        tweets = raw.tweets;
      } else if (Array.isArray(raw?.data)) {
        tweets = raw.data;
      } else if (Array.isArray(raw?.data?.tweets)) {
        tweets = raw.data.tweets;
      } else if (Array.isArray(raw?.results)) {
        tweets = raw.results;
      } else if (Array.isArray(raw?.results?.tweets)) {
        tweets = raw.results.tweets;
      } else if (Array.isArray(raw?.user?.tweets)) {
        tweets = raw.user.tweets;
      } else if (Array.isArray(raw?.result?.tweets)) {
        tweets = raw.result.tweets;
      }

      const normalizedTweets = tweets.map((t) => ({
        id:
          t?.id ??
          t?.tweet_id ??
          t?.rest_id ??
          "",

        text:
          t?.text ??
          t?.full_text ??
          t?.content ??
          "",

        createdAt:
          t?.createdAt ??
          t?.created_at ??
          "",

        likeCount:
          t?.likeCount ??
          t?.like_count ??
          t?.favorite_count ??
          t?.public_metrics?.like_count ??
          0,

        retweetCount:
          t?.retweetCount ??
          t?.retweet_count ??
          t?.retweetCount ??
          t?.public_metrics?.retweet_count ??
          0,

        replyCount:
          t?.replyCount ??
          t?.reply_count ??
          t?.public_metrics?.reply_count ??
          0,

        viewCount:
          t?.viewCount ??
          t?.view_count ??
          t?.public_metrics?.impression_count ??
          0,

        raw: t,
      }));

      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          tweets: normalizedTweets,
          data: normalizedTweets,
          count: normalizedTweets.length,
          next_cursor:
            raw?.next_cursor ??
            raw?.nextCursor ??
            raw?.pagination?.next_cursor ??
            null,
        }),
      };
    }

  } catch (err) {
    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Could not reach TwitterAPIs.",
        detail: String(err?.message || err),
      }),
    };
  }
};
