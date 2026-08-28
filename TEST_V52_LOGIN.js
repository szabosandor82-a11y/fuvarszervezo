const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const requests = [];
const storage = new Map();
const profileRow = {
  email: 'szabo.sandor82@gmail.com',
  role: 'admin',
  driver_key: null,
  vehicle_id: null,
  display_name: 'Szabó Sándor',
  active: true
};

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => payload === null ? '' : JSON.stringify(payload)
  };
}

const ctx = {
  console,
  URL,
  URLSearchParams,
  Blob,
  ArrayBuffer,
  FormData,
  Date,
  JSON,
  String,
  Math,
  encodeURIComponent,
  setInterval,
  clearInterval,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  dispatchEvent() {},
  document: { title: 'Fuvarszervező V52', hidden: false },
  history: { replaceState() {} },
  location: {
    href: 'https://example.github.io/fuvarszervezo/index.html',
    pathname: '/fuvarszervezo/index.html',
    search: '',
    hash: ''
  },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  },
  FUVARSZERVEZO_ONLINE_CONFIG: {
    supabaseUrl: 'https://test-project.supabase.co',
    anonKey: 'test-publishable-key'
  },
  fetch: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/token?grant_type=password')) {
      return response({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1', email: profileRow.email }
      });
    }
    if (String(url).includes('/rest/v1/allowed_users?')) return response([profileRow]);
    return response({ message: 'Unexpected request' }, 500);
  }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/online-v44-2.js', 'utf8'), ctx);

(async () => {
  const session = await ctx.V44Online.signInWithPassword(' SZABO.SANDOR82@GMAIL.COM ', 'Egyedi-Teszt-52!');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/auth\/v1\/token\?grant_type=password$/);
  const loginBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(loginBody, { email: profileRow.email, password: 'Egyedi-Teszt-52!' });

  assert.equal(session.user.email, profileRow.email);
  assert.equal(ctx.V44Online.getSession().access_token, 'access-123');
  const profile = await ctx.V44Online.fetchProfile();
  assert.equal(profile.role, 'admin');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer access-123');

  const storedSession = [...storage.values()].join(' ');
  assert.ok(!storedSession.includes('Egyedi-Teszt-52!'), 'A jelszó nem kerülhet localStorage-ba.');
  assert.ok(!requests.some(request => request.url.includes('/auth/v1/otp')), 'A V52 nem kér Magic Linket.');

  console.log('V52 jelszavas belépés egységteszt: 3/3 sikeres.');
})().catch(error => {
  console.error('V52 jelszavas belépés egységteszt HIBA:', error);
  process.exitCode = 1;
});
