/* ============================================================
   本返し ― 土台（Firebase・財布・集計）

   ⚠️ **架空のお金（本返しポイント）で動くトライアル。**
      実際の決済はどこにも無い。1pt＝1円のつもりで読めばよい。

   ⚠️⚠️ **Firestore の中だけ、名前が ASCII。**
      セキュリティルールの言語が識別子に日本語を受け付けないため
      （日本語で書くと token recognition error でデプロイが落ちる）。
      画面もこのファイルの外もぜんぶ日本語のままで、
      **読み書きの境目にあたるこのファイルだけが両方の名前を知っている。**

        財布 → wallets   { balance, granted, created }
        返し → returns   { book, from, name, anon, amount, parts, toIds, text, at }
        残し → keeps     { book, from, name, pledge, text, at }

      Firestore から読んだものは、この中で必ず日本語のかたちに直してから返す。
      外へ ASCII のままの object を漏らさないこと。

   ⚠️ Firebase の設定値は、このファイルに書かない。
      Firebase Hosting が `/__/firebase/init.json` を自動で配るので、そこから読む。
      **ローカルで開くときは `firebase serve` を使うこと。**
      `file://` で直接開くと、この読み込みに失敗する（demo.html のほうは開ける）。
   ============================================================ */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, limit, getDocs, writeBatch, serverTimestamp,
  getAggregateFromServer, sum, count
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ⚠️ 管理画面（管理.js）が Firestore を直に触るので、ここから渡す。
      SDK を二重に読み込むと別インスタンスになって認証が効かない。 */
export const Firestore = {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, limit, getDocs, writeBatch, serverTimestamp
};

/* ── きまり ───────────────────────────────── */
export const 決済率 = 0.05;      // 決済手数料（本番でかかる想定ぶん）
export const 運営率 = 0.05;      // 本返しの運営ぶん
export const 既定額 = 100;       // 金額のはじめの値
export const 初回配布 = 10000;   // 登録したときに配るポイント
export const 毎月配布 = 3000;    // 毎月配るポイント

export let app, auth, db;
export let 私 = null;            // ログイン中の人（firebase の User）
export let 財布 = null;          // { 残高, 配布済み }
export let 蔵書 = [];            // books コレクションの中身（画面の姿に直したもの）
export let 主体表 = new Map();   // entities。id → { 型, 名, 認証 }

/* ============================================================
   権限は3段

     ① 管理者   admins に自分の uid があるひと。いまは運営者だけ
     ② 受取人   自分が引き継いだ（claimedBy が自分の）主体を持つひと
     ③ 利用者   入っているだけのひと。ふつうの読者

   ⚠️ **②のために新しいコレクションを作らない。**
      entities に claimed / claimedBy があるので、それで表せる。
      「誰が受取人か」と「何の受取人か」を1か所で持てるほうが、
      あとで本人確認を足すときに割れない。
   ⚠️ いまは誰も引き継いでいないので、②は実質ゼロ。
      受取人の控えは①だけが見られる。
   ============================================================ */
export let 権限 = { 管理者:false, 受取人:[] };

export async function 権限をしらべる(){
  if(!私){ 権限 = { 管理者:false, 受取人:[] }; return 権限; }
  const [a, e] = await Promise.all([
    getDoc(doc(db, "admins", 私.uid)).catch(()=>null),
    getDocs(query(collection(db, "entities"), where("claimedBy", "==", 私.uid))).catch(()=>null)
  ]);
  権限 = { 管理者: !!(a && a.exists()), 受取人: e ? e.docs.map(d=>d.id) : [] };
  return 権限;
}

/* ============================================================
   立ち上げ
   ============================================================ */
export async function 起動(認証が変わったら){
  const 設定 = await fetch("/__/firebase/init.json").then(r=>{
    if(!r.ok) throw new Error("init.json が読めません");
    return r.json();
  });

  app  = initializeApp(設定);
  auth = getAuth(app);
  db   = getFirestore(app);

  /* ⚠️ 本と主体は**ログインを待たずに**読む。ルールで公開してあるので取れる。
        入る前の画面にも棚を出したいため。 */
  const 棚 = 蔵書をよみこむ().catch(e=>{ console.error(e); });

  onAuthStateChanged(auth, async user=>{
    私 = user;
    try{
      await 棚;
      財布 = user ? await 財布をそろえる(user.uid) : null;
    }catch(e){
      console.error(e); 財布 = null;
      知らせる("財布を用意できませんでした：" + (e.code||e.message), true);
    }
    認証が変わったら();
  });
}

/* ============================================================
   本と主体を読む

   ⚠️ 本は books、著者と出版社は entities。**両方とも読み取りに認証が要る。**
   ⚠️ 受取人は本ごとではなく**主体ごとに1つ**。だから同じ出版社が
      何冊に出てきても、受取はそこに集まる。
   ⚠️ トライアル中は、まだ引き継がれていない主体（claimed=false）にも
      本返しできる。架空のポイントなので実害がなく、これを止めると
      「どの本に使うか」という肝心のふるまいが観察できなくなるため。
      **本物のお金にするときは、ここを閉じること。**
   ============================================================ */
export const 種の名 = { author:"著者・権利者", publisher:"出版社", store:"書店" };

/* 書影が無い本のための色。題から決めるので、いつも同じ色になる。
   ⚠️ **必ず16進で返すこと。**画面側で `${色}cc` と足して薄い側を作っているので、
      hsl() を返すと `hsl(...)cc` という無効なCSSになり、
      グラデーションごと効かなくなって**表紙が白く抜ける**（2026-09-23にやった）。 */
function 題から色(題){
  let h = 0;
  for(const c of (題 || "")) h = (h * 31 + c.codePointAt(0)) % 360;
  return hslを16進に(h, 0.34, 0.36);
}
function hslを16進に(h, s, l){
  const f = n => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export async function 蔵書をよみこむ(){
  const [本ら, 主体ら] = await Promise.all([
    getDocs(query(collection(db, "books"), orderBy("year", "desc"))),
    getDocs(collection(db, "entities"))
  ]);

  主体表 = new Map(主体ら.docs.map(d=>{
    const x = d.data();
    return [d.id, { id:d.id, 型:x.type, 名:x.name, 認証:!!x.claimed }];
  }));

  蔵書 = 本ら.docs.map(d=>{
    const x = d.data();
    return {
      id: d.id, isbn: x.isbn,
      題: x.title, 副題: x.subtitle || null,
      著: x.authorText || "", 版元: x.publisherText || "",
      年: x.year || null, 刊行日: x.pubDate || null,
      頁: x.pages || null,
      /* ⚠️ 表紙の優先順位：手で入れたもの → Amazon（リンクのある本だけ）→
            Google（実在を確かめたもの）→ 色の背表紙。
            Amazon を Google より上にしているのは、
            日本の本では Google にほとんど表紙が無いため（15冊中1冊）。 */
      書影: x.coverManual
            || Amazonの表紙((x.amazonLinks && x.amazonLinks[0]?.url) || x.amazonUrl)
            || x.cover || null,
      控えの書影: x.cover || null,
      /* ⚠️ **1冊に複数のリンクを持てる。**作品は1つでも、Amazonでは
            版や巻で分かれていることがある（『二十歳のころ』は文庫で上下2巻）。
            単数の amazonUrl は古い形。読むときだけ面倒を見る。 */
      Amazonら: (x.amazonLinks && x.amazonLinks.length ? x.amazonLinks
                 : x.amazonUrl ? [{ label:"", url:x.amazonUrl }] : []),
      登録日: x.addedAt || null,
      状態: x.status || "流通",
      色: 題から色(x.title),
      受取: (x.to || []).map(id=>{
        const e = 主体表.get(id);
        return e ? { id, 種:種の名[e.型] || e.型, 名:e.名, 認証:e.認証 }
                 : { id, 種:"不明", 名:id, 認証:false };
      })
    };
  });
  return 蔵書;
}

export function 入る(){
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt:"select_account" });
  return signInWithPopup(auth, p).catch(e=>{
    if(e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request")
      知らせる("ログインできませんでした：" + e.code, true);
  });
}
export function 出る(){ return signOut(auth); }

/* ============================================================
   財布

   ⚠️ 月のキーは **UTC で作る。** firestore.rules の thisMonth() が
      request.time（UTC）から作っているので、そちらに揃えないと
      月初の数時間だけ食い違って配布が弾かれる。
      日本時間では「毎月1日の午前9時に配られる」ことになる。
   ============================================================ */
export const 今月 = () => new Date().toISOString().slice(0,7);   // "2026-09"

async function 財布をそろえる(uid){
  const 道 = doc(db, "wallets", uid);
  const 今 = await getDoc(道);

  if(!今.exists()){
    await setDoc(道, { balance: 初回配布, granted: [今月()], created: serverTimestamp() });
    知らせる(`ようこそ。${初回配布.toLocaleString()}pt をお配りしました`);
    return { 残高: 初回配布, 配布済み: [今月()] };
  }

  const d = 今.data();
  // まだ今月ぶんを受け取っていなければ、ここで配る
  if(!(d.granted || []).includes(今月())){
    const 新残高 = d.balance + 毎月配布;
    const 新配布 = [...(d.granted||[]), 今月()];
    await updateDoc(道, { balance: 新残高, granted: 新配布 });
    知らせる(`今月ぶんの ${毎月配布.toLocaleString()}pt をお配りしました`);
    return { 残高: 新残高, 配布済み: 新配布 };
  }
  return { 残高: d.balance, 配布済み: d.granted || [] };
}

export async function 財布を読み直す(){
  if(!私) return null;
  const 今 = await getDoc(doc(db, "wallets", 私.uid));
  財布 = 今.exists() ? { 残高: 今.data().balance, 配布済み: 今.data().granted||[] } : null;
  return 財布;
}

/* ============================================================
   本返しする

   ⚠️ **財布の更新と、返しの作成を、必ず1つの writeBatch で送る。**
      firestore.rules が getAfter() で「財布がちょうど額のぶん減ったか」を
      見ているので、別々に送ると必ず弾かれる。
   ⚠️ 残高は increment ではなく、計算した値をそのまま書く。
      手元の残高が古ければルールに弾かれるので、二重払いにならない。
   ============================================================ */
export async function 本返しする({ 本id, 額, 内訳, 文, 匿 }){
  if(!私) throw new Error("ログインしていません");
  if(!財布) await 財布を読み直す();
  if(額 > 財布.残高) throw new Error("残高が足りません");

  const parts = 内訳.map(x=>({ to:x.受取人, name:x.名, amount:x.額 }));

  const 束 = writeBatch(db);
  束.update(doc(db,"wallets",私.uid), { balance: 財布.残高 - 額 });
  束.set(doc(collection(db,"returns")), {
    book: 本id,
    from: 私.uid,
    name: (私.displayName || "読者").slice(0,40),
    anon: !!匿,
    amount: 額,
    parts,
    toIds: parts.map(x=>x.to),          // array-contains で引くための控え
    text: (文||"").slice(0,400),
    at: serverTimestamp()
  });

  try{
    await 束.commit();
  }catch(e){
    await 財布を読み直す();              // 古い残高で弾かれた場合にそなえて
    throw e;
  }
  財布.残高 -= 額;
  return true;
}

/* ============================================================
   残したい（お金は1ptも動かない）
   ============================================================ */
export async function 残したい({ 本id, 約, 文 }){
  if(!私) throw new Error("ログインしていません");
  await setDoc(doc(collection(db,"keeps")), {
    book: 本id,
    from: 私.uid,
    name: (私.displayName || "読者").slice(0,40),
    pledge: 約,
    text: (文||"").slice(0,400),
    at: serverTimestamp()
  });
  return true;
}

/* ============================================================
   登録の申請

   ⚠️ **利用者の入力はそのまま受ける。**照合はあとで回す。
      国会図書館サーチは1回20秒かかるうえ不安定なので、
      ここで待たせると出す気が失せる。
      管理者が 04_tools/まとめてさがす.mjs で照合して登録する。
   ⚠️ ISBN のときだけ openBD で即座に確かめられる（57ms）。
      これは待たせても気にならない速さなので、入力補助として使う。
   ============================================================ */
export async function 登録を申請する({ 題, 著, 版元, isbn, 覚書 }){
  if(!私) throw new Error("ログインしていません");
  await setDoc(doc(collection(db, "requests")), {
    from: 私.uid,
    name: (私.displayName || "読者").slice(0,40),
    title: (題 || "").slice(0,200),
    author: (著 || "").slice(0,100),
    publisher: (版元 || "").slice(0,100),
    isbn: (isbn || "").replace(/[^0-9Xx]/g, "").slice(0,13),
    memo: (覚書 || "").slice(0,300),
    at: serverTimestamp()
  });
  return true;
}

/* ISBN から書誌を引く。見つからなければ null（入力の補助なので、失敗しても止めない） */
export async function ISBNで確かめる(isbn){
  const d = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if(d.length < 10) return null;
  try{
    const [x] = await fetch(`https://api.openbd.jp/v1/get?isbn=${d}`).then(r=>r.json());
    if(!x?.summary?.title) return null;
    const v = x.summary;
    return { 題:v.title, 著:v.author, 版元:v.publisher, 年:(v.pubdate||"").slice(0,4), isbn:v.isbn||d };
  }catch(e){ return null; }
}

/* ============================================================
   Firestore の姿 → 画面の姿
   ============================================================ */
const 返しを直す = x => ({
  種:"返し", 本:x.book, 表示名:x.name, 匿:!!x.anon,
  額:x.amount||0, 内訳:(x.parts||[]).map(p=>({受取人:p.to, 名:p.name, 額:p.amount})),
  文:x.text||"", 時:x.at
});
const 残しを直す = x => ({
  種:"残し", 本:x.book, 表示名:x.name, 匿:false,
  約:x.pledge||0, 文:x.text||"", 時:x.at
});

/* ============================================================
   数え上げ

   ⚠️ カウンタの書き込みを持たない。必要なときに集計クエリで数える。
      件数が増えたら、ここだけを集計ドキュメントに置き換えればよい。
   ============================================================ */
export async function 本の集計(本id){
  const [返, 残] = await Promise.all([
    getAggregateFromServer(
      query(collection(db,"returns"), where("book","==",本id)),
      { 人数: count(), 総額: sum("amount") }),
    getAggregateFromServer(
      query(collection(db,"keeps"), where("book","==",本id)),
      { 人数: count(), 総約: sum("pledge") })
  ]);
  return {
    人数: 返.data().人数, 金額: 返.data().総額 || 0,
    残数: 残.data().人数, 約額: 残.data().総約 || 0
  };
}

export async function 全体の集計(){
  const [返, 残] = await Promise.all([
    getAggregateFromServer(collection(db,"returns"), { 人数: count(), 総額: sum("amount") }),
    getAggregateFromServer(collection(db,"keeps"), { 人数: count() })
  ]);
  return { 人数: 返.data().人数, 金額: 返.data().総額 || 0, 残数: 残.data().人数 };
}

/* まとめて数える ― 本ごと・主体ごと・人ごとを、**一度の読み込みで**出す。

   ⚠️ 本ごとに集計クエリを投げると往復が増えて遅い。まとめて2回読んで、
      手元で振り分ける。トライアルの件数（数百件）ならこちらのほうが速いし安い。
   ⚠️ **主体ごとと人ごとも、同じ読み込みから出せる。**
      番付のために別のクエリを足さないこと。

   ⚠️ 人ごとの表示名は、**匿名で送った分を使わない。**
      匿名でしか送っていない人は「匿名」のまま並ぶ。
      金額はどちらも数える（本のページでは既に公開されている情報なので）。 */
export async function まとめて数える(){
  const [返, 残] = await Promise.all([
    getDocs(query(collection(db,"returns"), orderBy("at","desc"), limit(500))),
    getDocs(query(collection(db,"keeps"), orderBy("at","desc"), limit(500)))
  ]);

  const 本 = {}, 主体 = {}, 人 = {};
  const 本欄   = id => (本[id]   ||= { 人数:0, 金額:0, 残数:0, 約額:0 });
  const 主体欄 = id => (主体[id] ||= { id, 件数:0, 金額:0 });
  const 人欄   = id => (人[id]   ||= { id, 名:null, 件数:0, 金額:0 });

  返.docs.forEach(d=>{
    const x = d.data();
    const b = 本欄(x.book); b.人数++; b.金額 += x.amount || 0;

    /* 受取人に渡るのは9割。受取人の控えと同じ数え方にそろえる */
    (x.parts || []).forEach(p=>{
      const e = 主体欄(p.to); e.件数++; e.金額 += Math.round((p.amount||0) * 0.9);
    });

    if(x.from){
      const u = 人欄(x.from); u.件数++; u.金額 += x.amount || 0;
      if(!x.anon && x.name) u.名 = x.name;       // ⚠️ 匿名の分は名前に使わない
    }
  });
  残.docs.forEach(d=>{ const x=d.data(); const b=本欄(x.book); b.残数++; b.約額 += x.pledge||0; });

  return { 本, 主体, 人: Object.values(人) };
}

/* 番付。上位を何件か返すだけ。数えるのは上でやってある */
export function 番付(数えたもの, 件数 = 3){
  const 主体ら = Object.values(数えたもの.主体)
    .map(e=>({ ...e, 主体: 主体表.get(e.id) }))
    .filter(e=>e.主体);
  const 上位 = (ら, 型) => ら.filter(e=>!型 || e.主体.型 === 型)
    .sort((a,b)=>b.金額 - a.金額).slice(0, 件数);

  return {
    本: Object.entries(数えたもの.本)
      .map(([id, v])=>({ id, ...v, 本: 本を引く(id) }))
      .filter(x=>x.本 && x.金額 > 0)
      .sort((a,b)=>b.金額 - a.金額).slice(0, 件数),
    著者:   上位(主体ら, "author"),
    出版社: 上位(主体ら, "publisher"),
    書店:   上位(主体ら, "store"),
    人: 数えたもの.人.filter(u=>u.金額 > 0)
      .sort((a,b)=>b.金額 - a.金額).slice(0, 件数)
  };
}

export async function 本の声(本id, 件数=40){
  const [返, 残] = await Promise.all([
    getDocs(query(collection(db,"returns"), where("book","==",本id), orderBy("at","desc"), limit(件数))),
    getDocs(query(collection(db,"keeps"),   where("book","==",本id), orderBy("at","desc"), limit(件数)))
  ]);
  return [...返.docs.map(d=>返しを直す(d.data())),
          ...残.docs.map(d=>残しを直す(d.data()))]
    .filter(x=>x.文)
    .sort((a,b)=>(b.時?.seconds||0)-(a.時?.seconds||0));
}

export async function 最近の声(件数=6){
  const 返 = await getDocs(query(collection(db,"returns"), orderBy("at","desc"), limit(件数)));
  return 返.docs.map(d=>返しを直す(d.data())).filter(x=>x.文);
}

export async function 私の記録(){
  if(!私) return [];
  const [返, 残] = await Promise.all([
    getDocs(query(collection(db,"returns"), where("from","==",私.uid), orderBy("at","desc"), limit(100))),
    getDocs(query(collection(db,"keeps"),   where("from","==",私.uid), orderBy("at","desc"), limit(100)))
  ]);
  return [...返.docs.map(d=>返しを直す(d.data())),
          ...残.docs.map(d=>残しを直す(d.data()))]
    .sort((a,b)=>(b.時?.seconds||0)-(a.時?.seconds||0));
}

/* 受取人が受け取ったぶん。
   ⚠️ parts は配列の中なので、集計クエリでは足せない。
      array-contains で引いてから手元で足す。トライアルの件数なら十分。 */
export async function 受取人の受取(受取id){
  const 返 = await getDocs(query(collection(db,"returns"),
    where("toIds","array-contains",受取id), orderBy("at","desc"), limit(200)));
  const 明細 = 返.docs.map(d=>{
    const x = d.data();
    const 行 = (x.parts||[]).find(p=>p.to===受取id);
    return { 本:x.book, 名:x.anon?"匿名":x.name, 額:Math.round((行?.amount||0)*0.9), 文:x.text||"", 時:x.at };
  }).filter(x=>x.額>0);
  return { 明細, 合計: 明細.reduce((s,x)=>s+x.額,0) };
}

/* ============================================================
   小道具
   ============================================================ */
export const 本を引く = id => 蔵書.find(b=>b.id===id);
/* ⚠️ 前は「認証済の受取人だけ」を返していたが、トライアル中は
      まだ引き継がれていない主体にも本返しできるようにしたので、**全部返す。**
      claimed かどうかは r.認証 で画面に出すだけ。
      **本物のお金にするときは、ここで claimed を絞ること。** */
export const 届け先 = b => (b.受取 || []);
export const pt = n => Math.round(n).toLocaleString("ja-JP") + "pt";

/* ============================================================
   ISBN-13 → ISBN-10（＝AmazonのASIN）

   ⚠️ 本のASINは、ふつうISBN-10と同じ。だから機械的に作れる。
      978 で始まるものだけ。979 始まり（新しい出版社コード）は
      対応するISBN-10が無いので作れない。
   ⚠️ **リンクを自動では付けない。**全ページにAmazonが並ぶのは、
      独立系書店を応援するサービスとして望ましくない。
      管理画面で「これは売れそう」と選んだ本にだけ付ける。
   ============================================================ */
export function ISBN10にする(isbn13){
  const d = String(isbn13 || "").replace(/[^0-9]/g, "");
  if(d.length !== 13 || !d.startsWith("978")) return null;
  const 体 = d.slice(3, 12);
  let 和 = 0;
  for(let i = 0; i < 9; i++) 和 += Number(体[i]) * (10 - i);
  const 余 = 11 - (和 % 11);
  return 体 + (余 === 11 ? "0" : 余 === 10 ? "X" : String(余));
}

/* ============================================================
   ISBN-10 → ISBN-13

   ⚠️ **紙の本の ASIN は、たいてい ISBN-10 と同じ。**
      だから Amazon のリンクだけで書誌が引ける（実際に
      /dp/4061457225 →『「知」のソフトウェア』を確認した）。
   ⚠️ ただし **Kindle版などの ASIN は B0… で始まり、ISBN ではない。**
      その場合は変換できないので、紙の本のリンクをもらうしかない。
   ⚠️ 短縮リンク（link.amazon/… や amzn.to/…）は**ブラウザからは辿れない**
      （CORSで弾かれる）。画面では「開いて、出てきたURLを貼って」と案内する。
   ============================================================ */
export function ISBN13にする(isbn10){
  const d = String(isbn10 || "").replace(/[^0-9Xx]/g, "");
  if(!/^[0-9]{9}[0-9Xx]$/.test(d)) return null;
  const 体 = "978" + d.slice(0, 9);
  let 和 = 0;
  for(let i = 0; i < 12; i++) 和 += Number(体[i]) * (i % 2 ? 3 : 1);
  return 体 + String((10 - (和 % 10)) % 10);
}

export const アソシエイトタグ = "ucsd67001-22";

/* ============================================================
   Amazon の表紙

   ⚠️⚠️ **これは規約上グレー。承知のうえで使っている。**
      Amazonアソシエイト運営規約は、商品画像を **PA-API 経由で取得すること**
      を求めている。この images/P/{ASIN} という直リンクは広く使われているが、
      公式に認められた経路ではない。最悪、アカウント停止の理由になり得る。

   ⚠️ 少しでも趣旨に近づけるため、**Amazonリンクを設定した本にだけ**出す。
      画像とアフィリエイトリンクが必ず一緒になるようにしてある。
      リンクの無い本にこの画像を使わないこと。

   ⚠️ **PA-API が取れたら、そちらへ移すこと**（直近180日に3件の適格販売が条件）。
      移すときは、ここを PA-API の Images.Primary.Large に差し替えるだけでよい。
      画像そのものは保存していないので、URLの作り方を変えるだけで済む。
   ============================================================ */
export function AmazonのASIN(url){
  const m = String(url || "").match(/\/(?:dp|gp\/product|ASIN)\/([0-9A-Za-z]{10})/);
  return m ? m[1] : null;
}
export function Amazonの表紙(url){
  const a = AmazonのASIN(url);
  return a ? `https://m.media-amazon.com/images/P/${a}.01._SCLZZZZZZZ_.jpg` : null;
}
export function Amazonのリンク(isbn13){
  const a = ISBN10にする(isbn13);
  return a ? `https://www.amazon.co.jp/dp/${a}?tag=${アソシエイトタグ}` : null;
}
export const 逃 = s => (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export function いつ(t){
  if(!t?.seconds) return "たった今";
  const 差 = Math.floor(Date.now()/1000) - t.seconds;
  if(差 < 60)     return "たった今";
  if(差 < 3600)   return Math.floor(差/60) + "分前";
  if(差 < 86400)  return Math.floor(差/3600) + "時間前";
  return Math.floor(差/86400) + "日前";
}

let 知らせの札 = null;
export function 知らせる(文, 悪い=false){
  知らせの札?.remove();
  知らせの札 = document.createElement("div");
  知らせの札.className = "知らせ" + (悪い ? " 悪い" : "");
  知らせの札.textContent = 文;
  document.body.appendChild(知らせの札);
  setTimeout(()=>{ 知らせの札?.remove(); 知らせの札 = null; }, 3800);
}
