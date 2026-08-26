// netlify/functions/ai-assistant.js
//
// Signal HQ AI Assistant
// Gemini-powered Web3 X profile, content, job-match, outreach,
// and post-idea analysis.
//
// GEMINI_API_KEY must be stored in Netlify Environment Variables.
// Never put the API key in this file.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

function buildSystemPrompt(mode) {
  const base = `You are Signal HQ, an expert Web3 personal-branding, growth-marketing, and career-analysis AI.

Your job is to analyze the user's REAL X profile and REAL recent posts and give useful, evidence-based advice.

IMPORTANT ANALYSIS RULES:

1. NEVER invent facts.
2. Clearly distinguish ORIGINAL POSTS from REPOSTS/RETWEETS when the available data allows it.
3. Do not treat a repost as proof that the user personally created or believes the content.
4. Generic posts such as "GM", "GN", simple greetings, motivational posts, engagement bait, and low-information posts should be identified as LOW-SIGNAL CONTENT.
5. Look for evidence of actual expertise: original analysis, educational threads, market observations, case studies, growth results, strategy, opinions, technical knowledge, project insights, or useful commentary.
6. Analyze engagement relative to follower count rather than looking only at raw likes.
7. Identify the user's main content pillars based on what they ACTUALLY post.
8. Compare the user's bio/positioning against their actual content.
9. If the bio makes a claim that the content does not support, say so directly.
10. Do not automatically praise the user. Give honest criticism when warranted.
11. Never claim a user has experience, achievements, clients, or results unless the provided data supports it.
12. If there isn't enough data to make a conclusion, explicitly say that.
13. Keep recommendations practical and specific to Web3.
14. Use the available data instead of giving generic social-media advice.

When discussing engagement, remember:
- A large follower count does not automatically mean strong influence.
- A small account can have excellent engagement.
- Reposts generally provide weaker evidence of original expertise than original posts.
- GM/GN and other generic engagement posts should not be counted as strong authority-building content.

Use clean formatting with headings, bullets, and concise explanations.`;

  const modePrompts = {
    brand_analysis: `${base}

TASK: Perform a serious X personal-brand audit.

Return the analysis in this structure:

## Overall Score
Give a score from 0-100 and explain the score briefly.

## Positioning
Explain what the profile currently appears to be about based on the bio AND actual content.

## Bio vs Reality
Compare the claims in the bio against what the recent posts actually demonstrate.

## Content Breakdown
Estimate the major content categories/pillars visible in the provided posts.

Separate:
- Original content
- Reposts/retweets
- Generic engagement content
- Expertise/value content

If exact percentages cannot be calculated from the supplied data, clearly label estimates as estimates.

## Engagement Quality
Evaluate likes, replies, and reposts relative to the follower count when those numbers are available.

Don't just say "good engagement" or "bad engagement." Explain what the numbers suggest.

## Strengths
Give 3-5 specific strengths supported by the data.

## Weaknesses
Give 3-5 specific weaknesses supported by the data.

## Biggest Problem
Identify the single biggest thing preventing the profile from looking stronger professionally.

## Fix Plan
Give 5 concrete actions the user should take over the next 30 days.

## Better Positioning
Suggest 2-3 positioning directions that better match the person's actual strengths and goals.

Be blunt but constructive.`,

    job_match: `${base}

TASK: Analyze how well this person fits the provided Web3 job.

Return:

## Fit Score
Give a percentage and explain it.

## Strong Matches
List requirements supported by actual profile/content evidence.

## Weak Matches
List requirements that are missing or poorly demonstrated.

## Evidence From X
Explain which parts of the profile/content help or hurt the application.

## Positioning Risk
Explain anything on the X profile that could make a recruiter question the candidate.

## Application Strategy
Tell the user exactly what to emphasize.

## Verdict
Give a clear conclusion:
- Strong fit
- Possible fit
- Weak fit

Do not inflate the score.`,

    outreach: `${base}

TASK: Create a short outreach message to a Web3 founder, recruiter, project, or hiring manager.

Use the actual profile and context provided.

The message should:
- Sound human
- Be concise
- Avoid cringe
- Avoid generic "I love what you're building" language
- Mention a relevant skill or observation when supported by the data
- Clearly communicate why the user is reaching out

Keep it under 120 words.`,

    post_ideas: `${base}

TASK: Create 5 X post ideas specifically designed to improve this person's Web3 personal brand.

Base the ideas on the user's actual content and weaknesses.

For each idea provide:

1. Content angle
2. Why it fits the user's positioning
3. A ready-to-post draft

Prioritize:
- Original expertise
- Useful observations
- Web3 growth/marketing insights
- Case studies
- Lessons learned
- Strong opinions backed by reasoning

Avoid generic GM/GN posts and engagement bait.`,

    chat: `${base}

TASK: Answer the user's question directly.

Use the supplied X profile and posts as context when relevant.

If the user asks about their profile, reference actual evidence from the supplied data rather than giving generic advice.`,
  };

  return modePrompts[mode] || modePrompts.chat;
}

function isLikelyRepost(tweet) {
  const text = String(tweet?.text || tweet?.full_text || "").trim();

  return (
    tweet?.retweeted === true ||
    tweet?.isRetweet === true ||
    tweet?.is_repost === true ||
    /^RT\s+@/i.test(text) ||
    /^reposted\s+/i.test(text)
  );
}

function isGenericPost(tweet) {
  const text = String(tweet?.text || tweet?.full_text || "")
    .trim()
    .toLowerCase();

  if (!text) return true;

  const genericPatterns = [
    /^gm[!.]?\s*(ct|web3|crypto)?$/i,
    /^gn[!.]?\s*(ct|web3|crypto)?$/i,
    /^good morning[!.]?\s*(ct|everyone)?$/i,
    /^good night[!.]?\s*(ct|everyone)?$/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  return text.length < 25;
}

function summarizeContext({ profile, tweets, jobDescription }) {
  const parts = [];

  if (profile) {
    const followers = Number(profile.followers) || 0;
    const following = Number(profile.following) || 0;

    parts.push(
      `X PROFILE DATA:
${JSON.stringify(
  {
    username: profile.userName || profile.username || "",
    name: profile.name || "",
    bio: profile.description || "",
    location: profile.location || "",
    followers,
    following,
    postsCount: profile.statusesCount || 0,
    createdAt: profile.createdAt || "",
  },
  null,
  2
)}`
    );
  }

  if (Array.isArray(tweets) && tweets.length > 0) {
    const analyzedTweets = tweets.slice(0, 20).map((t) => {
      const likes = Number(
        t.likeCount ?? t.favorite_count ?? t.likes ?? 0
      );

      const retweets = Number(
        t.retweetCount ?? t.retweet_count ?? t.retweets ?? 0
      );

      const replies = Number(
        t.replyCount ?? t.reply_count ?? t.replies ?? 0
      );

      const repost = isLikelyRepost(t);
      const generic = isGenericPost(t);

      return {
        text: t.text || t.full_text || "",
        likes,
        retweets,
        replies,
        createdAt: t.createdAt || t.created_at || "",
        classification: {
          likelyRepost: repost,
          likelyOriginal: !repost,
          lowSignalGeneric: generic,
        },
      };
    });

    parts.push(
      `RECENT X POSTS:
${JSON.stringify(analyzedTweets, null, 2)}`
    );
  } else {
    parts.push("RECENT X POSTS: No posts were provided.");
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
    mode = "chat",
    message = "",
    profile = null,
    tweets = [],
    jobDescription = "",
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

${userMessage || "Analyze the provided X profile and content."}`;

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
            temperature: 0.5,
            maxOutputTokens: 3000,
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

    const parts =
      data?.candidates?.[0]?.content?.parts || [];

    const reply = parts
      .map((part) => part?.text || "")
      .join("")
      .trim();

    if (!reply) {
      return {
        statusCode: 502,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "Gemini returned an empty response.",
          detail: data,
        }),
      };
    }

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
