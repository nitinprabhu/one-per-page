const config = require('config');
const parseUrl = require('parseurl');
const { MemoryStore } = require('express-session');
const Session = require('./sessions/Session');
const { Cookie, setCookie, loadCookie } = require('./sessions/Cookie');
const uuid = require('node-uuid');
const onHeaders = require('on-headers');

const shimEnd = (req, res) => {
  const _end = res.end;
  const _write = res.write;
  return (chunk, encoding) => {
    if (req.session.shouldSave()) {
      req.session.save();
    }
    return _end.call(res, chunk, encoding);
  };
};

const isSecure = (req, trustProxy) => {
  const secureConnection = req.connection && req.connection.encrypted === true;
  const protoHeader = req.headers['x-forwarded-proto'] || '';
  const expressIsSecure = !trustProxy && req.secure;
  const proxyIsSecure = trustProxy && protoHeader.startsWith('https');

  return secureConnection || expressIsSecure || proxyIsSecure;
};

const createUuid = () => uuid.v4();

const sessions = ({
  secret,
  store = new MemoryStore(),
  name = 'session',
  generateId = createUuid,
  proxy = false,
  cookie = {}
} = {}) => {
  const cookieOptions = Object.assign({}, { secure: false, path: '/' }, cookie);

  store.generate = req => {
    req.sessionID = generateId(req);
    req.session = new Session(req, {}, cookieOptions);
  };
  store.createSession = (req, sess) => req.session.inflate(sess);

  return (req, res, next) => {
    if (req.session) {
      next();
      return;
    }
    if (!secret) {
      next(new Error('secret is missing. A secret is required'));
      return;
    }
    if (cookieOptions.secure && !isSecure(req, proxy)) {
      next(new Error('cookie.secure set but connection is not secure'));
      return;
    }
    const path = parseUrl.original(req).pathname || '/';
    if (!path.startsWith(cookieOptions.path)) {
      next();
      return;
    }

    onHeaders(res, () => setCookie(name, secret, req, res));

    loadCookie(name, secret, req);
    res.end = shimEnd(req, res);
    req.session = new Session(req, {}, cookieOptions);
    req.sessionStore = store;

    if (req.sessionID) {
      store.get(req.sessionID, (error, sess) => {
        if (error) {
          if (error.code === 'ENOENT') next();
          else next(error);
          return;
        }
        store.createSession(req, sess);
        next();
      });
    } else {
      // no session
      next();
    }
  };
};

module.exports = sessions;

module.exports.isSecure = isSecure;
