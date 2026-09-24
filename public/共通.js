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
import { getStorage, ref as 置き場, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

/* ⚠️ 管理画面（管理.js）が Firestore を直に触るので、ここから渡す。
      SDK を二重に読み込むと別インスタンスになって認証が効かない。 */
export const Firestore = {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, limit, getDocs, writeBatch, serverTimestamp
};

/* ── きまり ───────────────────────────────── */
export const 決済率 = 0.05;      // 決済手数料（本番でかかる想定ぶん）
export const 運営率 = 0.05;      // 本返しの運営ぶん
/* ⚠️ 1 - 0.05 - 0.05 は 0.8999999999999999 になる。そのまま掛けると、
      ちょうど .5 になる額で四捨五入が変わり（25pt の9割が 23 → 22）、
      **過去の記録の受取額まで変わって見える。**百分率で丸めてから戻す */
export const 受取率の百分率 = Math.round((1 - 決済率 - 運営率) * 100);   // 90
export const 受取率 = 受取率の百分率 / 100;                                // 0.9 ちょうど
export const 既定額 = 100;       // 金額のはじめの値

/* ── お金の計算は、ここだけでする ─────────────────────
   ⚠️⚠️ 前は画面と集計が別々に掛け算していて、四捨五入の位置が違った。
      窓で見せる受取額（本へ×配分）と、控えに出る額（内訳×0.9）が
      **1pt ずれることがあった。**いまは両方とも下の2つを通す。
   ⚠️ returns.parts には**支払額そのもの**を配分して入れる（合計＝amount をルールが見ている）。
      受取人に渡る額は、読むときに 受取人へ() で9割にする。 */
export const 受取人へ = 額 => Math.round((額 || 0) * 受取率);

export function 額の内訳(額){
  const 決 = Math.round(額 * 決済率), 運 = Math.round(額 * 運営率);
  return { 決, 運, 本へ: 額 - 決 - 運 };
}

/* 支払額を配分（%）で割る。端数は最初の行で吸収して、合計を必ず 額 にそろえる。
   受取人ら は [{ id, 名 }]、配分 は { id: % }。0% の相手は入れない。
   ⚠️ 吸収するのは配分の合計が 100% のときだけ。スライダーを動かしている途中
      （合計が 100% でない）に吸収すると、足りない分が全部最初の人に乗って見える。 */
export function 内訳を作る(額, 受取人ら, 配分){
  const 行ら = 受取人ら.filter(r=>配分[r.id] > 0)
    .map(r=>({ 受取人:r.id, 名:r.名, 額:Math.round(額 * 配分[r.id] / 100) }));
  const 計 = 受取人ら.reduce((s,r)=>s + (配分[r.id] || 0), 0);
  if(行ら.length && 計 === 100) 行ら[0].額 += 額 - 行ら.reduce((s,x)=>s + x.額, 0);
  return 行ら;
}
export const 初回配布 = 10000;   // 登録したときに配るポイント
export const 毎月配布 = 3000;    // 毎月配るポイント

export let app, auth, db, 倉;
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
      受取人の控え（と、本返しの完了画面にあるそこへのボタン）は、実質①だけに出る。
   ============================================================ */
export let 権限 = { 管理者:false, 受取人:[] };

/* ============================================================
   名乗り（表示名）

   ⚠️⚠️ **表示名を記録に焼き付けない。**users/{uid} にだけ持ち、画面で引く。
      記録は書き換えない決まりなので、焼き付けると
      **あとから名前を変えても過去の分に本名が残る。**
      「Googleの本名を出したくない」と気づくのは、たいてい1回投稿した後。

   ⚠️ 名乗りを決めていない人は、Googleの表示名を**その場で使うだけ**
      （保存しない）。決めた人だけ users に入る。
   ============================================================ */
export let 名乗り表 = new Map();   // uid → { 名, 印, 色 }

/* ⚠️⚠️ 顔（画像）と印（1文字＋色）の**二段構え**。
      画像を上げた人は画像、上げていない人は印が出る。**必ずどちらかが出る。**
      印は蔵書印のつもりで、外への読み込みが無く、壊れることも待ちも無い。
      Googleの顔写真をそのまま出したくない人は、印だけで済ませられる。

   ⚠️ 画像は Storage に置く（2026-09-23、Blaze に切り替えたので使える）。
      **上げる前に必ず 192px 四方へ縮めて WebP にする**（下の 顔をあげる）。
      原寸のまま置くと、読者の声が並ぶ画面で毎回それを読みに行くことになる。 */
export const 印の色ら = [
  { 名:"藤",   値:"#6b4bc4" }, { 名:"朱",   値:"#b03d27" },
  { 名:"藍",   値:"#2d5580" }, { 名:"緑",   値:"#356b49" },
  { 名:"茶",   値:"#7a5233" }, { 名:"墨",   値:"#3a3545" },
  { 名:"金茶",値:"#93712c" }, { 名:"梅",   値:"#a6416b" }
];

const 既定の印 = 名 => [...(名 || "読")][0] || "読";

export const 私の名 = () =>
  名乗り表.get(私?.uid)?.名 || 私?.displayName || "読者";

export function 名を引く(uid){
  return 名乗り表.get(uid)?.名 || "読者";
}

/* 名前も印も決めていない人にも、必ず何かを返す */
export function 印を引く(uid, 名のかわり){
  const u = 名乗り表.get(uid);
  const 名 = u?.名 || 名のかわり || "読者";
  return { 印: u?.印 || 既定の印(名), 色: u?.色 || 印の色ら[0].値, 顔: u?.顔 || null };
}
export const 私の印 = () => 印を引く(私?.uid, 私の名());

/* ⚠️⚠️ 色は style="background:${色}" に**そのまま**入る。users は本人が書く場所なので、
      `"onclick=ログアウト()`（ちょうど16文字）のような値を入れれば、
      しるしを押した**他人の画面で**それが動いた（2026-09-23 に塞いだ）。
      → #と16進6桁の形のときだけ使う。ルールでも同じ形に縛ってある。 */
const 色の形 = /^#[0-9a-fA-F]{6}$/;
const 色として = c => typeof c === "string" && 色の形.test(c) ? c : null;

export async function 名乗りらをよみこむ(){
  const s = await getDocs(collection(db, "users"));
  名乗り表 = new Map(s.docs.map(d=>{
    const x = d.data();
    return [d.id, { 名:x.name, 印:x.mark || null, 色:色として(x.color), 顔:x.photo || null,
                    公開: x.profilePublic === true }];
  }));
  return 名乗り表;
}

/* 読書家のページを公開しているか。**本人が設定で選んだ人だけ**（既定は非公開）。
   ⚠️⚠️ これは**見せ方の制御でしかない。**returns / keeps は公開読み取りで from（uid）を含むので、
      非公開の人の記録も、データベースを直に読めば集められる（README「次に作るもの」）。 */
export const 公開か = uid => !!名乗り表.get(uid)?.公開;

export async function 名乗りを決める({ 名, 印, 色, 顔, 公開 }){
  if(!私) throw new Error("ログインしていません");
  const n = (名 || "").trim().slice(0, 24);
  if(!n) throw new Error("名前を入れてください");
  const m = ([...(印 || "")][0] || 既定の印(n)).slice(0, 2);
  const c = 印の色ら.some(x=>x.値 === 色) ? 色 : 印の色ら[0].値;
  /* ⚠️ 顔は「上げた画像のURL」か null。ルールで長さも見ているので、
        知らない場所のURLを入れられない（Storage の URL だけ通す）。 */
  const f = typeof 顔 === "string" && 顔.startsWith("https://") ? 顔 : null;
  const p = 公開 === true;
  await setDoc(doc(db, "users", 私.uid),
    { name:n, mark:m, color:c, photo:f, profilePublic:p, updatedAt:new Date().toISOString() });
  名乗り表.set(私.uid, { 名:n, 印:m, 色:c, 顔:f, 公開:p });
  return n;
}

/* ── 顔（画像）をあげる ─────────────────────────
   ⚠️⚠️ **縮めてから上げる。**原寸のまま置くと、声が20件並ぶ画面で
      20枚の写真を読みに行くことになり、通信も Storage の課金も効いてくる。
      192px 四方・WebP なら、たいてい 5〜15KB に収まる。
   ⚠️ 置き場は icons/{uid} 固定。上書きになるので、古い画像が溜まらない。
   ⚠️ 正方形に切る（中央基準）。丸く出すので、縦横比を残すと欠ける。 */
export async function 顔をあげる(ファイル){
  if(!私) throw new Error("ログインしていません");
  if(!/^image\//.test(ファイル.type)) throw new Error("画像を選んでください");
  if(ファイル.size > 8 * 1024 * 1024) throw new Error("画像が大きすぎます（8MBまで）");

  const 絵 = await new Promise((よし, だめ)=>{
    const i = new Image(); const u = URL.createObjectURL(ファイル);
    i.onload = ()=>{ URL.revokeObjectURL(u); よし(i); };
    i.onerror = ()=>{ URL.revokeObjectURL(u); だめ(new Error("画像を読めませんでした")); };
    i.src = u;
  });

  const 辺 = 192;
  const 元辺 = Math.min(絵.width, 絵.height);
  const c = document.createElement("canvas"); c.width = c.height = 辺;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(絵, (絵.width - 元辺) / 2, (絵.height - 元辺) / 2, 元辺, 元辺, 0, 0, 辺, 辺);
  const 塊 = await new Promise(よし=>c.toBlob(よし, "image/webp", 0.85));

  const 先 = 置き場(倉, `icons/${私.uid}`);
  await uploadBytes(先, 塊, { contentType:"image/webp", cacheControl:"public,max-age=86400" });
  return await getDownloadURL(先);
}

export async function 顔をけす(){
  if(!私) throw new Error("ログインしていません");
  await deleteObject(置き場(倉, `icons/${私.uid}`)).catch(()=>{});  // 無くてもよい
}

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
  倉   = getStorage(app);

  /* ⚠️ 本と主体は**ログインを待たずに**読む。ルールで公開してあるので取れる。
        入る前の画面にも棚を出したいため。 */
  const 棚 = Promise.all([
    蔵書をよみこむ(),
    名乗りらをよみこむ().catch(e=>{ console.error(e); })
  ]).catch(e=>{ console.error(e); });

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

   ⚠️ 本は books、著者と出版社は entities。**どちらも公開読み取り**（入る前にも棚を見せるため）。
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
      手の書影: x.coverManual || null,     // 管理画面の「直す」に出すのはこれ（書影は自動の分も混ざる）
      /* ⚠️ **1冊に複数のリンクを持てる。**作品は1つでも、Amazonでは
            版や巻で分かれていることがある（『二十歳のころ』は文庫で上下2巻）。
            単数の amazonUrl は古い形。読むときだけ面倒を見る。 */
      Amazonら: (x.amazonLinks && x.amazonLinks.length ? x.amazonLinks
                 : x.amazonUrl ? [{ label:"", url:x.amazonUrl }] : []),
      登録日: x.addedAt || null,
      /* 申請から並んだ本なら、申請した人の uid。画面に名前を出すのは、
         読書家のページを公開している人だけ（公開か() で絞る） */
      申請者: x.requestedBy || null,
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
export async function 本返しする({ 本id, 額, 内訳, 匿 }){
  if(!私) throw new Error("ログインしていません");
  if(!財布) await 財布を読み直す();
  if(額 > 財布.残高) throw new Error("残高が足りません");

  const parts = 内訳.map(x=>({ to:x.受取人, name:x.名, amount:x.額 }));

  const 束 = writeBatch(db);
  束.update(doc(db,"wallets",私.uid), { balance: 財布.残高 - 額 });
  束.set(doc(collection(db,"returns")), {
    book: 本id,
    from: 私.uid,
    /* ⚠️⚠️ **名前は保存しない。**users/{uid} から画面で引く。
       焼き付けると、名前を変えても過去の分に古い名前が残る。 */
    anon: !!匿,
    amount: 額,
    parts,
    toIds: parts.map(x=>x.to),          // array-contains で引くための控え
    /* ⚠️ ことばは voices に分けた（1冊に1人1つ・直せる）。ここは空で送る。
          ルールが text を求めるので項目だけ残してある */
    text: "",
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
export async function 残したい({ 本id, 約 }){
  if(!私) throw new Error("ログインしていません");
  await setDoc(doc(collection(db,"keeps")), {
    book: 本id,
    from: 私.uid,
    pledge: 約,
    text: "",                 // ⚠️ ことばは voices へ（本返しする と同じ）
    at: serverTimestamp()
  });
  return true;
}

/* ============================================================
   ことば（voices）

   ⚠️⚠️ **1冊に1人1つ。**番号は「本の ISBN _ uid」。ルールもこの番号しか受け付けない。
      ポイントは同じ本に何度返してもよいが、ことばは水増ししない（2026-09-24 決定）。
   ⚠️ **ことばだけで推せる。**ポイントを返していなくても書ける。
   ⚠️ 直せる・消せる。直したら editedAt が入り、画面に「直した日」を小さく出す。
   ============================================================ */
export const ことばの長さ = 400;
const ことばの番号 = (本id, uid) => `${本id}_${uid}`;

export async function 私のことば(本id){
  if(!私) return null;
  const d = await getDoc(doc(db, "voices", ことばの番号(本id, 私.uid)));
  return d.exists() ? ことばを直す(d.data()) : null;
}

export async function ことばを書く({ 本id, 文, 匿 }){
  if(!私) throw new Error("ログインしていません");
  const t = (文 || "").trim().slice(0, ことばの長さ);
  if(!t) throw new Error("ことばを入れてください");
  const 道 = doc(db, "voices", ことばの番号(本id, 私.uid));
  const 今 = await getDoc(道);
  if(今.exists()) await updateDoc(道, { text:t, anon:!!匿, editedAt:serverTimestamp() });
  else await setDoc(道, { book:本id, from:私.uid, anon:!!匿, text:t,
                          at:serverTimestamp(), editedAt:null });
}

export async function ことばを消す(本id){
  if(!私) throw new Error("ログインしていません");
  await deleteDoc(doc(db, "voices", ことばの番号(本id, 私.uid)));
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
    name: 私の名().slice(0,40),      // ⚠️ 名乗りを使う（Googleの本名を出さない）
    title: (題 || "").slice(0,200),
    author: (著 || "").slice(0,100),
    publisher: (版元 || "").slice(0,100),
    isbn: (isbn || "").replace(/[^0-9Xx]/g, "").slice(0,13),
    memo: (覚書 || "").slice(0,300),
    at: serverTimestamp()
  });
  return true;
}

/* 自分が出した申請と、そのその後。
   ⚠️ 申請が棚に並んだか分からないと、出した人は次を出さない。結果を見せて輪を閉じる。
   ⚠️ status が無い古い申請は、done で読み替える（done だけでは並んだか見送りか分からない）。
   ⚠️ where(from==自分) だけで引き、並べ替えは手元でする（複合インデックスを増やさない） */
export const 申請の状態 = { 確認中:"確認中", 並んだ:"棚に並びました", 見送り:"見送り", 処理済み:"処理済み" };
export async function 私の申請(){
  if(!私) return [];
  const s = await getDocs(query(collection(db, "requests"), where("from", "==", 私.uid)));
  return s.docs.map(d=>{
    const x = d.data();
    return { id:d.id, 題:x.title || "", 著:x.author || "", 本:x.book || null, 時:x.at,
             状態: x.status || (x.done ? "処理済み" : "確認中") };
  }).sort((a,b)=>(b.時?.seconds||0) - (a.時?.seconds||0));
}

/* 棚の育ち具合。今月（UTC の月。財布の配布と同じ区切り）に入った冊数 */
export const 今月増えた = () => 蔵書.filter(b=>String(b.登録日 || "").startsWith(今月())).length;

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
/* ⚠️⚠️ **匿名のときは 送り主（uid）を外へ出さない。**
      印を出すのに uid が要るが、匿名の行に付けて渡すと、
      画面の HTML に誰が書いたかが載ってしまう。 */
const 返しを直す = x => ({
  種:"返し", 本:x.book, 送り主:x.anon ? null : x.from,
  表示名:x.anon ? "匿名" : 名を引く(x.from), 匿:!!x.anon,
  額:x.amount||0, 内訳:(x.parts||[]).map(p=>({受取人:p.to, 名:p.name, 額:p.amount})),
  文:x.text||"", 時:x.at
});
const 残しを直す = x => ({
  種:"残し", 本:x.book, 送り主:x.from, 表示名:名を引く(x.from), 匿:false,
  約:x.pledge||0, 文:x.text||"", 時:x.at
});
/* ⚠️ 匿名のことばも、返しと同じく 送り主（uid）を外へ出さない */
function ことばを直す(x){
  return { 種:"ことば", 本:x.book, 送り主:x.anon ? null : x.from,
           表示名:x.anon ? "匿名" : 名を引く(x.from), 匿:!!x.anon,
           文:x.text || "", 時:x.at, 直した:x.editedAt || null };
}
const 新しい順 = (a,b)=>(b.時?.seconds||0) - (a.時?.seconds||0);

/* ことばをまとめて読む。本の数が30を超えると in で引けないので、30ずつに分ける。
   ⚠️ orderBy を付けない（複合インデックスを増やさない）。並べ替えは手元で */
async function 本らのことば(本idら){
  const 束ら = [];
  for(let i = 0; i < 本idら.length; i += 30) 束ら.push(本idら.slice(i, i + 30));
  const 結果 = await Promise.all(束ら.map(ids =>
    getDocs(query(collection(db,"voices"), where("book","in",ids)))));
  return 結果.flatMap(s=>s.docs.map(d=>ことばを直す(d.data()))).sort(新しい順);
}

/* 著者・出版社に届いたことば（その相手が届け先に入っている本へのことば） */
export async function 主体へのことば(主体id){
  const ids = 蔵書.filter(b=>b.受取.some(r=>r.id === 主体id)).map(b=>b.id);
  return ids.length ? 本らのことば(ids) : [];
}

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
  const [返, 残, 声] = await Promise.all([
    getAggregateFromServer(collection(db,"returns"), { 人数: count(), 総額: sum("amount") }),
    getAggregateFromServer(collection(db,"keeps"), { 人数: count() }),
    getAggregateFromServer(collection(db,"voices"), { 件数: count() })
  ]);
  return { 人数: 返.data().人数, 金額: 返.data().総額 || 0, 残数: 残.data().人数,
           ことば: 声.data().件数 };
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
  const [返, 残, 声] = await Promise.all([
    getDocs(query(collection(db,"returns"), orderBy("at","desc"), limit(500))),
    getDocs(query(collection(db,"keeps"), orderBy("at","desc"), limit(500))),
    getDocs(query(collection(db,"voices"), orderBy("at","desc"), limit(500)))
  ]);

  /* ⚠️ 人数は**別々の人の数**（同じ人が2回返しても1人）。
        前の 本.人数 は返しの件数だったので、ここで「人」に直した。件数は 件数 に残す */
  const 本 = {}, 主体 = {}, 人 = {};
  const 本欄   = id => (本[id]   ||= { 件数:0, 人ら:new Set(), 金額:0, ことば:0, 残数:0, 約額:0 });
  const 主体欄 = id => (主体[id] ||= { id, 件数:0, 人ら:new Set(), 金額:0, ことば:0 });
  const 人欄   = id => (人[id]   ||= { id, 名:null, 件数:0, 金額:0, ことば:0, 登録:0 });

  返.docs.forEach(d=>{
    const x = d.data();
    const b = 本欄(x.book); b.件数++; b.金額 += x.amount || 0;
    if(x.from) b.人ら.add(x.from);

    /* 受取人に渡るのは9割。受取人の控えと同じ 受取人へ() で数える */
    (x.parts || []).forEach(p=>{
      const e = 主体欄(p.to); e.件数++; e.金額 += 受取人へ(p.amount);
      if(x.from) e.人ら.add(x.from);
    });

    if(x.from){
      const u = 人欄(x.from); u.件数++; u.金額 += x.amount || 0;
      /* ⚠️ 匿名で送った分は名前に使わない。匿名だけの人は「匿名」のまま並ぶ */
      if(!x.anon) u.名 = 名を引く(x.from);
    }
  });
  残.docs.forEach(d=>{
    const x = d.data(); const b = 本欄(x.book);
    b.残数++; b.約額 += x.pledge || 0;
  });

  /* ことばは voices から数える（1冊に1人1つなので、数＝書いた人の数）。
     本の届け先ぜんぶに1件ずつ数える（その本へのことばは、著者にも出版社にも届く）。
     ⚠️ 人ごとは**匿名のことばを数えない。**番付に名前が出るので、匿名の分から人が割れないように */
  声.docs.forEach(d=>{
    const x = d.data();
    本欄(x.book).ことば++;
    (本を引く(x.book)?.受取 || []).forEach(r=>主体欄(r.id).ことば++);
    if(x.from && !x.anon){ const u = 人欄(x.from); u.ことば++; u.名 = 名を引く(x.from); }
  });

  /* 棚に加えた本（申請から並んだ本）。⚠️ 申請には名前を出す選択が無いので、
     **読書家のページを公開している人だけ**数える（本のページの礼と同じ考え） */
  蔵書.forEach(b=>{
    if(b.申請者 && 公開か(b.申請者)){ const u = 人欄(b.申請者); u.登録++; u.名 = 名を引く(b.申請者); }
  });

  /* Set は画面へ渡さない。数にしてから返す */
  const 数に = o => { const { 人ら, ...残り } = o;
    return { ...残り, ...(人ら ? { 人数:人ら.size } : {}) }; };
  return {
    本:   Object.fromEntries(Object.entries(本).map(([k,v])=>[k, 数に(v)])),
    主体: Object.fromEntries(Object.entries(主体).map(([k,v])=>[k, 数に(v)])),
    人:   Object.values(人).map(数に)
  };
}

/* 番付の物差し（上の段：本・著者・出版社）。**切り替えと並べ方を、ここ1か所で決める。**
   ⚠️ 人数は「ポイントを返した別々の人の数」。ことばだけの人は「ことば」で数える。 */
export const 物差しら = {
  金額:   { 名:"金額",   項:"金額",   単位:"pt" },
  人数:   { 名:"人数",   項:"人数",   単位:"人" },
  ことば: { 名:"ことば", 項:"ことば", 単位:"件" }
};
/* 下の段：熱心な読書家。切り替えずに3つ並べる（お金・ことば・棚づくり、それぞれの1位を見せる） */
export const 読書家の物差しら = [
  { 名:"返したポイント", 項:"金額",   単位:"pt" },
  { 名:"書いたことば",   項:"ことば", 単位:"件" },
  { 名:"棚に加えた本",   項:"登録",   単位:"冊" }
];

/* 番付。上位を何件か返すだけ。数えるのは上でやってある。
   ⚠️ 並べるのは、その物差しが 1 以上のものだけ。同じ値なら金額の多い順 */
export function 番付(数えたもの, 件数 = 3, 物差し = "金額"){
  const 差 = 物差しら[物差し] || 物差しら.金額;
  const 並べる = (ら, 項) => ら.filter(x=>(x[項] || 0) > 0)
    .sort((a,b)=>(b[項] - a[項]) || (b.金額 - a.金額)).slice(0, 件数);
  const 主体ら = Object.values(数えたもの.主体)
    .map(e=>({ ...e, 主体: 主体表.get(e.id) }))
    .filter(e=>e.主体);
  const 型で = 型 => 並べる(主体ら.filter(e=>e.主体.型 === 型), 差.項);

  return {
    本: 並べる(Object.entries(数えたもの.本)
      .map(([id, v])=>({ id, ...v, 本: 本を引く(id) })).filter(x=>x.本), 差.項),
    著者:   型で("author"),
    出版社: 型で("publisher"),
    書店:   型で("store"),
    読書家: 読書家の物差しら.map(m=>({ ...m, 行ら: 並べる(数えたもの.人, m.項) })),
    物差し: 差
  };
}

/* 本へのことば。⚠️ 返し・残しの text は、ことばを voices に分けた時点で0件だった（2026-09-24）ので読まない */
export async function 本の声(本id){
  return 本らのことば([本id]);
}

/* 新しいことば。voices はどれも中身があるので、そのまま 件数 だけ読めばよい */
export async function 最近の声(件数=6){
  const s = await getDocs(query(collection(db,"voices"), orderBy("at","desc"), limit(件数)));
  return s.docs.map(d=>ことばを直す(d.data()));
}

/* 自分の記録：返し・残し・ことば。⚠️ 自分のことばは匿名でも入れる（自分の画面なので）。
   ただし 返し・ことばを直す は匿名だと 送り主 を落とすので、ここでは関係ない（本と中身だけ使う） */
export async function 私の記録(){
  if(!私) return [];
  const [返, 残, 声] = await Promise.all([
    getDocs(query(collection(db,"returns"), where("from","==",私.uid), orderBy("at","desc"), limit(100))),
    getDocs(query(collection(db,"keeps"),   where("from","==",私.uid), orderBy("at","desc"), limit(100))),
    getDocs(query(collection(db,"voices"),  where("from","==",私.uid)))
  ]);
  return [...返.docs.map(d=>返しを直す(d.data())),
          ...残.docs.map(d=>残しを直す(d.data())),
          ...声.docs.map(d=>ことばを直す(d.data()))]
    .sort(新しい順);
}

/* 読書家のページに出す記録。
   ⚠️⚠️ **匿名で送った返しは入れない。**数字にも一覧にも出さない。
      公開していない人の分は返さない（画面で出さないだけでなく、ここで止める）。 */
export async function 読書家の記録(uid){
  if(!公開か(uid)) return [];
  const [返, 残, 声] = await Promise.all([
    getDocs(query(collection(db,"returns"), where("from","==",uid), orderBy("at","desc"), limit(200))),
    getDocs(query(collection(db,"keeps"),   where("from","==",uid), orderBy("at","desc"), limit(200))),
    getDocs(query(collection(db,"voices"),  where("from","==",uid)))
  ]);
  return [...返.docs.map(d=>d.data()).filter(x=>!x.anon).map(返しを直す),
          ...残.docs.map(d=>残しを直す(d.data())),
          ...声.docs.map(d=>d.data()).filter(x=>!x.anon).map(ことばを直す)]   // ⚠️ 匿名のことばも出さない
    .sort(新しい順);
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
    return { 本:x.book, 送り主:x.anon?null:x.from, 名:x.anon?"匿名":名を引く(x.from),
             額:受取人へ(行?.amount), 文:x.text||"", 時:x.at };
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
export const 逃 = s => String(s ?? "").replace(/[&<>"']/g,
  c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* onclick などに**値を渡すときは、必ずこれを通す。**
   ⚠️⚠️ 逃() だけでは守れない。属性の中の &#39; や &quot; は、HTML が元に戻してから
      JavaScript に渡すので、onclick="go('books',{q:'${逃(q)}'})" に ' を含む q が来ると
      文字列が閉じて、そこから先がスクリプトとして動く。q は URL の ?q= から来るので、
      **細工した URL を踏ませれば何でも動かせた**（並び順の ?s= は逃がしてすらいなかった。
      2026-09-23 に直した）。
   → JSON の文字列にしてから逃がす。HTML が戻したあとも、正しい JS の文字列リテラルになる。
      使い方：onclick="go('book',{id:${引数(b.id)}})" （外側に ' を付けない） */
export const 引数 = v => 逃(JSON.stringify(String(v ?? "")));

/* ============================================================
   窓（覆い）
   ⚠️ 前は本返し・残したい・申請・設定・管理の2つで、同じ HTML を6回書いていた。
      組み立てはここだけ。閉じるのは 覆い閉じ()。
   ============================================================ */
export function 窓を出す(題, 中, 頭の下 = ""){
  document.getElementById("窓").innerHTML = `
  <div class="覆い" onclick="if(event.target===this)覆い閉じ()">
    <div class="窓">
      <div class="窓の頭"><h3>${題}</h3>
        <button class="閉じる" onclick="覆い閉じ()">✕</button></div>
      ${頭の下}
      <div class="窓の中">${中}</div>
    </div></div>`;
}
export const 覆い閉じ = () =>{ document.getElementById("窓").innerHTML = ""; };
window.覆い閉じ = 覆い閉じ;

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
