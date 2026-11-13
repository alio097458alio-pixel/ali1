// functions/index.js
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

admin.initializeApp();
const db = admin.firestore();

// مفاتيح سرية تُخزّن بأمان في Firebase Secrets (لا تظهر في المتصفح مطلقًا)
const SERPAPI_KEY = defineSecret("SERPAPI_KEY");       // لجلب نتائج Google Sports
const API_FOOTBALL_KEY = defineSecret("API_FOOTBALL_KEY"); // خيار إضافي للإحصائيات الدقيقة

const TARGET_LEAGUE_QUERIES = [
  { id: "premier-league", name: "الدوري الإنجليزي", query: "Premier League matches" },
  { id: "la-liga", name: "الدوري الإسباني", query: "La Liga matches" },
  { id: "champions-league", name: "دوري أبطال أوروبا", query: "UEFA Champions League matches" },
  { id: "egyptian-league", name: "الدوري المصري", query: "Egyptian Premier League matches" },
  { id: "serie-a", name: "الدوري الإيطالي", query: "Serie A matches" },
  { id: "saudi-pro", name: "دوري روشن السعودي", query: "Saudi Pro League matches" }
];

// تحويل حالة المباراة من جوجل إلى العربية
function mapMatchStatus(rawStatus = "") {
  const s = rawStatus.toLowerCase();
  if (s.includes("live") || s.includes("'") || s.includes("1st") || s.includes("2nd")) return "مباشرة";
  if (s.includes("ht") || s.includes("half")) return "استراحة";
  if (s.includes("ft") || s.includes("final") || s.includes("ended")) return "انتهت";
  return "لم تبدأ";
}

// دالة المزامنة الأساسية مع Google Sports
async function performGoogleMatchSync(serpKey, footballApiKey) {
  let syncedCount = 0;

  // 1) الجلب من Google Sports عبر SerpApi
  if (serpKey) {
    for (const league of TARGET_LEAGUE_QUERIES) {
      try {
        const res = await axios.get("https://serpapi.com/search.json", {
          params: {
            engine: "google",
            q: league.query,
            hl: "ar",
            gl: "eg",
            api_key: serpKey
          },
          timeout: 10000
        });

        const games = res.data?.sports_results?.games || [];
        for (const g of games) {
          if (!g.teams || g.teams.length < 2) continue;
          const home = g.teams[0];
          const away = g.teams[1];
          const matchId = `${league.id}_${(home.name + "_" + away.name).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_")}`;

          const newHomeScore = Number(home.score ?? 0);
          const newAwayScore = Number(away.score ?? 0);
          const status = mapMatchStatus(g.status || g.stage || "");

          const matchRef = db.collection("matches").doc(matchId);
          const existingSnap = await matchRef.get();
          const prevData = existingSnap.exists ? existingSnap.data() : null;

          await matchRef.set({
            matchId,
            leagueId: league.id,
            leagueName: league.name,
            homeTeam: home.name,
            awayTeam: away.name,
            homeLogo: home.thumbnail || "",
            awayLogo: away.thumbnail || "",
            homeScore: isNaN(newHomeScore) ? 0 : newHomeScore,
            awayScore: isNaN(newAwayScore) ? 0 : newAwayScore,
            matchTime: g.time || g.date || "",
            startTime: g.date ? new Date(g.date).toISOString() : new Date().toISOString(),
            matchStatus: status,
            source: "Google Sports",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          // إرسال تنبيه تلقائي إذا تغيرت النتيجة أثناء البث المباشر
          if (
            prevData &&
            status === "مباشرة" &&
            (prevData.homeScore !== newHomeScore || prevData.awayScore !== newAwayScore)
          ) {
            await sendGoalNotification({
              title: `⚽ هدف جديد! ${home.name} ${newHomeScore} - ${newAwayScore} ${away.name}`,
              body: `${league.name} - تحديث النتيجة المباشرة`,
              topic: `match_${matchId}`
            });
          }

          syncedCount++;
        }
      } catch (err) {
        console.error(`Error syncing ${league.id}:`, err.message);
      }
    }
  }

  // 2) بديل أو إثراء عبر API-Football عند توفر المفتاح (لإحصائيات الاستحواذ والتسديدات)
  if (footballApiKey) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const apiRes = await axios.get("https://v3.football.api-sports.io/fixtures", {
        params: { date: today },
        headers: { "x-apisports-key": footballApiKey },
        timeout: 10000
      });

      const fixtures = (apiRes.data?.response || []).slice(0, 40);
      for (const item of fixtures) {
        const matchId = `apif_${item.fixture.id}`;
        const statusShort = item.fixture.status.short;
        let arStatus = "لم تبدأ";
        if (["1H", "2H", "ET", "P"].includes(statusShort)) arStatus = "مباشرة";
        else if (statusShort === "HT") arStatus = "استراحة";
        else if (["FT", "AET", "PEN"].includes(statusShort)) arStatus = "انتهت";

        await db.collection("matches").doc(matchId).set({
          matchId,
          leagueId: `league_${item.league.id}`,
          leagueName: item.league.name,
          homeTeam: item.teams.home.name,
          awayTeam: item.teams.away.name,
          homeLogo: item.teams.home.logo,
          awayLogo: item.teams.away.logo,
          homeScore: item.goals.home ?? 0,
          awayScore: item.goals.away ?? 0,
          minute: item.fixture.status.elapsed || 0,
          startTime: item.fixture.date,
          matchStatus: arStatus,
          source: "API-Football",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        syncedCount++;
      }
    } catch (err) {
      console.error("API-Football error:", err.message);
    }
  }

  return syncedCount;
}

// جلب الأخبار تلقائيًا من Google News RSS
async function performGoogleNewsSync() {
  const rssUrl = "https://news.google.com/rss/search?q=%D9%83%D8%B1%D8%A9+%D8%A7%D9%84%D9%82%D8%AF%D9%85+OR+%D8%A7%D9%84%D8%AF%D9%88%D8%B1%D9%8A+%D8%A7%D9%84%D8%A5%D9%86%D8%AC%D9%84%D9%8A%D8%B2%D9%8A+OR+%D8%A7%D9%84%D8%AF%D9%88%D8%B1%D9%8A+%D8%A7%D9%84%D9%85%D8%B5%D8%B1%D9%8A&hl=ar&gl=EG&ceid=EG:ar";
  const res = await axios.get(rssUrl, { timeout: 10000 });
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(res.data);
  const items = parsed?.rss?.channel?.item || [];

  let count = 0;
  for (const item of items.slice(0, 15)) {
    const cleanId = Buffer.from(item.link || item.title).toString("base64").slice(0, 28).replace(/[/+=]/g, "");
    const sourceName = typeof item.source === "object" ? item.source["#text"] : (item.source || "Google News");

    await db.collection("news").doc(cleanId).set({
      newsId: cleanId,
      title: item.title,
      description: item.description ? item.description.replace(/<[^>]*>?/gm, "").slice(0, 220) : "",
      source: sourceName,
      externalUrl: item.link,
      category: "أخبار عالمية",
      image: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80",
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      autoSynced: true
    }, { merge: true });
    count++;
  }
  return count;
}

async function sendGoalNotification({ title, body, topic }) {
  try {
    await admin.messaging().send({
      topic,
      notification: { title, body }
    });
  } catch (e) {
    console.warn("FCM notice skipped:", e.message);
  }
}

// 1) جدولة مزامنة المباريات كل 3 دقائق
exports.autoSyncGoogleMatches = onSchedule(
  { schedule: "every 3 minutes", secrets: [SERPAPI_KEY, API_FOOTBALL_KEY] },
  async () => {
    const count = await performGoogleMatchSync(SERPAPI_KEY.value(), API_FOOTBALL_KEY.value());
    console.log(`Auto-synced ${count} matches.`);
  }
);

// 2) جدولة مزامنة الأخبار من Google News كل 30 دقيقة
exports.autoSyncGoogleNews = onSchedule("every 30 minutes", async () => {
  const count = await performGoogleNewsSync();
  console.log(`Auto-synced ${count} news articles.`);
});

// 3) زر المزامنة اليدوية الفورية من لوحة الإدارة
exports.manualSyncNow = onCall(
  { secrets: [SERPAPI_KEY, API_FOOTBALL_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (userDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "للمشرفين فقط");
    }

    const matchesCount = await performGoogleMatchSync(SERPAPI_KEY.value(), API_FOOTBALL_KEY.value());
    const newsCount = await performGoogleNewsSync();
    return { success: true, matchesCount, newsCount };
  }
);

// 4) التحقق من حقوق البث وتسليم رابط المشاهدة المرخص بأمان
exports.getAuthorizedStream = onCall(async (request) => {
  const { matchId, countryCode = "EG" } = request.data || {};
  if (!matchId) throw new HttpsError("invalid-argument", "معرف المباراة مطلوب");

  const snap = await db.collection("streamSources")
    .where("matchId", "==", matchId)
    .where("enabled", "==", true)
    .limit(1)
    .get();

  if (snap.empty) {
    return { available: false, reason: "لا يتوفر بث مرخص لهذه المباراة حاليًا" };
  }

  const source = snap.docs[0].data();
  const now = new Date();

  if (source.expiryDate && new Date(source.expiryDate) < now) {
    return { available: false, reason: "انتهت صلاحية ترخيص البث" };
  }

  if (Array.isArray(source.allowedRegions) && source.allowedRegions.length > 0) {
    if (!source.allowedRegions.includes("ALL") && !source.allowedRegions.includes(countryCode)) {
      return { available: false, reason: "البث غير متاح في منطقتك الجغرافية وفق حقوق الناقل الرسمي" };
    }
  }

  if (source.requiresPremium) {
    if (!request.auth) return { available: false, reason: "يتطلب تسجيل الدخول واشتراك الباقة المميزة" };
    const u = await db.collection("users").doc(request.auth.uid).get();
    if (!["gold", "premium"].includes(u.data()?.subscriptionTier)) {
      return { available: false, reason: "هذا البث الحصري متاح لمشتركي الباقة الذهبية والمميزة فقط" };
    }
  }

  return {
    available: true,
    streamUrl: source.streamUrl,
    streamType: source.streamType || "HLS",
    providerName: source.providerId || "الناقل الرسمي",
    officialLink: source.officialBroadcasterUrl || ""
  };
});

// 5) إرسال إشعار من لوحة التحكم
exports.sendAdminPush = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "غير مصرح");
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (userDoc.data()?.role !== "admin") throw new HttpsError("permission-denied", "للمشرفين فقط");

  const { title, body, topic = "all_users" } = request.data;
  await admin.messaging().send({
    topic,
    notification: { title, body }
  });
  return { sent: true };
});
