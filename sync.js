// Cloud sync with Firebase: Google sign-in + Firestore.
//
// Cloud layout:
//   spaces/{spaceId}               -> { name, owner, members: [uid], memberInfo: { uid: { name, email, photo } }, categories }
//   spaces/{spaceId}/items/{id}    -> one document per to-do
// A "space" is a shared list. Everyone in `members` can read and edit it; the space id is the invite code.
// One document per to-do means two people editing different to-dos at the same time never overwrite each other.
// Firestore's offline cache keeps everything on the device, so the list works without internet and
// sends changes when a connection is back (any network).
import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.14.1';
const SPACE_KEY = 'todoWithElias.space.'; // + uid -> the list this device shows
const JOIN_KEY = 'todoWithElias.join';    // invite code waiting to be used

const App = window.TodoApp;
const info = { status: 'loading', user: null, error: '' };

let fb, auth, db;
let user = null;
let spacesUnsub = null;
let spaceUnsubs = [];
let spaces = [];
let spacesFromServer = false;
let active = null, createdId = null, leftId = null;
let spaceRef = null, itemsCol = null;
let spaceData = null, items = null, itemsPending = false;
let joining = false;
let pending = 0;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
const linked = () => !!store.get(App.LINK_KEY);
const clean = (x) => JSON.parse(JSON.stringify(x)); // Firestore rejects `undefined`
const parseCode = (s) => {
  const m = String(s).match(/join=([A-Za-z0-9]+)/);
  return m ? m[1] : String(s).trim().replace(/[^A-Za-z0-9]/g, '');
};

// An invite link looks like …/#join=<spaceId>. Remember it until it has been used.
function readInviteLink() {
  if (!/join=/.test(location.hash)) return false;
  const code = parseCode(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!code) return false;
  store.set(JOIN_KEY, code);
  return true;
}
readInviteLink();

function setStatus(status, extra = {}) {
  Object.assign(info, { status, error: '' }, extra);
  App.onSyncChange();
}

function refreshStatus() {
  const online = navigator.onLine;
  if (!fb) return;
  if (!user) return setStatus('signedout', { user: null });
  if (!spaceData || !items) return setStatus(online ? 'connecting' : 'waiting');
  if (pending > 0 || itemsPending) return setStatus(online ? 'syncing' : 'offline');
  setStatus(online ? 'synced' : 'offline');
}

function friendly(e) {
  const code = e?.code || '';
  if (code === 'auth/unauthorized-domain') return `This website (${location.hostname}) is not allowed yet. In Firebase: Authentication → Settings → Authorized domains → add it.`;
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return 'Google sign-in is not turned on yet. In Firebase: Authentication → Sign-in method → enable Google.';
  if (code === 'permission-denied') return 'Firestore is blocking access. Publish the security rules from firestore.rules (Firestore → Rules).';
  if (code === 'not-found' || code === 'failed-precondition') return 'The Firestore database has not been created yet. In Firebase: Firestore Database → Create database.';
  if (code === 'auth/network-request-failed') return 'No internet connection. Try again when you are online.';
  return e?.message || 'Something went wrong with sync.';
}

function onError(e) {
  setStatus('error', { error: friendly(e) });
}

async function boot() {
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    fb = { ...appM, ...authM, ...fsM };
  } catch {
    // Edits are kept in the outbox and sent once sync loads (when back online, or next time the app opens).
    setStatus('unavailable', { error: 'Cloud sync could not load (are you offline?). Your to-dos are still saved on this device.' });
    addEventListener('online', boot, { once: true });
    return;
  }
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch {
    db = fb.getFirestore(app);
  }
  fb.getRedirectResult(auth).catch((e) => setStatus('error', { error: friendly(e) }));
  fb.onAuthStateChanged(auth, (u) => {
    if (u) return start(u);
    const wasLinked = linked();
    stop();
    if (wasLinked) { store.del(App.LINK_KEY); App.clearOutbox(); App.resetLocal(); }
    refreshStatus();
  });
}

const meInfo = () => ({ name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' });

function start(u) {
  stop();
  user = u;
  setStatus('connecting', { user: { uid: u.uid, ...meInfo() } });
  const q = fb.query(fb.collection(db, 'spaces'), fb.where('members', 'array-contains', u.uid));
  spacesUnsub = fb.onSnapshot(q, { includeMetadataChanges: true }, (qs) => {
    spaces = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    spacesFromServer = !qs.metadata.fromCache;
    chooseSpace();
  }, onError);
}

function stopSpace() {
  spaceUnsubs.forEach((fn) => fn());
  spaceUnsubs = [];
  active = null;
  spaceRef = itemsCol = null;
  spaceData = items = null;
  itemsPending = false;
}

function stop() {
  spacesUnsub?.();
  spacesUnsub = null;
  stopSpace();
  user = null;
  spaces = [];
  spacesFromServer = false;
  createdId = leftId = null;
  joining = false;
  pending = 0;
}

// Decide which list to show: a pending invite, the one used last, the oldest one, or a brand new one.
function chooseSpace() {
  if (!user || joining) return;
  const mine = spaces.filter((s) => s.id !== leftId);
  const code = store.get(JOIN_KEY);
  if (code && spacesFromServer) {
    if (!mine.some((s) => s.id === code)) return doJoin(code);
    store.del(JOIN_KEY);
    if (active !== code) { selectSpace(code); App.toast(`You're already in "${mine.find((s) => s.id === code).name}"`); }
    return;
  }
  if (active && (mine.some((s) => s.id === active) || active === createdId)) return publish();
  const saved = store.get(SPACE_KEY + user.uid);
  const byAge = [...mine].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  const pick = mine.find((s) => s.id === saved) || byAge[0];
  if (pick) return selectSpace(pick.id);
  if (!spacesFromServer) return refreshStatus(); // only create a list once the server confirms there is none
  createSpace();
}

function createSpace() {
  const ref = fb.doc(fb.collection(db, 'spaces'));
  createdId = active = ref.id; // claimed now so snapshots don't pick or create another list meanwhile
  // Listen only once the server has the list, otherwise the security rules refuse the listeners.
  fb.setDoc(ref, {
    name: 'Our to-dos',
    owner: user.uid,
    members: [user.uid],
    memberInfo: { [user.uid]: meInfo() },
    categories: clean(App.getState().categories),
    createdAt: fb.serverTimestamp(),
  }).then(() => { if (user && active === ref.id) selectSpace(ref.id, true); }, onError);
}

function selectSpace(id, isNew = false) {
  if (active === id && spaceRef) return;
  stopSpace();
  active = id;
  store.set(SPACE_KEY + user.uid, id);
  spaceRef = fb.doc(db, 'spaces', id);
  itemsCol = fb.collection(spaceRef, 'items');
  const known = spaces.find((s) => s.id === id);

  if (!linked()) {
    // First sign-in on this device: add what was saved here before signing in to the account.
    const local = App.getState();
    const batch = fb.writeBatch(db);
    for (const item of local.items) batch.set(fb.doc(itemsCol, item.id), clean(item));
    if (known && !isNew) {
      const cats = [...(known.categories || [])];
      for (const c of local.categories) if (!cats.some((x) => x.id === c.id)) cats.push(c);
      if (cats.length !== (known.categories || []).length) batch.update(spaceRef, { categories: clean(cats) });
    }
    if (local.items.length) batch.commit().catch(onError);
    store.set(App.LINK_KEY, user.uid);
    App.clearOutbox();
    if (local.items.length && known) App.toast(`Your ${local.items.length} to-do${local.items.length === 1 ? ' was' : 's were'} added to "${known.name}"`);
  }
  // Keep my name and photo up to date for the people I share with.
  if (known && JSON.stringify(known.memberInfo?.[user.uid] || {}) !== JSON.stringify(meInfo())) {
    fb.updateDoc(spaceRef, { [`memberInfo.${user.uid}`]: meInfo() }).catch(() => {});
  }
  flush();

  spaceUnsubs.push(fb.onSnapshot(spaceRef, (snap) => {
    if (!snap.exists()) return;
    spaceData = snap.data();
    publish();
  }, onError));
  spaceUnsubs.push(fb.onSnapshot(itemsCol, { includeMetadataChanges: true }, (qs) => {
    items = qs.docs.map((d) => d.data());
    itemsPending = qs.metadata.hasPendingWrites;
    publish();
  }, onError));
  refreshStatus();
}

function publish() {
  refreshStatus();
  if (!spaceData || !items) return;
  const infoMap = spaceData.memberInfo || {};
  App.replaceState({
    items,
    categories: spaceData.categories?.length ? spaceData.categories : App.getState().categories,
    space: {
      id: active,
      name: spaceData.name || 'Our to-dos',
      owner: spaceData.owner,
      members: (spaceData.members || []).map((uid) => ({ uid, name: '', email: '', photo: '', ...(infoMap[uid] || {}) })),
    },
  });
}

function doJoin(code) {
  joining = true;
  setStatus('connecting', { user: info.user });
  const prev = active && spaces.find((s) => s.id === active);
  const prevItems = items || [];
  fb.updateDoc(fb.doc(db, 'spaces', code), { members: fb.arrayUnion(user.uid), [`memberInfo.${user.uid}`]: meInfo() })
    .then(() => {
      store.del(JOIN_KEY);
      joining = false;
      if (!user) return;
      selectSpace(code);
      App.goto('todos');
      App.toast('You joined the shared list');
      // Offer to bring a personal list's to-dos along, so nothing is left behind.
      if (prev && prev.members.length === 1 && prevItems.length) {
        setTimeout(() => App.confirm(`Move your ${prevItems.length} to-do${prevItems.length === 1 ? '' : 's'} from "${prev.name}" into the shared list?`,
          () => moveItems(prev, prevItems, code), 'Move them', 'Bring your to-dos?'), 600);
      }
    })
    .catch((e) => {
      store.del(JOIN_KEY);
      joining = false;
      if (!user) return;
      setStatus('error', { error: e?.code === 'permission-denied' || e?.code === 'not-found' ? 'That invite link is not valid, or the list was deleted. Ask for a new link.' : friendly(e) });
      chooseSpace();
    });
}

function moveItems(from, list, toId) {
  const toRef = fb.doc(db, 'spaces', toId);
  const fromItems = fb.collection(db, 'spaces', from.id, 'items');
  const cats = [...(spaceData?.categories || [])];
  for (const c of from.categories || []) if (!cats.some((x) => x.id === c.id)) cats.push(c);
  for (let i = 0; i < list.length; i += 200) {
    const batch = fb.writeBatch(db);
    for (const item of list.slice(i, i + 200)) {
      batch.set(fb.doc(toRef, 'items', item.id), clean(item));
      batch.delete(fb.doc(fromItems, item.id));
    }
    if (i === 0) batch.update(toRef, { categories: clean(cats) });
    batch.commit().catch(onError);
  }
  App.toast('To-dos moved');
}

// Send edits queued by the app (see commit() in app.js).
function flush() {
  if (!user || !itemsCol) return;
  const ops = App.takeOutbox();
  for (let i = 0; i < ops.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if (op.t === 'put') batch.set(fb.doc(itemsCol, op.item.id), clean(op.item));
      else if (op.t === 'del') batch.delete(fb.doc(itemsCol, op.id));
      else if (op.t === 'cats') batch.update(spaceRef, { categories: clean(op.categories) });
    }
    pending++;
    batch.commit()
      .then(() => { pending--; refreshStatus(); })
      .catch((e) => { pending--; onError(e); });
  }
  refreshStatus();
}

async function signIn() {
  if (!auth) return;
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      return fb.signInWithRedirect(auth, provider);
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return refreshStatus();
    setStatus('error', { error: friendly(e) });
  }
}

async function signOut() {
  if (!auth) return;
  flush();
  store.del(App.LINK_KEY);
  App.clearOutbox();
  stop();
  await fb.signOut(auth);
  App.resetLocal();
}

function join(input) {
  const code = parseCode(input);
  if (!code) return App.toast('Paste the invite link you were sent');
  if (code === active) return App.toast("You're already in this list");
  store.set(JOIN_KEY, code);
  if (!user) return App.toast('Sign in with Google first, then the list will open');
  spacesFromServer ? doJoin(code) : App.toast('Joining when the connection is ready…');
}

function switchSpace(id) {
  if (!user || id === active) return;
  selectSpace(id);
  App.toast(`Showing "${spaces.find((s) => s.id === id)?.name || 'list'}"`);
}

function renameSpace(name) {
  if (spaceRef) fb.updateDoc(spaceRef, { name }).catch(onError);
}

function leaveSpace() {
  if (!user || !active) return;
  const ref = spaceRef;
  leftId = active;
  stopSpace();
  store.del(SPACE_KEY + user.uid);
  fb.updateDoc(ref, { members: fb.arrayRemove(user.uid), [`memberInfo.${user.uid}`]: fb.deleteField() }).catch(onError);
  App.toast('You left the list');
  chooseSpace();
}

// The invite link was opened while the app was already open in this tab.
addEventListener('hashchange', () => {
  if (!readInviteLink()) return;
  if (user && spacesFromServer) chooseSpace();
  else App.goto('settings');
});
addEventListener('online', refreshStatus);
addEventListener('offline', refreshStatus);

window.TodoSync = {
  info,
  flush,
  signIn,
  signOut,
  join,
  switchSpace,
  renameSpace,
  leaveSpace,
  inviteLink: () => `${location.origin}${location.pathname}#join=${active || ''}`,
  pendingInvite: () => store.get(JOIN_KEY),
  spaces: () => spaces.filter((s) => s.id !== leftId).map((s) => ({ id: s.id, name: s.name, memberCount: (s.members || []).length })),
};
App.onSyncChange();
boot();
