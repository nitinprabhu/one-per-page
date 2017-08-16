const { Cookie } = require('express-session');
const { parse: parseCookie } = require('cookie');
const signature = require('cookie-signature');

const sessionCookieHeader = (name, secret, session) => {
  const signedContent = `s:${signature.sign(session.id, secret)}`;
  const header = session.cookie.serialize(name, signedContent);
  return header;
};

const ensureIsArray = maybeArray => {
  if (Array.isArray(maybeArray)) return maybeArray;
  return [maybeArray];
};

const appendCookieHeader = (res, header) => {
  const existing = ensureIsArray(res.getHeader('set-cookie') || []);
  res.setHeader('set-cookie', existing.concat(header));
};

const setCookie = (name, secret, req, res) => {
  if (!req.session) return;
  if (!req.session.shouldSetCookie()) return;

  const headerValue = sessionCookieHeader(name, secret, req.session);
  appendCookieHeader(res, headerValue);
};

const getCookie = (name, secret, req) => {
  const header = req.headers.cookie;
  if (typeof header === 'undefined') return;

  const raw = parseCookie(header)[name];
  if (typeof raw === 'undefined') return;

  if (raw.startsWith('s:')) {
    const cookieValue = signature.unsign(raw.slice(2), secret);
    if (cookieValue) {
      req.sessionID = cookieValue;
    }
  }
};

module.exports = { Cookie, setCookie, getCookie };
