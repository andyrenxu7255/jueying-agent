import crypto from 'node:crypto';

const baseUrl = process.env.GATEWAY_BASE_URL || 'http://localhost:3000';
const feishuSecret = process.env.FEISHU_SIGNING_SECRET || 'dev-feishu-secret';
const wecomToken = process.env.WECOM_TOKEN || 'dev-wecom-token';

const results = [];

async function request(name, url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  results.push({ name, status: response.status, body });
  return { status: response.status, body };
}

function assert(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`${name} failed: ${JSON.stringify(detail)}`);
  }
}

function signFeishu(timestamp, nonce, rawBody) {
  return crypto.createHmac('sha256', feishuSecret).update(`${timestamp}:${nonce}:${rawBody}`).digest('hex');
}

function signWecom(timestamp, nonce) {
  const source = [wecomToken, timestamp, nonce].sort().join('');
  return crypto.createHash('sha1').update(source).digest('hex');
}

async function run() {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-001';

  const challengeBody = JSON.stringify({ type: 'url_verification', challenge: 'hello-feishu' });
  const challengeSig = signFeishu(timestamp, nonce, challengeBody);
  const challenge = await request('feishu.challenge', `${baseUrl}/channels/feishu/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': challengeSig
    },
    body: challengeBody
  });
  assert('feishu.challenge.assert', challenge.status === 200 && challenge.body.challenge === 'hello-feishu', challenge);

  const badSig = await request('feishu.bad_signature', `${baseUrl}/channels/feishu/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': 'bad-signature'
    },
    body: challengeBody
  });
  assert('feishu.bad_signature.assert', badSig.status === 401, badSig);

  const feishuPayload = {
    header: { event_id: 'evt-1001', tenant_key: 'tenant-a' },
    event: {
      sender: { sender_id: { open_id: 'ou_1001' } },
      message: {
        chat_id: 'oc_chat_01',
        thread_id: 'ot_thread_01',
        content: JSON.stringify({ text: 'hello from feishu' })
      }
    }
  };
  const feishuBody = JSON.stringify(feishuPayload);
  const feishuSig = signFeishu(timestamp, nonce, feishuBody);
  const feishuMessage = await request('feishu.message', `${baseUrl}/channels/feishu/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': feishuSig
    },
    body: feishuBody
  });
  assert(
    'feishu.message.assert',
    feishuMessage.status === 200 && typeof feishuMessage.body?.data?.session_ref === 'string',
    feishuMessage
  );

  const feishuDuplicate = await request('feishu.duplicate', `${baseUrl}/channels/feishu/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': nonce,
      'x-lark-signature': feishuSig
    },
    body: feishuBody
  });
  assert('feishu.duplicate.assert', feishuDuplicate.status === 200 && feishuDuplicate.body.duplicate === true, feishuDuplicate);

  const wecomTimestamp = String(Math.floor(Date.now() / 1000));
  const wecomNonce = 'nonce-wecom';
  const wecomSignature = signWecom(wecomTimestamp, wecomNonce);

  const wecomChallenge = await request(
    'wecom.challenge',
    `${baseUrl}/channels/wecom/webhook?msg_signature=${wecomSignature}&timestamp=${wecomTimestamp}&nonce=${wecomNonce}&echostr=hello-wecom`,
    { method: 'GET' }
  );
  assert('wecom.challenge.assert', wecomChallenge.status === 200 && wecomChallenge.body === 'hello-wecom', wecomChallenge);

  const wecomBadSig = await request(
    'wecom.bad_signature',
    `${baseUrl}/channels/wecom/webhook?msg_signature=bad&timestamp=${wecomTimestamp}&nonce=${wecomNonce}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgid: 'm_bad', content: 'x' })
    }
  );
  assert('wecom.bad_signature.assert', wecomBadSig.status === 401, wecomBadSig);

  const wecomBody = JSON.stringify({
    msgid: 'm_1001',
    from_user_id: 'wx_user_1001',
    to_user_id: 'corp_a',
    conversation_id: 'chat_a',
    thread_id: 'thread_a',
    text: { content: 'hello from wecom' }
  });

  const wecomMessage = await request(
    'wecom.message',
    `${baseUrl}/channels/wecom/webhook?msg_signature=${wecomSignature}&timestamp=${wecomTimestamp}&nonce=${wecomNonce}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: wecomBody
    }
  );
  assert(
    'wecom.message.assert',
    wecomMessage.status === 200 && typeof wecomMessage.body?.session_ref === 'string',
    wecomMessage
  );

  const wecomDuplicate = await request(
    'wecom.duplicate',
    `${baseUrl}/channels/wecom/webhook?msg_signature=${wecomSignature}&timestamp=${wecomTimestamp}&nonce=${wecomNonce}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: wecomBody
    }
  );
  assert('wecom.duplicate.assert', wecomDuplicate.status === 200 && wecomDuplicate.body.duplicate === true, wecomDuplicate);

  console.log(JSON.stringify({ pass: true, total: results.length, results }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ pass: false, error: String(error), results }, null, 2));
  process.exit(1);
});
