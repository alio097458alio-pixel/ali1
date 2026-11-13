// public/js/app.js
import { auth, db, functions } from "./firebase-config.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, orderBy, limit, onSnapshot, increment, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { initVideoPlayer, destroyPlayer } from "./player.js";

let currentUser = null;
let userProfile = { subscriptionTier: "free" };
let userFavorites = { favoriteTeams: [], favoriteLeagues: [], favoriteMatches: [] };
let allMatches = [];
let allLeagues = [];
let allNews = [];
let currentScheduleFilter = "today";
let isRegisterMode = false;

// الدوريات الافتراضية المرجعية
const DEFAULT_LEAGUES = [
  { leagueId: "premier-league", name: "الدوري الإنجليزي", country: "إنجلترا" },
  { leagueId: "la-liga", name: "الدوري الإسباني", country: "إسبانيا" },
  { leagueId: "serie-a", name: "الدوري الإيطالي", country: "إيطاليا" },
  { leagueId: "bundesliga", name: "الدوري الألماني", country: "ألمانيا" },
  { leagueId: "ligue-1", name: "الدوري الفرنسي", country: "فرنسا" },
  { leagueId: "egyptian-league", name: "الدوري المصري", country: "مصر" },
  { leagueId: "champions-league", name: "دوري أبطال أوروبا", country: "أوروبا" },
  { leagueId: "caf-cl", name: "دوري أبطال إفريقيا", country: "إفريقيا" }
];

// التنقل بين الصفحات
window.navigateTo = (pageName) => {
  if (pageName !== "match-detail") destroyPlayer();
  document.querySelectorAll(".page-section").forEach(s => s.classList.add("hidden"));
  document.getElementById(`page-${pageName}`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.page === pageName);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
};

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => window.navigateTo(btn.dataset.page));
});

// مراقبة حالة المستخدم والاشتراك
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const authBtn = document.getElementById("authBtn");

  if (user) {
    const uSnap = await getDoc(doc(db, "users", user.uid));
    userProfile = uSnap.exists() ? uSnap.data() : { name: user.email, subscriptionTier: "free" };

    const favSnap = await getDoc(doc(db, "favorites", user.uid));
    if (favSnap.exists()) userFavorites = favSnap.data();

    authBtn.textContent = `${userProfile.name || "حسابي"} (خروج)`;
    authBtn.onclick = () => signOut(auth);
  } else {
    userProfile = { subscriptionTier: "free" };
    userFavorites = { favoriteTeams: [], favoriteLeagues: [], favoriteMatches: [] };
    authBtn.textContent = "تسجيل الدخول";
    authBtn.onclick = () => document.getElementById("authModal").classList.add("open");
  }

  renderAds();
  renderFavoritesPage();
  renderPlans();
});

// نافذة التسجيل والدخول
window.closeAuthModal = () => document.getElementById("authModal").classList.remove("open");

document.getElementById("toggleAuthMode").onclick = () => {
  isRegisterMode = !isRegisterMode;
  document.getElementById("registerNameGroup").classList.toggle("hidden", !isRegisterMode);
  document.getElementById("authModalTitle").textContent = isRegisterMode ? "إنشاء حساب جديد" : "تسجيل الدخول إلى KORA LIVE";
  document.getElementById("toggleAuthMode").textContent = isRegisterMode
    ? "لديك حساب بالفعل؟ سجل دخولك"
    : "ليس لديك حساب؟ أنشئ حسابًا جديدًا";
};

document.getElementById("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName").value.trim();

  try {
    if (isRegisterMode) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        userId: cred.user.uid,
        name: name || email.split("@")[0],
        email,
        createdAt: new Date().toISOString()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    window.closeAuthModal();
  } catch (err) {
    alert("خطأ في المصادقة: " + err.message);
  }
};

// الاستماع الفوري (Real-time) للمباريات المنشورة تلقائيًا
onSnapshot(query(collection(db, "matches"), orderBy("startTime", "asc"), limit(100)), (snap) => {
  allMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderHomeMatches();
  renderSchedule();
});

// الاستماع الفوري للأخبار
onSnapshot(query(collection(db, "news"), orderBy("publishedAt", "desc"), limit(30)), (snap) => {
  allNews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderNews();
});

// جلب الدوريات
async function loadLeagues() {
  const snap = await getDocs(collection(db, "leagues"));
  allLeagues = snap.empty ? DEFAULT_LEAGUES : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const filterEl = document.getElementById("leagueFilter");
  filterEl.innerHTML = `<option value="all">كل الدوريات</option>`;
  allLeagues.forEach(l => {
    filterEl.innerHTML += `<option value="${l.leagueId}">${l.name}</option>`;
  });

  const html = allLeagues.map(l => `
    <div class="card match-card" style="text-align:center;" onclick="openLeague('${l.leagueId}', '${l.name}')">
      <div style="font-size:1.8rem; margin-bottom:6px;">🏆</div>
      <div style="font-weight:700;">${l.name}</div>
      <div style="font-size:0.8rem; color:var(--text-muted);">${l.country || ""}</div>
    </div>
  `).join("");

  document.getElementById("homeLeagues").innerHTML = html;
  document.getElementById("leaguesGrid").innerHTML = html;
}

window.openLeague = async (leagueId, leagueName) => {
  window.navigateTo("leagues");
  document.getElementById("selectedLeagueTitle").textContent = `جدول ترتيب: ${leagueName}`;
  const tbody = document.getElementById("standingsBody");
  tbody.innerHTML = `<tr><td colspan="10">جاري تحميل الترتيب...</td></tr>`;

  const snap = await getDoc(doc(db, "standings", leagueId));
  const table = snap.exists() ? snap.data().rows : [];
  if (!table.length) {
    tbody.innerHTML = `<tr><td colspan="10">لم يتم إضافة جدول الترتيب بعد من لوحة الإدارة</td></tr>`;
    return;
  }

  tbody.innerHTML = table.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-weight:700;">${r.team}</td>
      <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
      <td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga}</td>
      <td style="color:var(--primary-green); font-weight:800;">${r.points}</td>
    </tr>
  `).join("");
};

function matchCardHTML(m) {
  const statusClass = m.matchStatus === "مباشرة" ? "badge-live"
    : m.matchStatus === "انتهت" ? "badge-ended" : "badge-upcoming";
  const isFav = userFavorites.favoriteMatches?.includes(m.matchId);

  return `
    <div class="card match-card" onclick="openMatchDetail('${m.matchId}')">
      <div class="match-meta">
        <span>${m.leagueName || "بطولة"}</span>
        <span class="badge ${statusClass}">${m.matchStatus || "قريبًا"} ${m.minute ? m.minute + "'" : ""}</span>
      </div>
      <div class="match-teams">
        <div class="team-box">
          <img class="team-logo" src="${m.homeLogo || 'https://via.placeholder.com/40?text=H'}" alt="" />
          <span style="font-weight:700; font-size:0.9rem;">${m.homeTeam}</span>
        </div>
        <div class="score-box">
          <div class="score-text">${m.matchStatus === "لم تبدأ" ? (m.matchTime || "VS") : `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`}</div>
          <button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem; margin-top:4px;"
            onclick="event.stopPropagation(); toggleFavoriteMatch('${m.matchId}')">
            ${isFav ? "★ مفضلة" : "☆ تابع"}
          </button>
        </div>
        <div class="team-box">
          <img class="team-logo" src="${m.awayLogo || 'https://via.placeholder.com/40?text=A'}" alt="" />
          <span style="font-weight:700; font-size:0.9rem;">${m.awayTeam}</span>
        </div>
      </div>
    </div>
  `;
}

function renderHomeMatches() {
  const live = allMatches.filter(m => m.matchStatus === "مباشرة");
  const liveTicker = document.getElementById("liveTicker");
  liveTicker.innerHTML = live.length
    ? live.map(m => `
        <div class="live-chip" onclick="openMatchDetail('${m.matchId}')">
          <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">
            <span class="live-dot"></span> مباشر - ${m.leagueName}
          </div>
          <div style="display:flex; justify-content:space-between; font-weight:700;">
            <span>${m.homeTeam}</span>
            <span style="color:var(--primary-green)">${m.homeScore} - ${m.awayScore}</span>
            <span>${m.awayTeam}</span>
          </div>
        </div>`).join("")
    : `<div class="card" style="width:100%; text-align:center; color:var(--text-muted);">لا توجد مباريات مباشرة في هذه اللحظة</div>`;

  const todayHome = allMatches.slice(0, 8);
  document.getElementById("homeTodayMatches").innerHTML = todayHome.length
    ? todayHome.map(matchCardHTML).join("")
    : `<p style="color:var(--text-muted);">سيتم نشر المباريات تلقائيًا فور المزامنة مع جوجل.</p>`;
}

// تصفية جدول المباريات
function renderSchedule() {
  const selectedLeague = document.getElementById("leagueFilter").value;
  const pickedDate = document.getElementById("datePicker").value;
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split("T")[0];

  const filtered = allMatches.filter(m => {
    if (selectedLeague !== "all" && m.leagueId !== selectedLeague) return false;
    const mDate = (m.startTime || "").split("T")[0];
    if (pickedDate) return mDate === pickedDate;
    if (currentScheduleFilter === "live") return m.matchStatus === "مباشرة";
    if (currentScheduleFilter === "ended") return m.matchStatus === "انتهت";
    if (currentScheduleFilter === "tomorrow") return mDate === tomorrowStr;
    if (currentScheduleFilter === "yesterday") return mDate === yesterdayStr;
    return mDate === todayStr || m.matchStatus === "مباشرة";
  });

  document.getElementById("scheduleList").innerHTML = filtered.length
    ? filtered.map(matchCardHTML).join("")
    : `<div class="card">لا توجد مباريات مطابقة لهذا التصنيف</div>`;
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("datePicker").value = "";
    currentScheduleFilter = btn.dataset.filter;
    renderSchedule();
  };
});
document.getElementById("leagueFilter").onchange = renderSchedule;
document.getElementById("datePicker").onchange = renderSchedule;

// فتح صفحة تفاصيل ومشاهدة المباراة
window.openMatchDetail = async (matchId) => {
  const m = allMatches.find(x => x.matchId === matchId);
  if (!m) return;
  window.navigateTo("match-detail");

  document.getElementById("matchDetailHeader").innerHTML = `
    <div style="text-align:center;">
      <div style="color:var(--primary-green); font-weight:700; margin-bottom:10px;">${m.leagueName}</div>
      <div class="match-teams">
        <div class="team-box">
          <img class="team-logo" style="width:60px;height:60px;" src="${m.homeLogo || 'https://via.placeholder.com/60'}" />
          <h3>${m.homeTeam}</h3>
        </div>
        <div class="score-box">
          <div style="font-size:2.2rem; font-weight:800;">${m.homeScore ?? 0} - ${m.awayScore ?? 0}</div>
          <span class="badge badge-live">${m.matchStatus}</span>
        </div>
        <div class="team-box">
          <img class="team-logo" style="width:60px;height:60px;" src="${m.awayLogo || 'https://via.placeholder.com/60'}" />
          <h3>${m.awayTeam}</h3>
        </div>
      </div>
    </div>
  `;

  // الإحصائيات والأحداث
  const stats = m.stats || { possession: "52% - 48%", shots: "11 - 9", onTarget: "5 - 3", corners: "6 - 4", cards: "2 - 1" };
  document.getElementById("matchStatsBox").innerHTML = `
    <div style="display:grid; gap:10px; font-size:0.9rem;">
      <div style="display:flex; justify-content:space-between;"><span>الاستحواذ</span><strong>${stats.possession}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>التسديدات</span><strong>${stats.shots}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>على المرمى</span><strong>${stats.onTarget}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>الركنيات</span><strong>${stats.corners}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>البطاقات</span><strong>${stats.cards}</strong></div>
    </div>
  `;

  const events = m.events || [];
  document.getElementById("matchEventsBox").innerHTML = events.length
    ? events.map(ev => `<div style="padding:6px 0; border-bottom:1px solid var(--border-color);">${ev.minute}' - ${ev.type}: ${ev.player}</div>`).join("")
    : `<p style="color:var(--text-muted);">تُحدث الأحداث والتبديلات والبطاقات تلقائيًا أثناء سير اللقاء.</p>`;

  // التحقق من البث المرخص عبر Cloud Function
  const playerContainer = document.getElementById("playerContainer");
  const fallbackMsg = document.getElementById("streamFallbackMsg");
  playerContainer.classList.add("hidden");
  fallbackMsg.classList.remove("hidden");
  fallbackMsg.textContent = "جاري التحقق من حقوق البث الرسمية...";

  try {
    const getStream = httpsCallable(functions, "getAuthorizedStream");
    const res = await getStream({ matchId, countryCode: "EG" });
    if (res.data.available) {
      fallbackMsg.classList.add("hidden");
      playerContainer.classList.remove("hidden");
      initVideoPlayer(res.data);
    } else {
      fallbackMsg.innerHTML = `
        <p style="color:var(--gold); font-weight:700;">${res.data.reason}</p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:6px;">يمكنك متابعة النتيجة والإحصائيات المباشرة أعلاه، أو التوجه للناقل الرسمي.</p>
      `;
    }
  } catch (err) {
    fallbackMsg.textContent = "البث المرخص غير متوفر حاليًا — يمكنك متابعة الإحصائيات المباشرة.";
  }
};

// الأخبار
function renderNews() {
  const card = n => `
    <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
      <div>
        <img src="${n.image || 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600'}"
             style="width:100%; height:160px; object-fit:cover; border-radius:10px; margin-bottom:10px;" />
        <span class="badge badge-upcoming">${n.source || "أخبار"}</span>
        <h3 style="font-size:1rem; margin:8px 0;">${n.title}</h3>
        <p style="font-size:0.85rem; color:var(--text-muted);">${n.description || ""}</p>
      </div>
      ${n.externalUrl ? `<a href="${n.externalUrl}" target="_blank" class="btn btn-outline" style="margin-top:12px; justify-content:center;">اقرأ المصدر</a>` : ""}
    </div>
  `;
  document.getElementById("homeNews").innerHTML = allNews.slice(0, 6).map(card).join("");
  document.getElementById("allNewsGrid").innerHTML = allNews.map(card).join("");
}

// المفضلة
window.toggleFavoriteMatch = async (matchId) => {
  if (!currentUser) { document.getElementById("authModal").classList.add("open"); return; }
  const ref = doc(db, "favorites", currentUser.uid);
  const exists = userFavorites.favoriteMatches?.includes(matchId);
  await setDoc(ref, {
    userId: currentUser.uid,
    favoriteMatches: exists ? arrayRemove(matchId) : arrayUnion(matchId)
  }, { merge: true });

  const snap = await getDoc(ref);
  userFavorites = snap.data();
  renderHomeMatches();
  renderSchedule();
  renderFavoritesPage();
};

function renderFavoritesPage() {
  const box = document.getElementById("favoritesContent");
  if (!currentUser) {
    box.innerHTML = `<p>سجل الدخول لحفظ فرقك ومبارياتك المفضلة وتلقي إشعارات الأهداف فورًا.</p>`;
    return;
  }
  const favMatches = allMatches.filter(m => userFavorites.favoriteMatches?.includes(m.matchId));
  box.innerHTML = favMatches.length
    ? `<div class="grid-2">${favMatches.map(matchCardHTML).join("")}</div>`
    : `<p style="color:var(--text-muted);">لم تقم بإضافة أي مباريات للمفضلة بعد.</p>`;
}

// الإعلانات والرعاة (مخفية لمشتركي الباقة المميزة)
async function renderAds() {
  const topAd = document.getElementById("homeTopAd");
  const newsAd = document.getElementById("newsMidAd");

  if (userProfile.subscriptionTier === "premium") {
    topAd.classList.add("hidden");
    newsAd.classList.add("hidden");
    return;
  }
  topAd.classList.remove("hidden");
  newsAd.classList.remove("hidden");

  const snap = await getDocs(collection(db, "advertisements"));
  const activeAds = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.enabled);

  if (activeAds.length) {
    const ad = activeAds[0];
    const html = `
      <a href="${ad.destinationUrl}" target="_blank" style="text-decoration:none; color:#fff;">
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px;">إعلان راعي - ${ad.title}</div>
        <img src="${ad.image}" class="sponsor-img" alt="${ad.title}" />
      </a>
    `;
    topAd.innerHTML = html;
    newsAd.innerHTML = html;
    updateDoc(doc(db, "advertisements", ad.id), { impressions: increment(1) }).catch(() => {});
  } else {
    topAd.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">مساحة إعلانية (Google AdSense / رعاة)</span>`;
    newsAd.innerHTML = topAd.innerHTML;
  }
}

// باقات الاشتراك
async function renderPlans() {
  const snap = await getDocs(collection(db, "plans"));
  const plans = snap.empty ? [
    { id: "free", name: "الباقة المجانية", price: "0 ج.م", features: ["نتائج مباشرة", "جدول المباريات", "الأخبار والترتيب", "تحتوي إعلانات"] },
    { id: "gold", name: "الباقة الذهبية", price: "49 ج.م / شهر", features: ["تقليل الإعلانات", "تنبيهات مخصصة للأهداف", "إحصائيات موسعة"] },
    { id: "premium", name: "الباقة المميزة", price: "99 ج.م / شهر", features: ["بدون إعلانات نهائيًا", "بث حصري مرخص", "تحليلات متقدمة"] }
  ] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  document.getElementById("plansGrid").innerHTML = plans.map(p => `
    <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
      <div>
        <span class="badge badge-gold">${p.name}</span>
        <h2 style="margin:12px 0; color:var(--primary-green);">${p.price}</h2>
        <ul style="list-style:none; display:grid; gap:8px; margin-bottom:18px; color:var(--text-muted);">
          ${(p.features || []).map(f => `<li>✓ ${f}</li>`).join("")}
        </ul>
      </div>
      <button class="btn ${userProfile.subscriptionTier === p.id ? 'btn-outline' : 'btn-primary'}"
        onclick="alert('للتفعيل عبر بوابة الدفع الإلكتروني (Stripe/Paymob) وتحقق الخادم')">
        ${userProfile.subscriptionTier === p.id ? "باقتك الحالية" : "اشترك الآن"}
      </button>
    </div>
  `).join("");
}

loadLeagues();
