const config = require('config');
const { MemoryStore } = require('express-session');
const Session = require('./sessions/TransactionalSession');
const { Cookie, setCookie, getCookie } = require('./sessions/Cookie');
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

const createUuid = () => uuid.v4();

const sessions = ({
  secret,
  store = new MemoryStore(),
  name = 'session',
  generateId = createUuid,
  cookie = {}
} = {}) => {
  const cookieOptions = Object.assign({}, cookie, { secure: true });

  store.generate = req => {
    req.sessionID = generateId(req);
    req.session = new Session(req);
    req.session.cookie = new Cookie(cookieOptions);
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

    onHeaders(res, () => setCookie(name, secret, req, res));
    getCookie(name, secret, req);

    res.end = shimEnd(req, res);
    req.session = new Session(req);
    req.sessionStore = store;

    if (req.sessionID) {
      store.get(req.sessionID, (err, sess) => {
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
