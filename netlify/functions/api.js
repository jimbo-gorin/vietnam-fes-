// netlify/functions/api.js
// Notion API プロキシ（CORS対応）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const TOKEN      = process.env.NOTION_TOKEN;
  const VOL_DB     = process.env.VOL_DB_ID;
  const BOOTH_DB   = process.env.BOOTH_DB_ID;
  const PARENT_ID  = process.env.PARENT_PAGE_ID || '37b4e3b8cb62808eaf50fc9f72da2011';

  // Notion APIヘルパー
  const notion = async (method, endpoint, body) => {
    const r = await fetch(`https://api.notion.com/v1${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };

  const res = (code, data) => ({
    statusCode: code,
    headers: CORS,
    body: JSON.stringify(data),
  });

  try {
    const qs   = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const action = qs.action || body.action;

    // ── SETUP: Notionにデータベース2つを作成 ─────────────────
    if (action === 'setup') {
      // ページIDをハイフン付きに変換
      const pid = PARENT_ID.replace(/-/g, '')
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

      const volDB = await notion('POST', '/databases', {
        parent: { type: 'page_id', page_id: pid },
        title: [{ type: 'text', text: { content: '🙋 ボランティア応募' } }],
        properties: {
          'お名前':     { title: {} },
          'メール':     { email: {} },
          '電話番号':   { phone_number: {} },
          '年齢':       { number: { format: 'number' } },
          '役割':       { select: { options: [
            { name: 'ボランティア管理',  color: 'blue' },
            { name: '出店者サポート',    color: 'green' },
            { name: '企画・運営サポート', color: 'orange' },
          ]}},
          '参加日':     { select: { options: [
            { name: '12月12日（土）全日 10:00〜19:00', color: 'yellow' },
            { name: '12月13日（日）全日 10:00〜19:00', color: 'pink' },
            { name: '両日参加 12日・13日',              color: 'red' },
          ]}},
          '語学スキル': { select: { options: [
            { name: '日本語のみ',              color: 'gray' },
            { name: '日本語・英語',            color: 'blue' },
            { name: '日本語・ベトナム語',      color: 'red' },
            { name: '日本語・英語・ベトナム語', color: 'purple' },
            { name: 'その他（備考に記載）',    color: 'default' },
          ]}},
          '自己PR':     { rich_text: {} },
          '備考':       { rich_text: {} },
          'ステータス': { select: { options: [
            { name: '審査中', color: 'yellow' },
            { name: '確定',   color: 'green' },
            { name: '補欠',   color: 'purple' },
            { name: '不採用', color: 'red' },
          ]}},
          'タグ': { multi_select: { options: [
            { name: 'ベトナム語可', color: 'green' },
            { name: '英語可',       color: 'blue' },
            { name: '経験者',       color: 'purple' },
            { name: '面談済',       color: 'yellow' },
            { name: '要フォロー',   color: 'red' },
            { name: '集合案内済',   color: 'pink' },
          ]}},
          '応募日時': { date: {} },
        },
      });

      const boothDB = await notion('POST', '/databases', {
        parent: { type: 'page_id', page_id: pid },
        title: [{ type: 'text', text: { content: '🏪 出店ブース申込' } }],
        properties: {
          '社名・団体名': { title: {} },
          '担当者名':     { rich_text: {} },
          'メール':       { email: {} },
          '電話番号':     { phone_number: {} },
          'カテゴリ':     { select: { options: [
            { name: '飲食ブース',       color: 'orange' },
            { name: 'キッチンカー',     color: 'yellow' },
            { name: '食材系・物販ブース', color: 'green' },
            { name: '展示・PRブース',   color: 'blue' },
          ]}},
          '出店内容': { rich_text: {} },
          '備考':     { rich_text: {} },
          'ステータス': { select: { options: [
            { name: '確認中', color: 'yellow' },
            { name: '承認',   color: 'green' },
            { name: '補欠',   color: 'purple' },
            { name: '不採用', color: 'red' },
          ]}},
          'タグ': { multi_select: { options: [
            { name: '請求書送付済', color: 'green' },
            { name: '要確認',       color: 'red' },
            { name: '面談済',       color: 'yellow' },
            { name: '優先対応',     color: 'orange' },
            { name: 'VIP',          color: 'purple' },
          ]}},
          '申込日時': { date: {} },
        },
      });

      if (volDB.object === 'error' || boothDB.object === 'error') {
        return res(500, {
          error: 'データベース作成失敗',
          volError: volDB.message,
          boothError: boothDB.message,
        });
      }

      return res(200, {
        success: true,
        VOL_DB_ID: volDB.id,
        BOOTH_DB_ID: boothDB.id,
        message: '✅ データベースを作成しました。上記2つのIDをNetlify環境変数に設定してください。',
      });
    }

    // ── FETCH: Notionからデータ取得 ───────────────────────────
    if (action === 'fetch') {
      const type = qs.type || body.type;
      const dbId = type === 'booth' ? BOOTH_DB : VOL_DB;
      if (!dbId) return res(400, { error: 'DB_NOT_CONFIGURED' });

      const result = await notion('POST', `/databases/${dbId}/query`, {
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        page_size: 100,
      });

      if (result.object === 'error') return res(500, { error: result.message });

      const entries = (result.results || []).map(p => mapFromNotion(p, type));
      return res(200, { entries });
    }

    // ── SUBMIT: Notionにデータ登録 ────────────────────────────
    if (action === 'submit') {
      const { type, data } = body;
      const dbId = type === 'booth' ? BOOTH_DB : VOL_DB;
      if (!dbId) return res(400, { error: 'DB_NOT_CONFIGURED' });

      const properties = type === 'booth' ? boothToNotion(data) : volToNotion(data);
      const page = await notion('POST', '/pages', {
        parent: { database_id: dbId },
        properties,
      });

      if (page.object === 'error') return res(500, { error: page.message });
      return res(200, { entry: mapFromNotion(page, type) });
    }

    // ── UPDATE: ステータス・タグ変更 ──────────────────────────
    if (action === 'update') {
      const { pageId, status, tags, type } = body;

      const statusLabel = type === 'booth'
        ? { pending:'確認中', confirmed:'承認',  waitlist:'補欠', rejected:'不採用' }[status]
        : { pending:'審査中', confirmed:'確定',  waitlist:'補欠', rejected:'不採用' }[status];

      const properties = {};
      if (status && statusLabel) {
        properties['ステータス'] = { select: { name: statusLabel } };
      }
      if (tags !== undefined) {
        properties['タグ'] = { multi_select: tags.map(t => ({ name: t })) };
      }

      const result = await notion('PATCH', `/pages/${pageId}`, { properties });
      if (result.object === 'error') return res(500, { error: result.message });
      return res(200, { success: true });
    }

    return res(404, { error: 'Unknown action: ' + action });

  } catch (e) {
    console.error('API error:', e);
    return res(500, { error: e.message });
  }
};

// ── Notionページ → アプリ形式 ──────────────────────────────────
function mapFromNotion(page, type) {
  const p = page.properties || {};

  const title    = (k) => p[k]?.title?.[0]?.plain_text || '';
  const text     = (k) => p[k]?.rich_text?.[0]?.plain_text || '';
  const email    = (k) => p[k]?.email || '';
  const phone    = (k) => p[k]?.phone_number || '';
  const num      = (k) => p[k]?.number ?? '';
  const sel      = (k) => p[k]?.select?.name || '';
  const multiSel = (k) => (p[k]?.multi_select || []).map(o => o.name);
  const date     = (k) => p[k]?.date?.start || '';

  const roleMap = {
    'ボランティア管理': 'vol_mgmt',
    '出店者サポート':   'store_sup',
    '企画・運営サポート': 'planning',
  };
  const catMap = {
    '飲食ブース':       'food',
    'キッチンカー':     'truck',
    '食材系・物販ブース': 'goods',
    '展示・PRブース':   'exhibit',
  };
  const vStatusMap = { '審査中':'pending','確定':'confirmed','補欠':'waitlist','不採用':'rejected' };
  const bStatusMap = { '確認中':'pending','承認':'confirmed','補欠':'waitlist','不採用':'rejected' };

  if (type === 'booth') {
    return {
      id: page.id, type: 'booth',
      company: title('社名・団体名'),
      name:    text('担当者名'),
      email:   email('メール'),
      phone:   phone('電話番号'),
      cat:     catMap[sel('カテゴリ')] || sel('カテゴリ'),
      content: text('出店内容'),
      note:    text('備考'),
      status:  bStatusMap[sel('ステータス')] || 'pending',
      tags:    multiSel('タグ'),
      at:      date('申込日時') || page.created_time,
    };
  }
  return {
    id: page.id, type: 'vol',
    name:  title('お名前'),
    email: email('メール'),
    phone: phone('電話番号'),
    age:   num('年齢'),
    role:  roleMap[sel('役割')] || sel('役割'),
    shift: sel('参加日'),
    lang:  sel('語学スキル'),
    pr:    text('自己PR'),
    note:  text('備考'),
    status: vStatusMap[sel('ステータス')] || 'pending',
    tags:  multiSel('タグ'),
    at:    date('応募日時') || page.created_time,
  };
}

// ── アプリ形式 → Notionプロパティ ─────────────────────────────
function volToNotion(d) {
  const roleLabel = {
    vol_mgmt: 'ボランティア管理',
    store_sup: '出店者サポート',
    planning:  '企画・運営サポート',
  };
  const props = {
    'お名前':     { title: [{ text: { content: d.name || '' } }] },
    'メール':     { email: d.email || null },
    '電話番号':   { phone_number: d.phone || null },
    '自己PR':     { rich_text: [{ text: { content: d.pr || '' } }] },
    '備考':       { rich_text: [{ text: { content: d.note || '' } }] },
    'ステータス': { select: { name: '審査中' } },
    '応募日時':   { date: { start: new Date().toISOString() } },
  };
  if (d.age)   props['年齢']       = { number: parseInt(d.age) };
  if (d.role)  props['役割']       = { select: { name: roleLabel[d.role] || d.role } };
  if (d.shift) props['参加日']     = { select: { name: d.shift } };
  if (d.lang)  props['語学スキル'] = { select: { name: d.lang } };
  return props;
}

function boothToNotion(d) {
  const catLabel = {
    food:    '飲食ブース',
    truck:   'キッチンカー',
    goods:   '食材系・物販ブース',
    exhibit: '展示・PRブース',
  };
  const props = {
    '社名・団体名': { title: [{ text: { content: d.company || '' } }] },
    '担当者名':     { rich_text: [{ text: { content: d.name || '' } }] },
    'メール':       { email: d.email || null },
    '電話番号':     { phone_number: d.phone || null },
    '出店内容':     { rich_text: [{ text: { content: d.content || '' } }] },
    '備考':         { rich_text: [{ text: { content: d.note || '' } }] },
    'ステータス':   { select: { name: '確認中' } },
    '申込日時':     { date: { start: new Date().toISOString() } },
  };
  if (d.cat) props['カテゴリ'] = { select: { name: catLabel[d.cat] || d.cat } };
  return props;
}
