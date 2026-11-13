// public/js/admin.js
import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("يرجى تسجيل الدخول من التطبيق الرئيسي بحساب المشرف أولًا.");
    window.location.href = "index.html";
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.data()?.role !== "admin") {
    alert("هذا الحساب لا يملك صلاحيات الإدارة (role: admin).");
    window.location.href = "index.html";
    return;
  }
  loadDashboardData();
});

window.showAdminTab = (tabName, btn) => {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.add("hidden"));
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
  document.querySelectorAll(".tabs .tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
};

async function loadDashboardData() {
  const [mSnap, nSnap, uSnap] = await Promise.all([
    getDocs(collection(db, "matches")),
    getDocs(collection(db, "news")),
    getDocs(collection(db, "users"))
  ]);
  document.getElementById("kpiMatches").textContent = mSnap.size;
  document.getElementById("kpiNews").textContent = nSnap.size;
  document.getElementById("kpiUsers").textContent = uSnap.size;

  document.getElementById("adminMatchesList").innerHTML = mSnap.docs.map(d => {
    const m = d.data();
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-color);">
        <span><strong>${m.matchId}</strong> | ${m.homeTeam} (${m.homeScore}) - (${m.awayScore}) ${m.awayTeam} [${m.matchStatus}]</span>
        <button class="btn btn-outline" onclick="deleteMatch('${d.id}')">حذف</button>
      </div>`;
  }).join("");
}

window.deleteMatch = async (id) => {
  await deleteDoc(doc(db, "matches", id));
  loadDashboardData();
};

// زر المزامنة الفورية مع Google Sports & Google News
document.getElementById("syncGoogleBtn").onclick = async () => {
  const btn = document.getElementById("syncGoogleBtn");
  btn.disabled = true;
  btn.textContent = "جاري السحب من جوجل...";
  try {
    const syncFn = httpsCallable(functions, "manualSyncNow");
    const res = await syncFn();
    alert(`تمت المزامنة بنجاح! تم تحديث ${res.data.matchesCount} مباراة و ${res.data.newsCount} خبر.`);
    loadDashboardData();
  } catch (err) {
    alert("خطأ أثناء المزامنة: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 مزامنة جوجل الآن";
  }
};

document.getElementById("adminMatchForm").onsubmit = async (e) => {
  e.preventDefault();
  const id = `manual_${Date.now()}`;
  await setDoc(doc(db, "matches", id), {
    matchId: id,
    leagueName: document.getElementById("mLeague").value,
    homeTeam: document.getElementById("mHome").value,
    awayTeam: document.getElementById("mAway").value,
    homeScore: Number(document.getElementById("mHomeScore").value),
    awayScore: Number(document.getElementById("mAwayScore").value),
    matchStatus: document.getElementById("mStatus").value,
    startTime: new Date().toISOString()
  });
  e.target.reset();
  loadDashboardData();
};

document.getElementById("adminStreamForm").onsubmit = async (e) => {
  e.preventDefault();
  const id = `stream_${Date.now()}`;
  await setDoc(doc(db, "streamSources", id), {
    sourceId: id,
    matchId: document.getElementById("sMatchId").value.trim(),
    streamUrl: document.getElementById("sUrl").value.trim(),
    streamType: document.getElementById("sType").value,
    allowedRegions: document.getElementById("sRegions").value.split(",").map(s => s.trim()),
    expiryDate: document.getElementById("sExpiry").value,
    requiresPremium: document.getElementById("sPremium").checked,
    enabled: true
  });
  alert("تم إضافة مصدر البث المرخص بأمان");
  e.target.reset();
};

document.getElementById("adminNewsForm").onsubmit = async (e) => {
  e.preventDefault();
  const id = `news_${Date.now()}`;
  await setDoc(doc(db, "news", id), {
    newsId: id,
    title: document.getElementById("nTitle").value,
    description: document.getElementById("nDesc").value,
    image: document.getElementById("nImage").value,
    source: document.getElementById("nSource").value || "KORA LIVE",
    publishedAt: new Date().toISOString()
  });
  alert("تم نشر الخبر");
  e.target.reset();
  loadDashboardData();
};

document.getElementById("adminAdForm").onsubmit = async (e) => {
  e.preventDefault();
  const id = `ad_${Date.now()}`;
  await setDoc(doc(db, "advertisements", id), {
    advertisementId: id,
    title: document.getElementById("aTitle").value,
    image: document.getElementById("aImage").value,
    destinationUrl: document.getElementById("aUrl").value,
    impressions: 0,
    enabled: true
  });
  alert("تم تفعيل إعلان الراعي");
  e.target.reset();
};

document.getElementById("adminPushForm").onsubmit = async (e) => {
  e.preventDefault();
  const sendPush = httpsCallable(functions, "sendAdminPush");
  await sendPush({
    title: document.getElementById("pTitle").value,
    body: document.getElementById("pBody").value,
    topic: document.getElementById("pTopic").value
  });
  alert("تم إرسال الإشعار");
  e.target.reset();
};
