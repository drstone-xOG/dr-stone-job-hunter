// netlify/functions/ai-assistant.js
//
// Server-side AI call through RapidAPI.
// RAPIDAPI_KEY lives only in Netlify environment variables.
//
// Frontend POSTs:
// { mode, message, profile, tweets, jobDescription }

const RAPIDAPI_URL =
  "https://free-chatgpt-api.p.rapidapi.com/chat-completion-one";

function buildSystemPrompt(mode) {
  const base = `You are a sharp, honest personal-branding and job-search coach for Web3 professionals. You are direct, specific, and never generic. Always ground advice in the actual X profile and posts data provided. Never invent facts. If data is missing, say so plainly. Keep formatting clean and skimmable. Do not be sycophantic.`;

  const modePrompts = {
    brand_analysis: `${base}

Task: Analyze this X profile and recent posts for Web3 personal branding.

Give:
1) Personal-brand score out of 100 with one-line justification
2) 3-5 concrete strengths
3) 3-5 concrete weaknesses/gaps
4) Specific bio/positioning rewrite suggestions
5) 2-3 Web3 role types this profile currently signals fit for`,

    job_match: `${base}

Task: Assess how well this person's profile fits the provided Web3 job.

Give:
1) Overall fit percentage with reasoning
2) Matching strengths tied to specific profile/posts evidence
3) Missing requirements or gaps
4) What to emphasize in the application
5) What could hurt the application

Be honest rather than inflating the percentage.`,

    outreach: `${base}

Task: Draft a short, natural, non-cringe outreach message to a founder, recruiter, or Web3 project.

Use the person's actual profile/posts and target context.
Keep it under 120 words.
Make it specific and human, not templated.`,

    post_ideas: `${base}

Task: Create 3-5 concrete X post ideas/drafts tailored to the person's existing voice and topics.

The goal is to attract Web3 recruiters, founders, and projects.
Show actual draft text, not just topics.`,

    chat: `${base}

Task: Answer the user's question directly.
Use the X profile and posts as context whenever relevant.`,
  };

  return modePrompts[mode] || modePrompts.chat;
}

function summarizeContext({ profile, tweets, jobDescription }) {
  const parts = [];

  if (profile) {
    parts.push(
      `X PROFILE DATA:
${JSON.stringify(
  {
    username: profile.userName,
    name: profile.name,
    bio: profile.description,
    location: profile.location,
    followers: profile.followers,
    following: profile.following,
    createdAt: profile.createdAt,
    statusesCount: profile.statusesCount,
  },
  null,
  2
)}`
    );
  }

  if (tweets && Array.isArray(tweets) && tweets.length) {
    const compact = tweets.slice(0, 20).map((t) => ({
      text: t.text || t.full_text,
      likes: t.likeCount ?? t.favorite_count,
      retweets: t.retweetCount ?? t.retweet_count,
      replies: t.replyCount ?? t.reply_count,
      createdAt: t.createdAt || t.created_at,
    }));

    parts.push(
      `RECENT POSTS (up to 20):
${JSON.stringify(compact, null, 2)}`
    );
  }

  if (jobDescription) {
    parts.push(`JOB DESCRIPTION:
${jobDescription}`);
  }

  return parts.join("\n\n");
}

exports.handler = async (event) => {
  const jsonHeaders = {
    "Content-Type": "application/json",
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Method not allowed",
      }),
    };
  }

  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Server is not configured. Missing RAPIDAPI_KEY.",
      }),
    };
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Invalid JSON body.",
      }),
    };
  }

  const {
    mode,
    message,
    profile,
    tweets,
    jobDescription,
  } = payload;

  const systemPrompt = buildSystemPrompt(mode);

  const contextBlock = summarizeContext({
    profile,
    tweets,
    jobDescription,
  });

  const userMessage = [
    contextBlock,
    message ? `USER REQUEST:\n${message}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `${systemPrompt}

${userMessage || "Please analyze the provided context."}`;

  try {
    const url = `${RAPIDAPI_URL}?prompt=${encodeURIComponent(prompt)}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "free-chatgpt-api.p.rapidapi.com",
        "Content-Type": "application/json",
      },
    });

    const text = await upstream.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text,
      };
    }

    if (!upstream.ok) {
      return {
        statusCode: upstream.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "AI request failed.",
          status: upstream.status,
          detail: data,
        }),
      };
    }

    const reply =
      data?.response ||
      data?.result ||
      data?.message ||
      data?.choices?.[0]?.message?.content ||
      "No response generated.";

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        reply,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Could not reach RapidAPI AI service.",
        detail: String(err?.message || err),
      }),
    };
  }
};
