// netlify/functions/ai-assistant.js
//
// Server-side Gemini AI call.
// GEMINI_API_KEY lives only in Netlify environment variables.
//
// Frontend POSTs:
// { mode, message, profile, tweets, jobDescription }

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function buildSystemPrompt(mode) {
  const base = `You are a sharp, honest personal-branding and job-search coach for Web3 professionals.

You are direct, specific, and never generic.

Always ground your advice in the actual X profile and posts data provided.

Never invent facts about the person's account. If data is missing or thin, say so plainly.

Keep formatting clean and easy to read. Use short paragraphs and bullets where useful.

Do not be sycophantic. If the profile or fit is weak, say so and explain why.`;

  const modePrompts = {
    brand_analysis: `${base}

Task: Analyze this X profile and recent posts for Web3 personal branding.

Give:
1. Personal-brand score out of 100 with a one-line justification
2. 3-5 concrete strengths
3. 3-5 concrete weaknesses or gaps
4. Specific bio and positioning rewrite suggestions
5. 2-3 Web3 role types this profile currently signals fit for`,

    job_match: `${base}

Task: Assess how well this person's profile fits the provided Web3 job.

Give:
1. Overall fit percentage with reasoning
2. Matching strengths tied to specific profile or post evidence
3. Missing requirements or gaps
4. What to emphasize in the application
5. What could hurt the application

Be honest rather than inflating the percentage.`,

    outreach: `${base}

Task: Draft a short, natural, non-cringe outreach message to a founder, recruiter, or Web3 project.

Use the person's actual profile, posts, and target context.

Keep it under 120 words.

Make it specific and human, not templated.`,

    post_ideas: `${base}

Task: Create 3-5 concrete X post ideas or drafts tailored to the person's existing voice and topics.

The goal is to attract Web3 recruiters, founders, and projects.

Show actual draft text, not just topics.`,

    chat: `${base}

Task: Answer the user's question directly.

Use their X profile and posts as context whenever relevant.`,
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

  if (tweets && Array.isArray(tweets) && tweets.length > 0) {
    const compact = tweets.slice(0, 20).map((t) => ({
      text: t.text || t.full_text || "",
      likes: t.likeCount ?? t.favorite_count ?? 0,
      retweets: t.retweetCount ?? t.retweet_count ?? 0,
      replies: t.replyCount ?? t.reply_count ?? 0,
      createdAt: t.createdAt || t.created_at || "",
    }));

    parts.push(
      `RECENT POSTS (up to 20):
${JSON.stringify(compact, null, 2)}`
    );
  } else {
    parts.push("RECENT POSTS: No posts were provided.");
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Server is not configured. Missing GEMINI_API_KEY.",
      }),
    };
  }

  let payload;

  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
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

  const fullPrompt = `${systemPrompt}

${userMessage || "Please analyze the provided context."}`;

  try {
    const upstream = await fetch(
      `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: fullPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.6,
          },
        }),
      }
    );

    const responseText = await upstream.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (err) {
      data = {
        raw: responseText,
      };
    }

    if (!upstream.ok) {
      let detail = "Unknown Gemini API error.";

      if (data?.error?.message) {
        detail = data.error.message;
      } else if (data?.message) {
        detail = data.message;
      } else {
        detail = JSON.stringify(data);
      }

      console.error("Gemini API error:", {
        status: upstream.status,
        detail,
      });

      return {
        statusCode: upstream.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "AI request failed.",
          status: upstream.status,
          detail,
        }),
      };
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ||
      "No response generated.";

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        reply,
      }),
    };
  } catch (err) {
    console.error("Gemini connection error:", err);

    return {
      statusCode: 502,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Could not reach Gemini API.",
        detail: String(err?.message || err),
      }),
    };
  }
};
