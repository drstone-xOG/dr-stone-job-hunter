// netlify/functions/ai-assistant.js
//
// Server-side call to an OpenAI-compatible chat completions API.
// OPENAI_API_KEY lives only in Netlify's environment — read here on the
// server and never sent to or exposed in the browser.
//
// The frontend POSTs: { mode, message, profile, tweets, jobDescription }
//   mode: "brand_analysis" | "job_match" | "chat" | "post_ideas" | "outreach"
//   profile / tweets: the public X data already fetched via x-data.js
//
// This function builds the system prompt server-side so the "how" of the
// coaching logic isn't duplicated/exposed in client JS, and so the API key
// never has to travel through the browser to be used.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function buildSystemPrompt(mode) {
  const base = `You are a sharp, honest personal-branding and job-search coach for Web3 professionals. You are direct, specific, and never generic — always ground advice in the actual X (Twitter) profile and posts data you're given, quoting or referencing specifics (follower count, bio wording, recurring topics, posting cadence) rather than giving advice that could apply to anyone. Never invent facts about the person's account; if data is missing or thin, say so plainly. Keep formatting clean and skimmable (short paragraphs, bullets where useful). Do not be sycophantic — if the profile or fit is weak, say so and explain why.`;

  const modePrompts = {
    brand_analysis: `${base}\n\nTask: analyze this X profile and recent posts for Web3 personal branding. Give:\n1) A personal-brand score out of 100 with a one-line justification\n2) 3-5 concrete strengths\n3) 3-5 concrete weaknesses/gaps\n4) Specific bio/positioning rewrite suggestions\n5) 2-3 Web3 role types this profile currently signals fit for`,
    job_match: `${base}\n\nTask: you'll receive a job description plus the person's X profile/posts as a proxy for their public positioning and experience signals. Assess fit. Give:\n1) Overall fit percentage with reasoning\n2) Matching strengths (tie each to something specific in their profile/posts)\n3) Missing requirements or gaps\n4) What to emphasize in the application\nBe honest about weak fits rather than inflating the percentage.`,
    outreach: `${base}\n\nTask: draft a short, non-cringe outreach message (to a founder, recruiter, or project team) based on the person's X profile/posts and whatever context they give you about the target. Keep it under 120 words, specific, not templated-sounding.`,
    post_ideas: `${base}\n\nTask: suggest 3-5 concrete X post ideas/drafts, tailored to the person's existing voice and topics, designed to attract Web3 recruiters and projects. Show the actual draft text for each, not just topics.`,
    chat: `${base}\n\nTask: answer the user's question directly, using their X profile/posts data as context where relevant.`,
  };

  return modePrompts[mode] || modePrompts.chat;
}

function summarizeContext({ profile, tweets, jobDescription }) {
  const parts = [];
  if (profile) {
    parts.push(
      `X PROFILE DATA:\n${JSON.stringify(
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
    parts.push(`RECENT POSTS (up to 20):\n${JSON.stringify(compact, null, 2)}`);
  }
  if (jobDescription) {
    parts.push(`JOB DESCRIPTION:\n${jobDescription}`);
  }
  return parts.join("\n\n");
}

exports.handler = async (event) => {
  const jsonHeaders = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Server is not configured. Missing AI API credentials." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { mode, message, profile, tweets, jobDescription } = payload;
  const systemPrompt = buildSystemPrompt(mode);
  const contextBlock = summarizeContext({ profile, tweets, jobDescription });

  const userMessage = [contextBlock, message ? `USER REQUEST:\n${message}` : ""].filter(Boolean).join("\n\n");

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage || "Please analyze the provided context." },
        ],
        temperature: 0.6,
      }),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      return {
        statusCode: upstream.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "AI request failed.",
          status: upstream.status,
          detail: data && data.error ? data.error.message || data.error : data,
        }),
      };
    }

    const reply = data.choices?.[0]?.message?.content || "No response generated.";
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ reply }) };
  } catch (err) {
    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Could not reach AI API.", detail: String(err.message || err) }),
    };
  }
};
