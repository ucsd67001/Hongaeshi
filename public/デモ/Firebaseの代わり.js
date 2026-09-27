/* ============================================================
   デモ用 ― Firebase の代わり（ブラウザの中だけで動く）

   ⚠️⚠️ **本体の画面（app.js）とデータの部分（共通.js）は、そのまま動かす**（2026-09-27 決定 A）。
      demo.html の import map で、共通.js が読み込む Firebase（gstatic の5つ）をこのファイルに付け替える。
      だから、本体を直せばデモも同じ画面になる。デモのために本体を別に書かないこと。
   ⚠️ ここで作るのは、共通.js が使う分だけ：
        app       initializeApp
        auth      getAuth / GoogleAuthProvider / signInWithPopup / signOut / onAuthStateChanged
        firestore getFirestore / doc / getDoc / setDoc / updateDoc / deleteDoc / collection / query /
                  where / orderBy / limit / getDocs / writeBatch / serverTimestamp /
                  getAggregateFromServer / sum / count
        storage   getStorage / ref / uploadBytes / getDownloadURL
        functions getFunctions / httpsCallable
      **共通.js で新しい Firebase の関数を使ったら、ここにも足す**（足さないとデモが読み込みで止まる）。
   ⚠️ データは架空（ダミーデータ.js）。見ている人の操作は、その人のブラウザ（localStorage）にだけ残る。
      ルール（firestore.rules）は効かない。お金の計算は共通.js がするので、本体と同じになる。
   ============================================================ */

import { 種を作る } from "./ダミーデータ.js";

/* ── 時刻（Firestore の Timestamp の代わり） ── */
class 時刻 {
  constructor(ms){ this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis(){ return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate(){ return new Date(this.toMillis()); }
}
const 今の時刻の印 = { __今: true };

/* ── 置き場（localStorage。読めなければメモリだけ） ── */
const 鍵 = "本返しデモ_v2";
let 箱 = null;
const 写す = v => v instanceof 時刻 ? new 時刻(v.toMillis())
  : Array.isArray(v) ? v.map(写す)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x])=>[k, 写す(x)]))
  : v;
const 文字にする = v => JSON.stringify(v, (k, x)=>x && typeof x === "object" && typeof x.seconds === "number" && typeof x.toMillis === "function"
  ? { __時: x.toMillis() } : x);
const 戻す = s => JSON.parse(s, (k, x)=>x && typeof x === "object" && "__時" in x ? new 時刻(x.__時) : x);

function 箱を開く(){
  if(箱) return 箱;
  try{ const s = localStorage.getItem(鍵); if(s) 箱 = 戻す(s); }catch(e){}
  if(!箱){ 箱 = { 集: 種を作る(ms=>new 時刻(ms)), 入った人: null }; しまう(); }
  return 箱;
}
function しまう(){ try{ localStorage.setItem(鍵, 文字にする(箱)); }catch(e){} }
export function デモをはじめからにする(){ try{ localStorage.removeItem(鍵); }catch(e){} 箱 = null; }
window.デモをはじめからにする = ()=>{ デモをはじめからにする(); location.href = "/demo"; };

const 集 = 名 => (箱を開く().集[名] ||= {});
let 番号 = 0;
const 新しいid = ()=> "d" + Date.now().toString(36) + (番号++).toString(36) + Math.random().toString(36).slice(2, 6);

/* ── app ── */
export const initializeApp = 設定 => ({ 名: "デモ" });

/* ── auth ── */
const デモの読者 = { uid: "demo-me", displayName: "デモの読者", email: "demo@example.com", photoURL: null };
const 聞き手 = new Set();
const いまの人 = ()=> 箱を開く().入った人 ? { ...デモの読者 } : null;
const 知らせる = ()=> { const u = いまの人(); 聞き手.forEach(f=>f(u)); };
export const getAuth = app => ({ get currentUser(){ return いまの人(); } });
export class GoogleAuthProvider { setCustomParameters(){} }
export async function signInWithPopup(){
  箱を開く().入った人 = true; しまう(); setTimeout(知らせる, 0);
  return { user: いまの人() };
}
export async function signOut(){ 箱を開く().入った人 = null; しまう(); setTimeout(知らせる, 0); }
export function onAuthStateChanged(auth, f){
  聞き手.add(f); setTimeout(()=>f(いまの人()), 0);
  return ()=>聞き手.delete(f);
}

/* ── firestore ── */
export const getFirestore = app => ({ 名: "デモ" });
export const collection = (db, 名) => ({ 種: "集", 名 });
export function doc(a, 名, id){
  if(a && a.種 === "集") return { 種: "紙", 名: a.名, id: 名 ?? 新しいid() };
  return { 種: "紙", 名, id };
}
export const where   = (項, 比べ, 値) => ({ 種: "where", 項, 比べ, 値 });
export const orderBy = (項, 向き = "asc") => ({ 種: "orderBy", 項, 向き });
export const limit   = n => ({ 種: "limit", n });
export const query   = (元, ...条件) => ({ 種: "問い", 名: 元.名, 条件: [...(元.条件 || []), ...条件] });
export const serverTimestamp = () => 今の時刻の印;
export const count = () => ({ 種: "count" });
export const sum   = 項 => ({ 種: "sum", 項 });

const 値にする = v => v instanceof 時刻 ? v.toMillis() : v;
const 埋める = d => Object.fromEntries(Object.entries(d).map(([k, v])=>[k, v === 今の時刻の印 ? new 時刻(Date.now()) : v]));
const 写し = (名, id, d) => ({ id, ref: { 種: "紙", 名, id }, exists: ()=>d !== undefined, data: ()=>d === undefined ? undefined : 写す(d) });

function 合うか(d, c){
  const v = d[c.項];
  switch(c.比べ){
    case "==": return 値にする(v) === 値にする(c.値);
    case "!=": return 値にする(v) !== 値にする(c.値);
    case ">=": return 値にする(v) >= 値にする(c.値);
    case ">":  return 値にする(v) >  値にする(c.値);
    case "<=": return 値にする(v) <= 値にする(c.値);
    case "<":  return 値にする(v) <  値にする(c.値);
    case "in": return (c.値 || []).includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(c.値);
    default: throw new Error("デモ：この比べ方はまだありません " + c.比べ);
  }
}
function 引く(q){
  const 条件 = q.条件 || [];
  let 行 = Object.entries(集(q.名)).map(([id, d])=>({ id, d }));
  for(const c of 条件.filter(c=>c.種 === "where")) 行 = 行.filter(r=>合うか(r.d, c));
  const 並べ = 条件.filter(c=>c.種 === "orderBy");
  /* ⚠️ Firestore と同じく、並べる項目の無い文書は結果に入れない */
  for(const o of 並べ) 行 = 行.filter(r=>r.d[o.項] !== undefined && r.d[o.項] !== null);
  if(並べ.length) 行.sort((a, b)=>{
    for(const o of 並べ){
      const x = 値にする(a.d[o.項]), y = 値にする(b.d[o.項]);
      if(x < y) return o.向き === "desc" ? 1 : -1;
      if(x > y) return o.向き === "desc" ? -1 : 1;
    }
    return 0;
  });
  const 上限 = 条件.find(c=>c.種 === "limit");
  if(上限) 行 = 行.slice(0, 上限.n);
  return 行;
}

export async function getDoc(r){ return 写し(r.名, r.id, 集(r.名)[r.id]); }
export async function getDocs(q){
  const docs = 引く(q).map(r=>写し(q.名, r.id, r.d));
  return { docs, size: docs.length, empty: !docs.length, forEach: f=>docs.forEach(f) };
}
/* ⚠️ 先に serverTimestamp() の印を時刻に置き換えてから写す。写してからだと印が別の物になり、
      見分けられずに時刻が入らない（2026-09-27、ことばが「たった今」なのに一番下に並んで気づいた） */
function 置く(r, d, 足す){
  const 今 = 集(r.名)[r.id];
  集(r.名)[r.id] = 足す && 今 ? { ...今, ...写す(埋める(d)) } : 写す(埋める(d));
}
function 直す(r, d){
  if(!集(r.名)[r.id]) throw Object.assign(new Error("デモ：直す文書がありません"), { code: "not-found" });
  集(r.名)[r.id] = { ...集(r.名)[r.id], ...写す(埋める(d)) };
}
export async function setDoc(r, d, 選び){ 置く(r, d, 選び?.merge); しまう(); }
export async function updateDoc(r, d){ 直す(r, d); しまう(); }
export async function deleteDoc(r){ delete 集(r.名)[r.id]; しまう(); }
export function writeBatch(){
  const 手順 = [];
  return {
    set(r, d, 選び){ 手順.push(()=>置く(r, d, 選び?.merge)); return this; },
    update(r, d){ 手順.push(()=>直す(r, d)); return this; },
    delete(r){ 手順.push(()=>{ delete 集(r.名)[r.id]; }); return this; },
    async commit(){ 手順.forEach(f=>f()); しまう(); }
  };
}
export async function getAggregateFromServer(q, 何を){
  const 行 = 引く(q.種 === "集" ? { 名: q.名, 条件: [] } : q);
  const 答え = Object.fromEntries(Object.entries(何を).map(([k, a])=>[k,
    a.種 === "count" ? 行.length : 行.reduce((s, r)=>s + (Number(r.d[a.項]) || 0), 0)]));
  return { data: ()=>答え };
}

/* ── storage（画像は上げられない） ── */
export const getStorage = app => ({});
export const ref = (倉, 道) => ({ 道 });
export async function uploadBytes(){ throw Object.assign(new Error("デモでは画像を上げられません。字と色のしるしで試してください"), { code: "デモ" }); }
export async function getDownloadURL(){ return ""; }

/* ── functions（いまの気分で選ぶ：AI は使わず、棚から見本を選ぶ） ── */
export const getFunctions = () => ({});
export function httpsCallable(fns, 名){
  if(名 !== "recommendBooks") return async ()=>{ throw new Error("デモ：" + 名 + " はありません"); };
  return async ({ mood })=>{
    const 触れた = new Set([
      ...Object.values(集("returns")).filter(x=>x.from === "demo-me").map(x=>x.book),
      ...Object.values(集("voices")).filter(x=>x.from === "demo-me").map(x=>x.book),
      ...Object.values(集("keeps")).filter(x=>x.from === "demo-me").map(x=>x.book)]);
    let 候補 = Object.entries(集("books")).filter(([id])=>!触れた.has(id));
    if(候補.length < 3) 候補 = Object.entries(集("books"));
    /* 気分の文字から、決まった3冊を選ぶ（同じ気分なら同じ答え。違う気分なら、たいてい違う答え） */
    let h = 0; for(const c of String(mood)) h = (h * 31 + c.codePointAt(0)) >>> 0;
    候補.sort((a, b)=>a[0].localeCompare(b[0]));
    /* ⚠️ 歩幅は冊数と割り切れない素数にする（割り切れると同じ本ばかり当たって終わらない） */
    const 歩幅 = [7, 5, 3, 1].find(s=>s === 1 || 候補.length % s !== 0);
    const 選ぶ = [];
    for(let i = 0; 選ぶ.length < Math.min(3, 候補.length); i++){
      const x = 候補[(h + i * 歩幅) % 候補.length];
      if(!選ぶ.includes(x)) 選ぶ.push(x);
    }
    await new Promise(r=>setTimeout(r, 900));
    return { data: {
      note: "デモなので AI は使わず、棚から見本を選んでいます。",
      picks: 選ぶ.map(([id, b])=>({ isbn: id,
        reason: `（デモの理由）${String(b.intro?.text || "").slice(0, 70)}…　本番では、書いた気分とあなたの本返し、本の紹介、ほかの読者の感想から、AI が理由を書きます。` }))
    } };
  };
}
