// Signs the staff member out.
const { clearSessionCookie, siteBase } = require('./_auth');
exports.handler = async function (event) {
  return { statusCode: 302, headers: { Location: siteBase(event) + '/login.html', 'Set-Cookie': clearSessionCookie(), 'Cache-Control':'no-store' }, body: '' };
};
