const { Cookie } = require('express-session');
const { parse: parseCookie } = require('cookie');
const signature = require('cookie-signature');

const prefix = 's:';

const sessionCookieHeader = (name, secret, session) => {
  const signedContent = `${prefix}${signature.sign(session.id, secret)}`;
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

const loadCookie = (name, secret, req) => {
  const header = req.headers.cookie || '';
  const raw = parseCookie(header)[name] || '';
  const cookieValue = signature.unsign(raw.slice(prefix.length), secret);

  if (cookieValue) {
    req.sessionID = cookieValue;
  }
};

module.exports = { Cookie, setCookie, loadCookie };
