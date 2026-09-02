// Co·labr — serve a sandbox screenshot to a signed-in member.
//
// Testers photograph whatever is on screen when something goes wrong, which means these
// images routinely show a live dashboard or a supporter's private wall: names, messages,
// prayer requests. They were sitting in a public bucket behind an unguessable URL, which
// is not the same thing as private.
const { sessionFromEvent } = require('./_auth');
const { readObject } = require('./_gcs');

exports.handler = async function (event) {
  if (!sessionFromEvent(event)) return { statusCode: 404, body: 'Not found.' };

  const q = event.queryStringParameters || {};
  const name = String(q.f || '').trim();
  // Only ever a feedback screenshot. Without this, a signed-in member could ask for
  // any object in the bucket, backups included.
  if (!/^feedback\/[A-Za-z0-9._-]{4,80}$/.test(name)) return { statusCode: 400, body: 'Bad request.' };

  const got = await readObject(name);
  if (!got.ok) return { statusCode: 404, body: 'Not found.' };

  return {
    statusCode: 200,
    headers: { 'Content-Type': got.type, 'Cache-Control': 'private, max-age=600' },
    body: Buffer.from(got.body).toString('base64'),
    isBase64Encoded: true
  };
};
